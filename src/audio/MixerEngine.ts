import { clamp } from '../core/math';

/**
 * MixerEngine — channel strips ("parts") between the voices and the master.
 *
 *   voices → input → volume → expression → [insert DSP] → pan ─┬→ dry ─────→ masterIn
 *                                                              ├→ reverb send
 *                                                              ├→ chorus send
 *                                                              └→ delay send
 *
 * Each part also owns a *pitch bus*: an audio-rate signal in cents (pitch
 * bend + vibrato LFO + global tuning) that is connected to the `detune`
 * parameter of every voice of the part. Bending therefore costs one
 * AudioParam write, however many notes are sounding, and is sample-smooth.
 *
 * The keyboard uses three parts — Upper 1, Upper 2 (layer) and Lower (split).
 * Rhythm and song tracks will get their own Part instances in later phases.
 */

/** An insert effect: a small sub-graph with one input and one output. */
export interface InsertEffect {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Modulation wheel position 0…1, for effects that react to it (rotary speaker speed). */
  setModulation?(value: number): void;
  dispose(): void;
}

export interface SendBuses {
  dry: AudioNode;
  reverb: AudioNode;
  chorus: AudioNode;
  delay: AudioNode;
}

export class Part {
  readonly input: GainNode;
  readonly pitchBus: GainNode;

  private readonly volumeNode: GainNode;
  private readonly expressionNode: GainNode;
  private readonly insertIn: GainNode;
  private readonly insertOut: GainNode;
  private readonly panNode: StereoPannerNode;
  private readonly reverbSendNode: GainNode;
  private readonly chorusSendNode: GainNode;
  private readonly delaySendNode: GainNode;
  private readonly bend: ConstantSourceNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoDepth: GainNode;

  private bendCents = 0;
  private insert: InsertEffect | null = null;

  constructor(
    private readonly ctx: AudioContext,
    readonly id: string,
    buses: SendBuses,
    tune: AudioNode,
  ) {
    this.input = ctx.createGain();
    this.volumeNode = ctx.createGain();
    this.expressionNode = ctx.createGain();
    this.insertIn = ctx.createGain();
    this.insertOut = ctx.createGain();
    this.panNode = ctx.createStereoPanner();
    const send = (to: AudioNode): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      this.panNode.connect(g);
      g.connect(to);
      return g;
    };

    // Keep the strip rendering while no note sounds. Browsers stop processing a
    // chain that has no running source, and its parameter changes then only
    // start to glide when the next note arrives — a level changed in silence
    // would be heard moving at the start of that note.
    const keepAlive = ctx.createConstantSource();
    keepAlive.offset.value = 0;
    keepAlive.connect(this.input);
    keepAlive.start();

    this.input.connect(this.volumeNode);
    this.volumeNode.connect(this.expressionNode);
    this.expressionNode.connect(this.insertIn);
    this.insertIn.connect(this.insertOut); // no insert: straight through
    this.insertOut.connect(this.panNode);
    this.panNode.connect(buses.dry);
    this.reverbSendNode = send(buses.reverb);
    this.chorusSendNode = send(buses.chorus);
    this.delaySendNode = send(buses.delay);

    // Pitch bus (cents).
    this.pitchBus = ctx.createGain();
    this.bend = ctx.createConstantSource();
    this.bend.offset.value = 0;
    this.bend.connect(this.pitchBus);
    this.bend.start();

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 5.3;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.pitchBus);
    this.lfo.start();

    tune.connect(this.pitchBus);
  }

  /** 0..1 on a square-law taper. */
  setVolume(v: number): void {
    this.volumeNode.gain.setTargetAtTime(clamp(v, 0, 1) ** 2, this.ctx.currentTime, 0.012);
  }

  /** MIDI CC11, 0..1 */
  setExpression(v: number): void {
    this.expressionNode.gain.setTargetAtTime(clamp(v, 0, 1) ** 2, this.ctx.currentTime, 0.012);
  }

  /** -1 (left) .. +1 (right) */
  setPan(v: number): void {
    this.panNode.pan.setTargetAtTime(clamp(v, -1, 1), this.ctx.currentTime, 0.012);
  }

  /** Send levels, 0..1. */
  setReverbSend(v: number): void {
    this.reverbSendNode.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.02);
  }

  setChorusSend(v: number): void {
    this.chorusSendNode.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.02);
  }

  setDelaySend(v: number): void {
    this.delaySendNode.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.02);
  }

  /** Pitch bend in cents. Smoothed over a few milliseconds to avoid stepping. */
  setBendCents(cents: number): void {
    this.bendCents = cents;
    this.bend.offset.setTargetAtTime(cents, this.ctx.currentTime, 0.004);
  }

  /** Current bend, for voices created on browsers without a detune AudioParam. */
  get staticCents(): number {
    return this.bendCents;
  }

  setVibrato(depthCents: number, rateHz?: number): void {
    const now = this.ctx.currentTime;
    this.lfoDepth.gain.setTargetAtTime(Math.max(0, depthCents), now, 0.02);
    if (rateHz) this.lfo.frequency.setTargetAtTime(rateHz, now, 0.05);
  }

  /**
   * Put an insert effect into the strip (or remove it with null).
   * The strip is ducked for a few milliseconds while the wiring changes, so
   * switching effects never clicks.
   */
  setInsert(effect: InsertEffect | null): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const old = this.insert;
    this.insert = effect;
    const out = this.insertOut.gain;
    out.cancelScheduledValues(now);
    out.setTargetAtTime(0, now, 0.004);
    window.setTimeout(() => {
      try {
        this.insertIn.disconnect();
      } catch {
        /* nothing connected */
      }
      if (old) {
        try {
          old.output.disconnect(this.insertOut);
        } catch {
          /* already gone */
        }
        old.dispose();
      }
      // A newer call may have replaced the effect while we waited.
      const current = this.insert;
      if (current) {
        this.insertIn.connect(current.input);
        current.output.connect(this.insertOut);
      } else {
        this.insertIn.connect(this.insertOut);
      }
      // The new effect starts from rest with the signal already running: let
      // its start-up (filter settling, the compressor's look-ahead) pass
      // behind the closed gate, then open it.
      this.insertOut.gain.setTargetAtTime(1, ctx.currentTime + (current ? 0.014 : 0), 0.006);
    }, 25);
  }

  /** Forward the modulation wheel to the insert effect, if it uses it. */
  setInsertModulation(value: number): void {
    this.insert?.setModulation?.(value);
  }

  get hasInsert(): boolean {
    return this.insert !== null;
  }

  /** True when the inserted effect uses the modulation wheel itself (rotary speaker speed). */
  get insertTakesModulation(): boolean {
    return this.insert?.setModulation !== undefined;
  }
}

export class MixerEngine {
  /** Sum of all dry part signals. */
  readonly dryBus: GainNode;
  /** Metronome strip — straight to the master, never through the effects. */
  readonly metronomeBus: GainNode;

  private readonly parts = new Map<string, Part>();
  private readonly buses: SendBuses;

  constructor(
    private readonly ctx: AudioContext,
    masterIn: AudioNode,
    sends: { reverb: AudioNode; chorus: AudioNode; delay: AudioNode },
    private readonly tune: AudioNode,
  ) {
    this.dryBus = ctx.createGain();
    this.dryBus.connect(masterIn);
    this.metronomeBus = ctx.createGain();
    this.metronomeBus.gain.value = 0.5;
    this.metronomeBus.connect(masterIn);
    // Same reason as in Part: a volume change between two clicks must be complete before the next click.
    const keepAlive = ctx.createConstantSource();
    keepAlive.offset.value = 0;
    keepAlive.connect(this.metronomeBus);
    keepAlive.start();
    this.buses = { dry: this.dryBus, ...sends };
  }

  createPart(id: string): Part {
    const existing = this.parts.get(id);
    if (existing) return existing;
    const part = new Part(this.ctx, id, this.buses, this.tune);
    this.parts.set(id, part);
    return part;
  }

  part(id: string): Part | undefined {
    return this.parts.get(id);
  }

  allParts(): Part[] {
    return [...this.parts.values()];
  }

  /** 0..100 */
  setMetronomeVolume(v: number): void {
    this.metronomeBus.gain.setTargetAtTime((clamp(v, 0, 100) / 100) ** 2, this.ctx.currentTime, 0.01);
  }
}
