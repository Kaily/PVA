import { Emitter } from '../core/Emitter';
import type { PlayableInstrument } from './InstrumentManager';
import type { Part } from './MixerEngine';
import { decayDuration, envelopeLevel, modEnvelopeLevel, type LayerSpec, type ModEnvelopeSpec } from './voiceTypes';

/**
 * VoiceManager — the polyphonic voice engine.
 *
 * A *voice* is one sounding note. It consists of one or more *layers*
 * (a stereo pair, velocity-crossed samples, an attack transient on top of a
 * loop …), each of which is
 *
 *   AudioBufferSourceNode → [low-pass] → GainNode (envelope) → [panner] → part input
 *
 * Pitch within a sample zone uses playbackRate; live pitch (bend, vibrato,
 * tuning) arrives through the part's pitch bus on each source's detune param.
 *
 * Voice life cycle
 *
 *   held ──key up──▶ releasing ──(fade done)──▶ ended
 *     │                 ▲
 *     ├─key up, pedal───┤ (sustained: waits for the pedal)
 *     ├─key up, no damper (top register of a piano) → ringing: decays naturally
 *     └─stolen / cut / panic → dying: ~25 ms fade, then ended
 *
 * Nothing is ever stopped without a fade, so there are no clicks, and every
 * path ends in `ended`, so there are no stuck notes.
 */

export type VoiceState = 'held' | 'sustained' | 'ringing' | 'releasing' | 'dying';

interface Layer {
  spec: LayerSpec;
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode | null;
  panner: StereoPannerNode | null;
  lfo: OscillatorNode | null;
  lfoGains: GainNode[];
  ended: boolean;
}

export interface Voice {
  id: number;
  state: VoiceState;
  /** Sounding MIDI note (after transpose / octave). */
  note: number;
  velocity: number;
  channel: number;
  partId: string;
  instrumentId: string;
  startTime: number;
  releaseTime: number;
  /** Time constant of the fade in progress (releasing / dying). */
  releaseTau: number;
  /** Loudest layer gain at note-on. */
  peakGain: number;
  /** Natural decay time constant of this note — only used to rank voices. */
  decayTau: number;
  noDamper: boolean;
  /** Captured by the sostenuto pedal. */
  sostenuto: boolean;
  keyNoise: { buffer: AudioBuffer; gain: number } | null;
  layers: Layer[];
  /** Layers whose source has not ended yet. */
  alive: number;
  part: Part;
}

/** Pedal state the voice engine needs to consult at Note Off. */
export interface PedalState {
  isSustainDown(partId: string): boolean;
}

type Events = {
  /** A note could not be played because no sample is loaded for it. */
  miss: { note: number; instrumentId: string };
};

export interface VoiceStats {
  /** Voices that count against polyphony. */
  active: number;
  /** Including voices in their final ~25 ms fade. */
  total: number;
  max: number;
  stolen: number;
  /** Sample players currently running (a voice may use several). */
  layers: number;
}

export interface NoteOptions {
  /** AudioContext time at which the note should start. Default: now. */
  when?: number;
  channel?: number;
}

const STEAL_TAU = 0.006; // 6 ms time constant → inaudible in ~25 ms
const CUT_TAU = 0.012; // exclusive-class cut (closed hi-hat stops the open one)
const RETRIGGER_TAU = 0.085;
/** Older voices of the same note allowed to ring out under a new strike. */
const SAME_NOTE_TAILS = 2;
const KEY_NOISE_MAX = 16;
/** Upper bound for sample layers sounding at once (64 voices of a plain tone use 64). */
const MAX_LAYERS = 160;
/** A voice younger than this is only stolen as a last resort. */
const PROTECT_SEC = 0.03;

/** Program a modulation envelope (0 → top → top·sustain) on a parameter, starting at `t0`. */
function scheduleModEnvelope(param: AudioParam, top: number, env: ModEnvelopeSpec, t0: number): void {
  // An attack too short to hear is skipped, so a lasting offset is there from the first sample.
  const attack = env.attack >= 0.003 ? env.attack : 0;
  let t = t0 + env.delay;
  if (env.delay > 0 || attack > 0) {
    param.setValueAtTime(0, t0);
    if (env.delay > 0) param.setValueAtTime(0, t);
    t += attack;
    if (attack > 0) param.linearRampToValueAtTime(top, t);
    else param.setValueAtTime(top, t);
  } else {
    param.setValueAtTime(top, t0);
  }
  if (env.sustain >= 1 || !Number.isFinite(env.hold)) return;
  t += env.hold;
  if (env.hold > 0) param.setValueAtTime(top, t);
  const fall = env.decay * (1 - env.sustain);
  if (fall > 0) param.linearRampToValueAtTime(top * env.sustain, t + fall);
  else param.setValueAtTime(top * env.sustain, t);
}

export class VoiceManager {
  readonly events = new Emitter<Events>();
  maxVoices = 64;
  keyOffNoise = true;

  private readonly voices: Voice[] = [];
  /** Scratch list reused by noteOn (avoids an allocation per note). */
  private readonly sameNote: Voice[] = [];
  private nextId = 1;
  private stolen = 0;
  private keyNoise = 0;
  private layerCount = 0;
  private pedals: PedalState = { isSustainDown: () => false };
  private readonly hasCancelAndHold: boolean;

  constructor(private readonly ctx: AudioContext) {
    this.hasCancelAndHold = typeof (ctx.createGain().gain as { cancelAndHoldAtTime?: unknown }).cancelAndHoldAtTime === 'function';
  }

  attachPedals(pedals: PedalState): void {
    this.pedals = pedals;
  }

  /* ---------------------------------------------------------------- */
  /* note on                                                           */
  /* ---------------------------------------------------------------- */

  noteOn(part: Part, inst: PlayableInstrument, note: number, velocity: number, opts?: NoteOptions): Voice | null {
    const spec = inst.pick(note, velocity);
    if (!spec || spec.layers.length === 0) {
      const [lo, hi] = inst.def.range;
      if (note >= lo && note <= hi) this.events.emit('miss', { note, instrumentId: inst.def.id });
      return null;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t0 = opts?.when !== undefined && opts.when > now ? opts.when : now;
    const voices = this.voices;

    // Same key struck again: the earlier strike fades under the new attack
    // (as a hammer re-excites the string) instead of piling up. At most
    // SAME_NOTE_TAILS older voices of the note are left ringing out, so a
    // fast repetition can never eat the polyphony.
    let live = 0;
    let liveLayers = 0;
    const same = this.sameNote;
    same.length = 0;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (v.state === 'dying') continue;
      live++;
      liveLayers += v.layers.length;
      if (v.note === note && v.partId === part.id) same.push(v);
    }
    if (same.length > 0) {
      // newest first (the voice list itself is not kept in time order)
      same.sort((a, b) => b.startTime - a.startTime || b.id - a.id);
      for (let i = 0; i < same.length; i++) {
        const v = same[i];
        if (i >= SAME_NOTE_TAILS) {
          this.fade(v, t0, 0.02, 'dying');
          live--;
          liveLayers -= v.layers.length;
        } else if (v.state !== 'releasing') {
          this.fade(v, t0, Math.min(this.naturalRelease(v), RETRIGGER_TAU), 'releasing');
        }
      }
      same.length = 0;
    }

    // Exclusive classes: e.g. a closed hi-hat cuts the open one.
    for (let l = 0; l < spec.layers.length; l++) {
      const cls = spec.layers[l].exclusiveClass;
      if (cls === 0) continue;
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        if (v.state === 'dying' || v.partId !== part.id) continue;
        for (let k = 0; k < v.layers.length; k++) {
          if (v.layers[k].spec.exclusiveClass === cls) {
            this.fade(v, t0, CUT_TAU, 'dying');
            live--;
            liveLayers -= v.layers.length;
            break;
          }
        }
      }
    }

    // Polyphony limit — in voices, and in layers: a tone built from several
    // layers per note costs that many times the processing of a plain one.
    while (live >= this.maxVoices || (live > 0 && liveLayers + spec.layers.length > MAX_LAYERS)) {
      const victim = this.chooseVictim(now);
      if (!victim) break;
      this.fade(victim, now, STEAL_TAU, 'dying');
      this.stolen++;
      live--;
      liveLayers -= victim.layers.length;
    }

    let peak = 0;
    for (const l of spec.layers) if (l.gain > peak) peak = l.gain;

    const voice: Voice = {
      id: this.nextId++,
      state: 'held',
      note,
      velocity,
      channel: opts?.channel ?? 0,
      partId: part.id,
      instrumentId: inst.def.id,
      startTime: t0,
      releaseTime: 0,
      releaseTau: 0,
      peakGain: peak,
      decayTau: spec.decayTau,
      noDamper: spec.noDamper,
      sostenuto: false,
      keyNoise: spec.keyNoise,
      layers: [],
      alive: 0,
      part,
    };
    for (let i = 0; i < spec.layers.length; i++) voice.layers.push(this.startLayer(voice, spec.layers[i], t0));
    voice.alive = voice.layers.length;
    this.layerCount += voice.layers.length;
    voices.push(voice);
    return voice;
  }

  /** Key-up for a modulation envelope: from wherever it is, back to 0 over its release time. */
  private releaseModEnvelope(param: AudioParam, top: number, env: ModEnvelopeSpec, t: number, startTime: number): void {
    const level = modEnvelopeLevel(env, t - startTime);
    if (this.hasCancelAndHold) {
      (param as unknown as { cancelAndHoldAtTime(t: number): void }).cancelAndHoldAtTime(t);
    } else {
      param.cancelScheduledValues(t);
      param.setValueAtTime(top * level, t);
    }
    param.linearRampToValueAtTime(0, t + Math.max(0.004, env.release * level));
  }

  private startLayer(voice: Voice, spec: LayerSpec, t0: number): Layer {
    const ctx = this.ctx;
    const part = voice.part;
    const env = spec.env;

    const source = ctx.createBufferSource();
    source.buffer = spec.buffer;
    let rate = spec.rate;
    const detune = (source as { detune?: AudioParam }).detune;
    if (detune) {
      part.pitchBus.connect(detune);
      if (spec.pitchEnv) scheduleModEnvelope(detune, spec.pitchEnv.cents, spec.pitchEnv.env, t0);
    } else {
      // Very old browsers: no live pitch — bake the current bend in.
      rate *= Math.pow(2, part.staticCents / 1200);
    }
    source.playbackRate.value = rate;
    if (spec.loop) {
      source.loop = true;
      source.loopStart = spec.loop.start;
      source.loopEnd = spec.loop.end;
    }

    // --- envelope ---------------------------------------------------------
    const immediate = env.delay <= 0 && env.attack <= 0;
    const gain = ctx.createGain();
    const g = gain.gain;
    g.value = immediate ? spec.gain : 0;
    let t = t0;
    if (immediate) {
      g.setValueAtTime(spec.gain, t);
    } else {
      g.setValueAtTime(0, t);
      t += env.delay;
      if (env.delay > 0) g.setValueAtTime(0, t);
      t += env.attack;
      g.linearRampToValueAtTime(spec.gain, t);
    }
    if (env.hold !== Infinity && env.sustain < 1) {
      t += env.hold;
      g.setValueAtTime(spec.gain, t);
      const fall = decayDuration(env);
      if (fall > 0) {
        t += fall;
        g.exponentialRampToValueAtTime(Math.max(env.sustain, 1e-5) * spec.gain, t);
        if (env.sustain <= 1e-5) g.setValueAtTime(0, t);
      } else {
        g.setValueAtTime(env.sustain * spec.gain, t);
      }
    }

    // --- filter -------------------------------------------------------------
    let filter: BiquadFilterNode | null = null;
    let head: AudioNode = source;
    if (spec.filter) {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = spec.filter.frequency;
      // Web Audio's low-pass Q is in dB above the −3 dB Butterworth response.
      filter.Q.value = spec.filter.resonanceDb - 3.01;
      const fe = spec.filter.env;
      if (fe && spec.filter.envCents !== 0) scheduleModEnvelope(filter.detune, spec.filter.envCents, fe, t0);
      source.connect(filter);
      head = filter;
    }
    head.connect(gain);

    // --- pan ------------------------------------------------------------------
    let panner: StereoPannerNode | null = null;
    if (spec.pan !== 0) {
      panner = ctx.createStereoPanner();
      panner.pan.value = spec.pan;
      gain.connect(panner);
      panner.connect(part.input);
    } else {
      gain.connect(part.input);
    }

    // --- LFO --------------------------------------------------------------------
    let lfo: OscillatorNode | null = null;
    const lfoGains: GainNode[] = [];
    if (spec.lfo) {
      lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.value = spec.lfo.frequency;
      const route = (amount: number, target: AudioParam | undefined): void => {
        if (!amount || !target || !lfo) return;
        const depth = ctx.createGain();
        depth.gain.value = amount;
        lfo.connect(depth);
        depth.connect(target);
        lfoGains.push(depth);
      };
      route(spec.lfo.pitchCents, detune);
      route(spec.lfo.filterCents, filter?.detune);
      if (spec.lfo.volumeDb) route(spec.gain * (1 - Math.pow(10, -Math.abs(spec.lfo.volumeDb) / 20)), g);
      lfo.start(t0 + spec.lfo.delay);
    }

    const layer: Layer = { spec, source, gain, filter, panner, lfo, lfoGains, ended: false };
    source.onended = () => this.layerEnded(voice, layer);
    source.start(t0, spec.offset);
    return layer;
  }

  /* ---------------------------------------------------------------- */
  /* note off / pedals                                                 */
  /* ---------------------------------------------------------------- */

  /** Key released. The pedals decide whether the note actually stops. */
  noteOff(part: Part, note: number): void {
    const now = this.ctx.currentTime;
    const voices = this.voices;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      if (v.state !== 'held' || v.note !== note || v.partId !== part.id) continue;
      if (v.noDamper) {
        // The top register of a piano has no dampers: the string keeps ringing.
        v.state = 'ringing';
      } else if (v.sostenuto || this.pedals.isSustainDown(v.partId)) {
        v.state = 'sustained';
      } else {
        this.release(v, now);
        this.playKeyNoise(v, now);
      }
    }
  }

  /**
   * Release one specific voice at a given time, ignoring the pedals.
   * Used by the arpeggiator and the Academy playback, whose notes have a
   * programmed length. Calling it again with an earlier time moves the
   * release forward (a paused playback cuts its notes, including ones that
   * have not started yet); a later time never postpones it.
   */
  releaseVoice(voice: Voice, when: number): void {
    if (voice.state === 'dying') return;
    const t = Math.max(when, this.ctx.currentTime);
    if (voice.state === 'releasing' && voice.releaseTime <= t) return;
    this.release(voice, t);
  }

  /** Sustain pedal lifted: everything it was holding enters its natural release. */
  releaseSustained(partId: string): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      if (v.state === 'sustained' && v.partId === partId && !v.sostenuto) this.release(v, now);
    }
  }

  /** Sostenuto pedal pressed: capture the notes whose keys are down right now. */
  captureSostenuto(partId: string): void {
    for (const v of this.voices) {
      if (v.state === 'held' && v.partId === partId) v.sostenuto = true;
    }
  }

  releaseSostenuto(partId: string): void {
    const now = this.ctx.currentTime;
    const sustain = this.pedals.isSustainDown(partId);
    for (const v of this.voices) {
      if (v.partId !== partId || !v.sostenuto) continue;
      v.sostenuto = false;
      if (v.state === 'sustained' && !sustain) this.release(v, now);
    }
  }

  /** Musical stop: every note gets a short release, pedals ignored. */
  allNotesOff(partId?: string): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      if (partId && v.partId !== partId) continue;
      if (v.state === 'held' || v.state === 'sustained' || v.state === 'ringing') {
        v.sostenuto = false;
        this.fade(v, now, Math.min(this.naturalRelease(v), 0.12), 'releasing');
      }
    }
  }

  /** Panic: silence everything within ~25 ms. */
  allSoundOff(partId?: string): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      if (partId && v.partId !== partId) continue;
      if (v.state !== 'dying') this.fade(v, now, STEAL_TAU, 'dying');
    }
  }

  /* ---------------------------------------------------------------- */
  /* internals                                                         */
  /* ---------------------------------------------------------------- */

  /** Longest release time constant among the layers (how the note dies when let go). */
  private naturalRelease(v: Voice): number {
    let tau = 0;
    for (const l of v.layers) if (l.spec.env.releaseTau > tau) tau = l.spec.env.releaseTau;
    return tau;
  }

  /** Normal release: each layer follows its own release time. */
  private release(v: Voice, when: number): void {
    this.fade(v, when, null, 'releasing');
  }

  /**
   * Exponential fade to silence starting at `when`, then stop the sources.
   * `tau` null = each layer uses the release time of its own envelope.
   */
  private fade(v: Voice, when: number, tau: number | null, state: 'releasing' | 'dying'): void {
    const now = this.ctx.currentTime;
    const t = when > now ? when : now;
    v.state = state;
    v.releaseTime = t;
    v.releaseTau = tau ?? this.naturalRelease(v);

    for (const layer of v.layers) {
      if (layer.ended) continue;
      const layerTau = Math.max(0.002, tau ?? layer.spec.env.releaseTau);
      const g = layer.gain.gain;
      const startTime = v.startTime;
      if (t <= startTime + layer.spec.env.delay) {
        // Released before it ever sounded.
        g.cancelScheduledValues(startTime);
        g.setValueAtTime(0, startTime);
        try {
          layer.source.stop(startTime);
        } catch {
          /* already stopped */
        }
        continue;
      }
      if (this.hasCancelAndHold) {
        // Keeps any ramp in progress running up to `t`, then holds.
        (g as unknown as { cancelAndHoldAtTime(t: number): void }).cancelAndHoldAtTime(t);
      } else {
        g.cancelScheduledValues(t);
        g.setValueAtTime(envelopeLevel(layer.spec.env, t - startTime) * layer.spec.gain, t);
      }
      g.setTargetAtTime(0, t, layerTau);

      const fspec = layer.spec.filter;
      if (layer.filter && fspec?.env && fspec.envCents !== 0) {
        this.releaseModEnvelope(layer.filter.detune, fspec.envCents, fspec.env, t, startTime);
      }
      const penv = layer.spec.pitchEnv;
      const detune = (layer.source as { detune?: AudioParam }).detune;
      if (penv && detune) this.releaseModEnvelope(detune, penv.cents, penv.env, t, startTime);
      if (layer.spec.loop?.untilRelease) {
        // Leave the loop and play the recorded ending.
        const delay = (t - now) * 1000;
        if (delay < 5) layer.source.loop = false;
        else window.setTimeout(() => (layer.source.loop = false), delay);
      }
      try {
        // ~7 time constants ≈ −60 dB. Calling stop() again just moves the stop time.
        layer.source.stop(t + layerTau * 7 + 0.01);
      } catch {
        /* already stopped */
      }
    }
  }

  /** Estimated current loudness of a voice (envelope × natural decay × release). */
  private level(v: Voice, now: number): number {
    const age = now - v.startTime;
    if (age < 0) return v.peakGain;
    let level = 0;
    for (const l of v.layers) {
      const x = envelopeLevel(l.spec.env, age) * l.spec.gain;
      if (x > level) level = x;
    }
    if (v.decayTau !== Infinity) level *= Math.exp(-age / v.decayTau);
    if ((v.state === 'releasing' || v.state === 'dying') && now > v.releaseTime) {
      level *= Math.exp(-(now - v.releaseTime) / Math.max(0.002, v.releaseTau));
    }
    return level;
  }

  /**
   * Voice stealing order (TASKS.md §8):
   *   1. notes whose key is up — already releasing first, then pedal-sustained
   *      / ringing ones — quietest (in practice: oldest) first
   *   2. otherwise the lowest-energy held voice
   *   3. ties resolved towards the oldest voice
   * A voice that started in the last 30 ms is spared unless nothing else exists.
   */
  private chooseVictim(now: number): Voice | null {
    let best: Voice | null = null;
    let bestScore = Infinity;
    for (const v of this.voices) {
      if (v.state === 'dying') continue;
      const rank = v.state === 'releasing' ? 0 : v.state === 'held' ? 2 : 1;
      const young = now - v.startTime < PROTECT_SEC ? 10 : 0;
      // rank dominates; inside a rank the quieter voice wins; age breaks ties.
      const score = (rank + young) * 1000 + Math.min(999, this.level(v, now) * 100) - (now - v.startTime) * 1e-4;
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  }

  /** The soft mechanical sound of the damper landing, from the key-release samples. */
  private playKeyNoise(v: Voice, now: number): void {
    const noise = v.keyNoise;
    if (!noise || !this.keyOffNoise || this.keyNoise >= KEY_NOISE_MAX) return;
    const held = now - v.startTime;
    const source = this.ctx.createBufferSource();
    source.buffer = noise.buffer;
    const gain = this.ctx.createGain();
    // Louder after a firm strike, quieter once the string has died away.
    gain.gain.value = noise.gain * (0.45 + 0.55 * (v.velocity / 127)) * (0.4 + 0.6 * Math.exp(-held / 2.5));
    source.connect(gain);
    gain.connect(v.part.input);
    this.keyNoise++;
    source.onended = () => {
      this.keyNoise--;
      source.disconnect();
      gain.disconnect();
    };
    source.start(now);
  }

  private layerEnded(v: Voice, layer: Layer): void {
    if (layer.ended) return;
    layer.ended = true;
    this.layerCount--;
    try {
      const detune = (layer.source as { detune?: AudioParam }).detune;
      if (detune) v.part.pitchBus.disconnect(detune);
    } catch {
      /* not connected */
    }
    layer.source.onended = null;
    layer.source.disconnect();
    layer.filter?.disconnect();
    layer.gain.disconnect();
    layer.panner?.disconnect();
    if (layer.lfo) {
      try {
        layer.lfo.stop();
      } catch {
        /* never started */
      }
      layer.lfo.disconnect();
      for (const d of layer.lfoGains) d.disconnect();
    }
    if (--v.alive > 0) return;
    const i = this.voices.indexOf(v);
    if (i >= 0) {
      const last = this.voices.pop()!;
      if (last !== v) this.voices[i] = last;
    }
  }

  /* ---------------------------------------------------------------- */
  /* introspection                                                     */
  /* ---------------------------------------------------------------- */

  stats(): VoiceStats {
    let active = 0;
    for (const v of this.voices) if (v.state !== 'dying') active++;
    return { active, total: this.voices.length, max: this.maxVoices, stolen: this.stolen, layers: this.layerCount };
  }

  /** Snapshot for tests and the performance monitor. */
  snapshot(): { id: number; note: number; state: VoiceState; velocity: number; part: string; layers: number }[] {
    return this.voices.map((v) => ({
      id: v.id,
      note: v.note,
      state: v.state,
      velocity: v.velocity,
      part: v.partId,
      layers: v.layers.length,
    }));
  }

  /** True while any voice of the part still belongs to a pressed or pedal-held key. */
  hasHeldVoices(partId: string): boolean {
    for (const v of this.voices) {
      if (v.partId === partId && (v.state === 'held' || v.state === 'sustained')) return true;
    }
    return false;
  }
}
