import { clamp } from '../core/math';
import { chorusById, delayById, type ChorusPreset, type DelayPreset } from '../data/effectPresets';
import { reverbById, type ReverbPreset } from '../data/reverbPresets';
import { generateImpulse } from './reverbIR';

/**
 * EffectsEngine — the three send effects shared by all parts.
 *
 *   part reverb sends → reverbIn → convolver            → return ─┐
 *   part chorus sends → chorusIn → modulated delay lines → return ─┼→ masterIn
 *   part delay sends  → delayIn  → stereo feedback delay → return ─┘
 *
 * Each part has its own send level into each effect (MixerEngine), so one
 * reverb, one chorus and one delay serve the whole instrument. Insert
 * effects (compressor, overdrive, rotary …) are per part and live in
 * audio/dsp/inserts.ts; the master EQ is part of the AudioEngine.
 *
 * Preset changes cross-fade or rebuild the effect's own nodes; the buses the
 * parts are connected to never change.
 */

interface ChorusNodes {
  /** First node of the chorus, fed by the chorus bus. */
  input: AudioNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  out: GainNode;
}

export class EffectsEngine {
  /** Parts connect their sends here. */
  readonly reverbIn: GainNode;
  readonly chorusIn: GainNode;
  readonly delayIn: GainNode;

  private readonly reverbReturn: GainNode;
  private readonly chorusReturn: GainNode;
  private readonly delayReturn: GainNode;

  private readonly irCache = new Map<string, AudioBuffer>();
  private reverb: { node: ConvolverNode; gain: GainNode; presetId: string } | null = null;
  private reverbLevel = 30;
  private reverbOn = true;

  private chorus: ChorusNodes | null = null;
  private chorusPresetId = '';
  private chorusLevel = 50;
  private chorusOn = true;
  private lfoShapes = new Map<number, AudioBuffer>();

  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly delayInL: GainNode;
  private readonly delayInR: GainNode;
  private readonly fbLL: GainNode;
  private readonly fbRR: GainNode;
  private readonly fbLR: GainNode;
  private readonly fbRL: GainNode;
  private readonly delayToneL: BiquadFilterNode;
  private readonly delayToneR: BiquadFilterNode;
  private delayPreset: DelayPreset = delayById('tempo');
  private delayLevel = 50;
  private delayOn = true;
  private tempo = 120;

  constructor(
    private readonly ctx: AudioContext,
    masterIn: AudioNode,
  ) {
    const bus = (): GainNode => ctx.createGain();
    this.reverbIn = bus();
    this.chorusIn = bus();
    this.delayIn = bus();
    this.reverbReturn = bus();
    this.chorusReturn = bus();
    this.delayReturn = bus();
    this.reverbReturn.connect(masterIn);
    this.chorusReturn.connect(masterIn);
    this.delayReturn.connect(masterIn);

    // --- delay: two lines with self and cross feedback ---------------------
    // The send is summed to mono first so "ping pong" really alternates sides.
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    this.delayIn.connect(mono);
    this.delayInL = bus();
    this.delayInR = bus();
    mono.connect(this.delayInL);
    mono.connect(this.delayInR);
    this.delayL = ctx.createDelay(3);
    this.delayR = ctx.createDelay(3);
    this.delayToneL = ctx.createBiquadFilter();
    this.delayToneR = ctx.createBiquadFilter();
    this.delayToneL.type = this.delayToneR.type = 'lowpass';
    this.fbLL = bus();
    this.fbRR = bus();
    this.fbLR = bus();
    this.fbRL = bus();
    this.delayInL.connect(this.delayL);
    this.delayInR.connect(this.delayR);
    this.delayL.connect(this.delayToneL);
    this.delayR.connect(this.delayToneR);
    this.delayToneL.connect(this.fbLL);
    this.delayToneL.connect(this.fbLR);
    this.delayToneR.connect(this.fbRR);
    this.delayToneR.connect(this.fbRL);
    this.fbLL.connect(this.delayL);
    this.fbRL.connect(this.delayL);
    this.fbRR.connect(this.delayR);
    this.fbLR.connect(this.delayR);
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.75;
    panR.pan.value = 0.75;
    this.delayToneL.connect(panL);
    this.delayToneR.connect(panR);
    panL.connect(this.delayReturn);
    panR.connect(this.delayReturn);

    this.applyReverbLevel(true);
    this.applyChorusLevel(true);
    this.applyDelay(true);
  }

  /* ---------------------------------------------------------------- */
  /* reverb                                                            */
  /* ---------------------------------------------------------------- */

  get reverbPresetId(): string | null {
    return this.reverb?.presetId ?? null;
  }

  setReverbPreset(id: string): void {
    if (this.reverb?.presetId === id) return;
    const preset = reverbById(id);
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const node = ctx.createConvolver();
    node.normalize = true;
    node.buffer = this.impulseFor(preset);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    this.reverbIn.connect(node);
    node.connect(gain);
    gain.connect(this.reverbReturn);
    gain.gain.setTargetAtTime(1, now, 0.03);

    const old = this.reverb;
    if (old) {
      // Stop feeding the old room, let its tail finish, then drop it.
      try {
        this.reverbIn.disconnect(old.node);
      } catch {
        /* already disconnected */
      }
      const tail = reverbById(old.presetId).decay + 0.5;
      old.gain.gain.setTargetAtTime(0, now + tail * 0.6, tail * 0.1);
      window.setTimeout(() => {
        old.node.disconnect();
        old.gain.disconnect();
      }, (tail + 1) * 1000);
    }
    this.reverb = { node, gain, presetId: preset.id };
  }

  /** Return level, 0–100 on the panel. */
  setReverbLevel(value: number): void {
    this.reverbLevel = clamp(value, 0, 100);
    this.applyReverbLevel(false);
  }

  setReverbEnabled(on: boolean): void {
    this.reverbOn = on;
    this.applyReverbLevel(false);
  }

  private applyReverbLevel(immediate: boolean): void {
    // Together with a tone's send this puts the default (Concert Hall,
    // level 30) roughly 13 dB under the dry signal.
    const gain = this.reverbOn ? Math.pow(this.reverbLevel / 100, 1.5) * 6.5 : 0;
    if (immediate) this.reverbReturn.gain.value = gain;
    else this.reverbReturn.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.03);
  }

  private impulseFor(preset: ReverbPreset): AudioBuffer {
    let buffer = this.irCache.get(preset.id);
    if (!buffer) {
      buffer = generateImpulse(this.ctx, preset);
      this.irCache.set(preset.id, buffer);
    }
    return buffer;
  }

  /* ---------------------------------------------------------------- */
  /* chorus                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * One cycle of a sine starting at a given phase, played as a looping
   * buffer: an LFO whose phase can be chosen (oscillator nodes always start
   * at zero), so the chorus voices sweep against each other.
   */
  private lfoShape(phase: number): AudioBuffer {
    const key = Math.round(phase * 1000);
    let buffer = this.lfoShapes.get(key);
    if (!buffer) {
      const frames = 4096;
      buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
      const d = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) d[i] = Math.sin(2 * Math.PI * (i / frames + phase));
      this.lfoShapes.set(key, buffer);
    }
    return buffer;
  }

  setChorusPreset(id: string): void {
    const preset = chorusById(id);
    if (this.chorusPresetId === preset.id) return;
    this.chorusPresetId = preset.id;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const next = this.buildChorus(preset);
    next.out.gain.value = 0;
    // The new delay lines are empty: sound appears at their outputs all at once
    // when the first delay time has passed. Open the output only after that.
    next.out.gain.setValueAtTime(0, now);
    next.out.gain.setTargetAtTime(preset.gain, now + 0.04, 0.03);
    next.out.connect(this.chorusReturn);

    const old = this.chorus;
    this.chorus = next;
    if (old) {
      old.out.gain.setTargetAtTime(0, now, 0.04);
      window.setTimeout(() => {
        for (const s of old.sources) {
          try {
            s.stop();
          } catch {
            /* not started */
          }
        }
        try {
          this.chorusIn.disconnect(old.input);
        } catch {
          /* already disconnected */
        }
        for (const n of old.nodes) n.disconnect();
        old.out.disconnect();
      }, 400);
    }
  }

  private buildChorus(preset: ChorusPreset): ChorusNodes {
    const ctx = this.ctx;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const out = ctx.createGain();
    // keep the lows out of the modulated path so the bass stays solid
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    this.chorusIn.connect(hp);
    nodes.push(hp);
    const cycleSeconds = 4096 / ctx.sampleRate;
    for (const v of preset.voices) {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = v.delayMs / 1000;
      const lfo = ctx.createBufferSource();
      lfo.buffer = this.lfoShape(v.phase);
      lfo.loop = true;
      lfo.playbackRate.value = v.rateHz * cycleSeconds;
      const depth = ctx.createGain();
      depth.gain.value = v.depthMs / 1000;
      lfo.connect(depth);
      depth.connect(delay.delayTime);
      const pan = ctx.createStereoPanner();
      pan.pan.value = v.pan;
      hp.connect(delay);
      delay.connect(pan);
      pan.connect(out);
      lfo.start();
      nodes.push(delay, depth, pan);
      sources.push(lfo);
    }
    return { input: hp, nodes, sources, out };
  }

  setChorusLevel(value: number): void {
    this.chorusLevel = clamp(value, 0, 100);
    this.applyChorusLevel(false);
  }

  setChorusEnabled(on: boolean): void {
    this.chorusOn = on;
    this.applyChorusLevel(false);
  }

  private applyChorusLevel(immediate: boolean): void {
    const gain = this.chorusOn ? Math.pow(this.chorusLevel / 100, 1.3) * 1.6 : 0;
    if (immediate) this.chorusReturn.gain.value = gain;
    else this.chorusReturn.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.03);
  }

  /* ---------------------------------------------------------------- */
  /* delay                                                             */
  /* ---------------------------------------------------------------- */

  setDelayPreset(id: string): void {
    this.delayPreset = delayById(id);
    this.applyDelay(false);
  }

  setDelayLevel(value: number): void {
    this.delayLevel = clamp(value, 0, 100);
    this.applyDelay(false);
  }

  setDelayEnabled(on: boolean): void {
    this.delayOn = on;
    this.applyDelay(false);
  }

  /** Tempo-synced presets follow the clock. */
  setTempo(bpm: number): void {
    this.tempo = bpm;
    if (this.delayPreset.sync) this.applyDelay(false);
  }

  private applyDelay(immediate: boolean): void {
    const p = this.delayPreset;
    const now = this.ctx.currentTime;
    const beat = 60 / this.tempo;
    const seconds = (v: number): number => clamp(p.sync ? v * beat : v, 0.01, 2.9);
    const set = (param: AudioParam, value: number, tau: number): void => {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, tau);
    };
    // Delay times glide, so a tempo change bends the repeats instead of clicking.
    set(this.delayL.delayTime, seconds(p.left), 0.08);
    set(this.delayR.delayTime, seconds(p.right), 0.08);
    set(this.delayInL.gain, p.inLeft, 0.02);
    set(this.delayInR.gain, p.inRight, 0.02);
    set(this.fbLL.gain, p.feedback, 0.02);
    set(this.fbRR.gain, p.feedback, 0.02);
    set(this.fbLR.gain, p.cross, 0.02);
    set(this.fbRL.gain, p.cross, 0.02);
    set(this.delayToneL.frequency, p.tone, 0.02);
    set(this.delayToneR.frequency, p.tone, 0.02);
    set(this.delayReturn.gain, this.delayOn ? Math.pow(this.delayLevel / 100, 1.3) * 1.4 : 0, 0.03);
  }
}
