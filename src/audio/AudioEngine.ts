import { Emitter } from '../core/Emitter';
import { clamp, hzToCents } from '../core/math';
import { EQ_BANDS, EQ_GAIN_RANGE } from '../data/effectPresets';
import { builtInMakeupDb } from './dsp/compressorMakeup';

/**
 * AudioEngine — owns the AudioContext and the master section of the graph.
 *
 *   part buses ─┐
 *   fx returns ─┼→ masterIn → master EQ (4 bands) → master stage → output
 *   metronome ──┘                                    (gain + limiter + meter)
 *
 * The master stage is an AudioWorklet (public/worklets/master-processor.js).
 * If worklets are unavailable it falls back to DynamicsCompressor + Gain +
 * AnalyserNodes, so the instrument still plays.
 */

export type EngineState = 'suspended' | 'running' | 'closed' | 'interrupted' | 'error';

export interface MeterFrame {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
  /** Limiter gain, 1 = no reduction. */
  reduction: number;
  /** performance.now() of the last update. */
  at: number;
}

type Events = {
  state: EngineState;
};

export type LatencyMode = 'interactive' | 'balanced' | 'playback';

interface RenderCapacityLike extends EventTarget {
  start(options?: { updateInterval?: number }): void;
  stop(): void;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly events = new Emitter<Events>();

  /** Everything that should reach the speakers connects here. */
  readonly masterIn: GainNode;
  /** Global tuning offset in cents, as an audio-rate signal for every part's pitch bus. */
  readonly tune: ConstantSourceNode;
  /** Latest meter values. Mutated in place; read it from a frame callback. */
  readonly meter: MeterFrame = { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0, reduction: 1, at: 0 };

  /** Last audio-thread load estimate (0..1) where the browser exposes it, else null. */
  cpuLoad: number | null = null;
  usingWorklet = false;
  error: string | null = null;

  private masterGainParam: AudioParam | null = null;
  private masterNode: AudioNode | null = null;
  private analysers: [AnalyserNode, AnalyserNode] | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private volume = 75;
  private readonly eq: BiquadFilterNode[] = [];

  constructor(latencyHint: LatencyMode = 'interactive') {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('This browser has no Web Audio API.');

    this.ctx = new Ctor({ latencyHint });
    this.masterIn = this.ctx.createGain();
    this.tune = this.ctx.createConstantSource();
    this.tune.offset.value = 0;
    this.tune.start();

    this.ctx.addEventListener('statechange', () => this.events.emit('state', this.state));
  }

  get state(): EngineState {
    if (this.error) return 'error';
    return this.ctx.state as EngineState;
  }

  /** Build the master chain. Safe to call while the context is still suspended. */
  async init(workletUrl: string): Promise<void> {
    const ctx = this.ctx;

    // Master EQ: low shelf, two bells, high shelf (see data/effectPresets.ts).
    let tail: AudioNode = this.masterIn;
    for (const band of EQ_BANDS) {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = band.freq;
      f.Q.value = band.q;
      f.gain.value = 0;
      tail.connect(f);
      tail = f;
      this.eq.push(f);
    }

    try {
      if (!ctx.audioWorklet) throw new Error('AudioWorklet unsupported');
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'pva-master', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (e: MessageEvent<number[]>) => {
        const d = e.data;
        const m = this.meter;
        m.peakL = d[0];
        m.peakR = d[1];
        m.rmsL = d[2];
        m.rmsR = d[3];
        m.reduction = d[4];
        m.at = performance.now();
      };
      node.onprocessorerror = () => {
        this.error = 'Master audio processor stopped.';
        this.events.emit('state', this.state);
      };
      this.masterGainParam = node.parameters.get('gain') ?? null;
      tail.connect(node);
      node.connect(ctx.destination);
      this.masterNode = node;
      this.usingWorklet = true;
    } catch (err) {
      console.warn('[AudioEngine] AudioWorklet master stage unavailable, using fallback chain.', err);
      this.buildFallbackMaster(tail);
    }

    this.applyVolume(true);
    this.watchRenderCapacity();
  }

  private buildFallbackMaster(from: AudioNode): void {
    const ctx = this.ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    // take out the make-up gain the compressor node adds by itself
    const trim = ctx.createGain();
    trim.gain.value = Math.pow(10, -builtInMakeupDb(-3, 0, 20) / 20);
    const gain = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = right.fftSize = 1024;
    from.connect(limiter);
    limiter.connect(trim);
    trim.connect(gain);
    gain.connect(ctx.destination);
    gain.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    this.masterGainParam = gain.gain;
    this.masterNode = gain;
    this.analysers = [left, right];
    this.analyserBuffer = new Float32Array(left.fftSize);
    this.usingWorklet = false;
  }

  /** Fallback metering only: pull fresh values from the analysers. No-op with the worklet. */
  pollMeter(): void {
    if (!this.analysers || !this.analyserBuffer) return;
    const buf = this.analyserBuffer;
    const m = this.meter;
    for (let ch = 0; ch < 2; ch++) {
      this.analysers[ch].getFloatTimeDomainData(buf);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      if (ch === 0) {
        m.peakL = peak;
        m.rmsL = rms;
      } else {
        m.peakR = peak;
        m.rmsR = rms;
      }
    }
    m.reduction = 1;
    m.at = performance.now();
  }

  private watchRenderCapacity(): void {
    const capacity = (this.ctx as unknown as { renderCapacity?: RenderCapacityLike }).renderCapacity;
    if (!capacity) return;
    try {
      capacity.addEventListener('update', (e) => {
        const load = (e as unknown as { averageLoad?: number }).averageLoad;
        if (typeof load === 'number') this.cpuLoad = load;
      });
      capacity.start({ updateInterval: 1 });
    } catch {
      /* optional API */
    }
  }

  /* ---------------------------------------------------------------- */
  /* transport of the context itself                                   */
  /* ---------------------------------------------------------------- */

  /** Must be called from a user gesture the first time (browser autoplay policy). */
  async resume(): Promise<boolean> {
    if (this.ctx.state === 'running') return true;
    if (this.ctx.state === 'closed') return false;
    try {
      await this.ctx.resume();
    } catch (err) {
      console.warn('[AudioEngine] resume() rejected', err);
    }
    return (this.ctx.state as string) === 'running';
  }

  async suspend(): Promise<void> {
    if (this.ctx.state === 'running') {
      try {
        await this.ctx.suspend();
      } catch {
        /* ignore */
      }
    }
  }

  get isRunning(): boolean {
    return this.ctx.state === 'running';
  }

  /* ---------------------------------------------------------------- */
  /* master controls                                                   */
  /* ---------------------------------------------------------------- */

  /** 0–100 on the panel. Square-law taper: 75 ≈ −5 dB, 100 = 0 dB. */
  setMasterVolume(value: number): void {
    this.volume = clamp(value, 0, 100);
    this.applyVolume(false);
  }

  private applyVolume(immediate: boolean): void {
    const param = this.masterGainParam;
    if (!param) return;
    const gain = Math.pow(this.volume / 100, 2);
    if (immediate || this.usingWorklet) {
      // The worklet smooths the gain itself.
      param.value = gain;
    } else {
      param.setTargetAtTime(gain, this.ctx.currentTime, 0.012);
    }
  }

  /* ---------------------------------------------------------------- */
  /* master equaliser                                                  */
  /* ---------------------------------------------------------------- */

  /** Gain (dB) and, optionally, frequency (Hz) of one EQ band. */
  setEqBand(index: number, gainDb: number, freq?: number): void {
    const f = this.eq[index];
    const def = EQ_BANDS[index];
    if (!f || !def) return;
    const now = this.ctx.currentTime;
    f.gain.setTargetAtTime(clamp(gainDb, -EQ_GAIN_RANGE, EQ_GAIN_RANGE), now, 0.02);
    if (freq !== undefined) f.frequency.setTargetAtTime(clamp(freq, def.minFreq, def.maxFreq), now, 0.02);
  }

  /**
   * Combined response of the four bands at the given frequencies, in dB —
   * what the EQ graph on the display draws. Computed from the band settings
   * passed in (not from the smoothed audio parameters) so the curve follows
   * the controls immediately.
   */
  eqResponse(freqs: Float32Array<ArrayBuffer>, bands: { gain: number; freq: number }[]): Float32Array {
    const total = new Float32Array(freqs.length);
    const mag = new Float32Array(freqs.length);
    const phase = new Float32Array(freqs.length);
    for (let i = 0; i < EQ_BANDS.length && i < bands.length; i++) {
      // A throw-away filter with exactly the wanted settings.
      const probe = this.ctx.createBiquadFilter();
      probe.type = EQ_BANDS[i].type;
      probe.frequency.value = bands[i].freq;
      probe.Q.value = EQ_BANDS[i].q;
      probe.gain.value = bands[i].gain;
      probe.getFrequencyResponse(freqs, mag, phase);
      for (let k = 0; k < total.length; k++) total[k] += 20 * Math.log10(Math.max(1e-6, mag[k]));
    }
    return total;
  }

  /** Reference pitch for A4 in Hz (415.5–465.9). */
  setTuning(hz: number): void {
    const cents = hzToCents(clamp(hz, 415.5, 465.9));
    this.tune.offset.setTargetAtTime(cents, this.ctx.currentTime, 0.01);
  }

  /* ---------------------------------------------------------------- */
  /* diagnostics                                                       */
  /* ---------------------------------------------------------------- */

  latencyInfo(): { baseMs: number; outputMs: number | null; sampleRate: number; quantumMs: number } {
    const ctx = this.ctx;
    const output = (ctx as unknown as { outputLatency?: number }).outputLatency;
    return {
      baseMs: (ctx.baseLatency ?? 0) * 1000,
      outputMs: typeof output === 'number' && output > 0 ? output * 1000 : null,
      sampleRate: ctx.sampleRate,
      quantumMs: (128 / ctx.sampleRate) * 1000,
    };
  }

  /** Seconds between scheduling a sound and hearing it — used to line visuals up with audio. */
  get outputDelay(): number {
    const output = (this.ctx as unknown as { outputLatency?: number }).outputLatency;
    return (this.ctx.baseLatency ?? 0) + (typeof output === 'number' ? output : 0);
  }

  dispose(): void {
    if (this.masterNode instanceof AudioWorkletNode) this.masterNode.port.postMessage('dispose');
    void this.ctx.close();
  }
}
