import type { DspPreset } from '../../data/effectPresets';
import type { InsertEffect } from '../MixerEngine';
import { builtInMakeupDb } from './compressorMakeup';

/**
 * Insert effects ("DSP"). Each factory builds a small sub-graph from standard
 * Web Audio nodes — no extra latency except the compressor, whose built-in
 * look-ahead adds about 6 ms to the part it is inserted on.
 *
 * A preset (data/effectPresets.ts) names an algorithm and its parameters;
 * `createInsert` turns it into nodes. New algorithms are added by writing one
 * more factory and listing it in BUILDERS.
 */

type Builder = (ctx: AudioContext, p: Record<string, number>) => InsertEffect;

/** Collects nodes so an effect can be torn down in one call. */
class Graph {
  readonly nodes: AudioNode[] = [];
  readonly sources: AudioScheduledSourceNode[] = [];
  constructor(readonly ctx: AudioContext) {}

  gain(value = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, frequency: number, q = 0.707, gainDb = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gainDb;
    this.nodes.push(f);
    return f;
  }

  delay(seconds: number, max = 0.05): DelayNode {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = seconds;
    this.nodes.push(d);
    return d;
  }

  shaper(curve: Float32Array<ArrayBuffer>, oversample: OverSampleType = '4x'): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = curve;
    w.oversample = oversample;
    this.nodes.push(w);
    return w;
  }

  panner(pan = 0): StereoPannerNode {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    this.nodes.push(p);
    return p;
  }

  lfo(rateHz: number, type: OscillatorType = 'sine'): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = rateHz;
    o.start();
    this.sources.push(o);
    return o;
  }

  constant(value: number): ConstantSourceNode {
    const c = this.ctx.createConstantSource();
    c.offset.value = value;
    c.start();
    this.sources.push(c);
    return c;
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* never started */
      }
      s.disconnect();
    }
    for (const n of this.nodes) n.disconnect();
  }
}

const chain = (...nodes: AudioNode[]): void => {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
};

/** Soft-clipping transfer curve; `amount` ≈ how hard the stage is driven. */
function driveCurve(amount: number, asymmetry = 0): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // a little asymmetry adds even harmonics, as a valve stage does
    const y = Math.tanh(amount * (x + asymmetry * x * x)) / norm;
    curve[i] = y;
  }
  return curve;
}

/* ------------------------------------------------------------------ */

const COMPRESSOR_KNEE_DB = 8;

const compressor: Builder = (ctx, p) => {
  const g = new Graph(ctx);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = p.threshold;
  comp.ratio.value = p.ratio;
  comp.attack.value = p.attack;
  comp.release.value = p.release;
  comp.knee.value = COMPRESSOR_KNEE_DB;
  g.nodes.push(comp);
  // the preset's make-up gain, minus the boost the node adds on its own
  const makeup = g.gain(Math.pow(10, (p.makeup - builtInMakeupDb(p.threshold, COMPRESSOR_KNEE_DB, p.ratio)) / 20));
  comp.connect(makeup);
  return { input: comp, output: makeup, dispose: () => g.dispose() };
};

const overdrive: Builder = (ctx, p) => {
  const g = new Graph(ctx);
  const input = g.filter('highpass', 110);
  const shape = g.shaper(driveCurve(p.drive, 0.15));
  const tone = g.filter('lowpass', p.tone, 0.6);
  const level = g.gain(p.level);
  chain(input, shape, tone, level);
  return { input, output: level, dispose: () => g.dispose() };
};

const amp: Builder = (ctx, p) => {
  const g = new Graph(ctx);
  const input = g.filter('highpass', 80);
  const pre = g.gain(1);
  const stage = g.shaper(driveCurve(p.gain, 0.25));
  const bass = g.filter('lowshelf', 180, 0.7, p.bass);
  const mid = g.filter('peaking', 650, 0.8, p.mid);
  const treble = g.filter('highshelf', 3200, 0.7, p.treble);
  // loudspeaker cabinet: no deep bass, a presence bump, nothing above ~5 kHz
  const cabLow = g.filter('highpass', 95, 0.8);
  const cabPresence = g.filter('peaking', 2700, 1.4, 3.5);
  const cabHigh = g.filter('lowpass', 4800, 0.8);
  const level = g.gain(p.level);
  chain(input, pre, stage, bass, mid, treble, cabLow, cabPresence, cabHigh, level);
  return { input, output: level, dispose: () => g.dispose() };
};

const tremolo: Builder = (ctx, p) => {
  const g = new Graph(ctx);
  const input = g.gain(1);
  const lfo = g.lfo(p.rate, 'sine');
  if (p.pan) {
    // auto-pan: the level stays, the position moves
    const pan = g.panner(0);
    const depth = g.gain(p.depth);
    lfo.connect(depth);
    depth.connect(pan.pan);
    input.connect(pan);
    return { input, output: pan, dispose: () => g.dispose() };
  }
  const amp_ = g.gain(1 - p.depth / 2);
  const depth = g.gain(p.depth / 2);
  lfo.connect(depth);
  depth.connect(amp_.gain);
  input.connect(amp_);
  return { input, output: amp_, dispose: () => g.dispose() };
};

const phaser: Builder = (ctx, p) => {
  const g = new Graph(ctx);
  const input = g.gain(1);
  const output = g.gain(1);
  const dry = g.gain(0.7);
  const wet = g.gain(0.7);
  const feedback = g.gain(p.feedback);
  const lfo = g.lfo(p.rate);
  // The all-pass centre frequencies sweep together, in cents, so the sweep sounds even.
  const sweep = g.gain(p.depth * 2400);
  lfo.connect(sweep);
  let node: AudioNode = input;
  const stages = Math.max(2, Math.round(p.stages));
  for (let i = 0; i < stages; i++) {
    const ap = g.filter('allpass', p.centre * Math.pow(1.35, i - stages / 2), 0.6);
    sweep.connect(ap.detune);
    node.connect(ap);
    node = ap;
  }
  node.connect(wet);
  // A feedback loop needs a delay somewhere (Web Audio mutes delay-free cycles).
  const loopDelay = g.delay(128 / ctx.sampleRate, 0.02);
  node.connect(feedback);
  feedback.connect(loopDelay);
  loopDelay.connect(input);
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);
  return { input, output, dispose: () => g.dispose() };
};

const flanger: Builder = (ctx, p) => {
  const g = new Graph(ctx);
  const input = g.gain(1);
  const output = g.gain(1);
  const dry = g.gain(0.7);
  const wet = g.gain(0.7);
  const line = g.delay(p.delayMs / 1000, 0.03);
  const lfo = g.lfo(p.rate, 'triangle');
  const depth = g.gain(Math.min(p.depthMs, p.delayMs * 0.95) / 1000);
  const feedback = g.gain(p.feedback);
  lfo.connect(depth);
  depth.connect(line.delayTime);
  input.connect(line);
  line.connect(wet);
  line.connect(feedback);
  feedback.connect(line);
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);
  return { input, output, dispose: () => g.dispose() };
};

const autowah: Builder = (ctx, p) => {
  const g = new Graph(ctx);
  const input = g.gain(1);
  const output = g.gain(1.4);
  const wah = g.filter('bandpass', p.base, p.q);
  // Envelope follower: rectify, smooth, scale to Hz and add to the filter frequency.
  const rectify = new Float32Array(1024);
  for (let i = 0; i < rectify.length; i++) rectify[i] = Math.abs((i / (rectify.length - 1)) * 2 - 1);
  const abs = g.shaper(rectify, 'none');
  const smooth = g.filter('lowpass', 1 / (2 * Math.PI * Math.max(0.003, p.attack)), 0.5);
  const amount = g.gain(p.range * p.sensitivity);
  chain(input, abs, smooth, amount);
  amount.connect(wah.frequency);
  // a little of the direct sound keeps the body of the note
  const direct = g.gain(0.35);
  input.connect(wah);
  input.connect(direct);
  wah.connect(output);
  direct.connect(output);
  return { input, output, dispose: () => g.dispose() };
};

/** Rotor speeds in Hz: [slow, fast] for the treble horn and the bass drum. */
const HORN = [0.83, 6.7];
const DRUM = [0.7, 5.9];

const rotary: Builder = (ctx, p) => {
  const g = new Graph(ctx);
  const input = g.gain(1);
  const output = g.gain(0.9);

  // crossover at 800 Hz, as in the real cabinet
  const low = g.filter('lowpass', 800, 0.7);
  const high = g.filter('highpass', 800, 0.7);
  input.connect(low);
  input.connect(high);

  const speed = p.fast ? 1 : 0;
  const hornLfo = g.lfo(HORN[speed]);
  const drumLfo = g.lfo(DRUM[speed]);

  // horn: Doppler pitch wobble (moving delay), loudness and position all rotate together
  const doppler = g.delay(0.0012, 0.01);
  const dopplerDepth = g.gain(0.00042 * p.horn);
  hornLfo.connect(dopplerDepth);
  dopplerDepth.connect(doppler.delayTime);
  const hornAmp = g.gain(1 - 0.3 * p.horn);
  const hornAmpDepth = g.gain(0.3 * p.horn);
  hornLfo.connect(hornAmpDepth);
  hornAmpDepth.connect(hornAmp.gain);
  const hornPan = g.panner(0);
  const hornPanDepth = g.gain(p.width);
  // the position lags the loudness by a quarter turn: delay the LFO a little
  const quarter = g.delay(0.25 / HORN[speed], 1);
  hornLfo.connect(quarter);
  quarter.connect(hornPanDepth);
  hornPanDepth.connect(hornPan.pan);
  chain(high, doppler, hornAmp, hornPan, output);

  // drum: slower, heavier, mostly a loudness throb
  const drumAmp = g.gain(1 - 0.22 * p.drum);
  const drumAmpDepth = g.gain(0.22 * p.drum);
  drumLfo.connect(drumAmpDepth);
  drumAmpDepth.connect(drumAmp.gain);
  const drumPan = g.panner(0);
  const drumPanDepth = g.gain(p.width * 0.4);
  drumLfo.connect(drumPanDepth);
  drumPanDepth.connect(drumPan.pan);
  chain(low, drumAmp, drumPan, output);

  let fast = speed === 1;
  return {
    input,
    output,
    // Modulation wheel past the middle = fast. The rotors take time to spin up
    // and down — the horn quickly, the heavy drum slowly.
    setModulation(value: number) {
      const want = value >= 0.5 ? !p.fast : Boolean(p.fast);
      if (want === fast) return;
      fast = want;
      const now = ctx.currentTime;
      hornLfo.frequency.setTargetAtTime(HORN[fast ? 1 : 0], now, 0.7);
      drumLfo.frequency.setTargetAtTime(DRUM[fast ? 1 : 0], now, 2.4);
      quarter.delayTime.setTargetAtTime(0.25 / HORN[fast ? 1 : 0], now, 0.7);
    },
    dispose: () => g.dispose(),
  };
};

const BUILDERS: Record<string, Builder> = { compressor, overdrive, amp, tremolo, phaser, flanger, autowah, rotary };

export function createInsert(ctx: AudioContext, preset: DspPreset): InsertEffect {
  const build = BUILDERS[preset.type];
  if (!build) throw new Error(`Unknown DSP type "${preset.type}"`);
  const effect = build(ctx, preset.params);
  if (preset.trimDb === 0) return effect;
  // the preset's loudness trim, after the effect
  const trim = ctx.createGain();
  trim.gain.value = Math.pow(10, preset.trimDb / 20);
  effect.output.connect(trim);
  return {
    input: effect.input,
    output: trim,
    setModulation: effect.setModulation,
    dispose: () => {
      effect.dispose();
      trim.disconnect();
    },
  };
}
