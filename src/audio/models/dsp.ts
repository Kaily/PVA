import { mulberry32 } from '../../core/math';

/**
 * Signal-processing building blocks for the synthesis models. Everything
 * here is plain arithmetic on Float32Arrays (no Web Audio), so the models can
 * be unit-tested under Node and rendered off the audio thread.
 */

export const TWO_PI = Math.PI * 2;

export const midiToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/* -------------------------------------------------------------------- */
/* FFT (radix-2, in place)                                               */
/* -------------------------------------------------------------------- */

export function fft(re: Float32Array, im: Float32Array, inverse = false): void {
  const n = re.length;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 1 : -1) * TWO_PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/* -------------------------------------------------------------------- */
/* perfectly looping sustained tones (additive, via inverse FFT)         */
/* -------------------------------------------------------------------- */

export interface LoopTone {
  data: Float32Array;
  /** Sample rate at which `data` plays at exactly the requested pitch. */
  sampleRate: number;
}

export interface Partial {
  /** Frequency as a multiple of the tone's fundamental (1 = fundamental). */
  ratio: number;
  amplitude: number;
  /** Extra whole cycles per loop: detunes the partial by `beats / loop length` Hz. */
  beats?: number;
}

/**
 * Build one loop of a sustained tone from a list of partials.
 *
 * The loop holds a whole number of cycles of every partial, so it repeats
 * without any seam. Because a whole number of cycles in `size` samples fixes
 * the frequency grid, the exact pitch is obtained by giving the loop its own
 * sample rate (the browser resamples on playback anyway).
 *
 * @param noise optional breath / air noise: level per frequency in Hz
 */
export function additiveLoop(
  freq: number,
  partials: Partial[],
  opts: { size?: number; seed?: number; cycleMultiple?: number; noise?: (hz: number) => number } = {},
): LoopTone {
  const size = opts.size ?? 65536;
  const multiple = opts.cycleMultiple ?? 1;
  // whole cycles of the fundamental in the loop, close to a 44.1 kHz rate
  const cycles = Math.max(multiple, Math.round((freq * size) / 44100 / multiple) * multiple);
  const sampleRate = (freq * size) / cycles;
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const rnd = mulberry32(opts.seed ?? 1);
  const half = size >> 1;

  for (const p of partials) {
    const bin = Math.round(cycles * p.ratio) + (p.beats ?? 0);
    if (bin <= 0 || bin >= half - 1 || p.amplitude === 0) continue;
    // Random phases keep the waveform from piling up into one sharp peak.
    const phase = rnd() * TWO_PI;
    re[bin] += (p.amplitude * Math.cos(phase)) / 2;
    im[bin] += (p.amplitude * Math.sin(phase)) / 2;
  }
  if (opts.noise) {
    const hzPerBin = sampleRate / size;
    for (let bin = 8; bin < half - 1; bin++) {
      const level = opts.noise(bin * hzPerBin);
      if (level <= 0) continue;
      const phase = rnd() * TWO_PI;
      const mag = level * Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * 0.5; // Rayleigh-distributed, like real noise
      re[bin] += (mag * Math.cos(phase)) / 2;
      im[bin] += (mag * Math.sin(phase)) / 2;
    }
  }
  // Hermitian symmetry → real signal
  for (let bin = 1; bin < half; bin++) {
    re[size - bin] = re[bin];
    im[size - bin] = -im[bin];
  }
  fft(re, im, true);
  return { data: re, sampleRate };
}

/* -------------------------------------------------------------------- */
/* plucked / struck strings (extended Karplus–Strong)                    */
/* -------------------------------------------------------------------- */

export interface StringOptions {
  freq: number;
  sampleRate: number;
  seconds: number;
  /** Time for the fundamental to fall 60 dB, seconds. */
  t60: number;
  /** 0 = very bright string, 0.5 = strongly damped highs. */
  damping: number;
  /** Where the string is excited, as a fraction of its length (0–0.5). */
  position: number;
  /** Brightness of the pluck itself, 0–1 (a hard plectrum is bright, a finger is dull). */
  brightness: number;
  /**
   * Jawari — the buzzing, slowly brightening tone of a string grazing a wide
   * curved bridge (tanpura, sitar, veena). 0 = off … 1 = strong.
   */
  jawari: number;
  seed: number;
}

/**
 * One string. The loop is a delay line with a loss filter and a first-order
 * all-pass for the fractional part of the delay.
 *
 * Jawari is modelled inside the loop as a one-sided soft limit that follows
 * the string's own level: each round trip the positive half of the wave is
 * flattened a little against the "bridge", which keeps regenerating upper
 * harmonics for as long as the string rings — the characteristic sustained
 * buzz — instead of letting them die away as on a plain string.
 */
export function pluckString(o: StringOptions): Float32Array {
  const sr = o.sampleRate;
  const total = Math.floor(o.seconds * sr);
  const out = new Float32Array(total);
  const period = sr / o.freq;
  const s = Math.min(0.5, Math.max(0.02, o.damping));
  // loop delay = N (integer) + all-pass fraction + loss-filter phase delay (≈ s samples)
  let n = Math.floor(period - s - 0.3);
  let frac = period - s - n;
  if (n < 2) {
    n = 2;
    frac = 0.3;
  }
  const ap = (1 - frac) / (1 + frac);
  const rho = Math.pow(10, -3 / (o.freq * o.t60));
  const rnd = mulberry32(o.seed);

  // --- excitation: one period of shaped noise -------------------------------
  const line = new Float32Array(n);
  let lp = 0;
  const cut = 0.05 + 0.9 * o.brightness * o.brightness;
  for (let i = 0; i < n; i++) {
    lp += (rnd() * 2 - 1 - lp) * cut;
    line[i] = lp;
  }
  // plucking position: comb that removes the harmonics with a node there
  const comb = Math.max(1, Math.round(n * o.position));
  for (let i = n - 1; i >= comb; i--) line[i] -= line[i - comb];
  // remove DC and normalise
  let mean = 0;
  for (let i = 0; i < n; i++) mean += line[i];
  mean /= n;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    line[i] -= mean;
    if (Math.abs(line[i]) > peak) peak = Math.abs(line[i]);
  }
  for (let i = 0; i < n; i++) line[i] /= peak;

  // --- loop ----------------------------------------------------------------------
  const jaw = o.jawari;
  const follow = 1 - Math.exp(-1 / (0.03 * sr)); // level follower, 30 ms
  let level = 0.5;
  let idx = 0;
  let prevIn = 0;
  let apPrevIn = 0;
  let apPrevOut = 0;
  for (let i = 0; i < total; i++) {
    const x = line[idx];
    out[i] = x;
    // loss filter
    let y = rho * ((1 - s) * x + s * prevIn);
    prevIn = x;
    if (jaw > 0) {
      const a = y < 0 ? -y : y;
      level += (a - level) * follow;
      const limit = level * (2.2 - 1.5 * jaw);
      if (y > limit) y = limit + (y - limit) * (1 - 0.85 * jaw);
    }
    // fractional delay
    const z = ap * y + apPrevIn - ap * apPrevOut;
    apPrevIn = y;
    apPrevOut = z;
    line[idx] = z;
    if (++idx >= n) idx = 0;
  }
  return out;
}

/* -------------------------------------------------------------------- */
/* modal synthesis (struck bars, bowls, drum heads)                      */
/* -------------------------------------------------------------------- */

export interface Mode {
  /** Hz */
  freq: number;
  amplitude: number;
  /** Seconds to fall 60 dB. */
  t60: number;
  /** Optional pitch glide: the mode starts at freq × startRatio and settles in `glide` seconds. */
  startRatio?: number;
  glide?: number;
}

export function modal(modes: Mode[], sampleRate: number, seconds: number): Float32Array {
  const total = Math.floor(seconds * sampleRate);
  const out = new Float32Array(total);
  for (const m of modes) {
    if (m.freq >= sampleRate * 0.45 || m.amplitude === 0) continue;
    const decay = Math.exp(-6.908 / (m.t60 * sampleRate));
    const glide = m.glide && m.startRatio ? Math.exp(-1 / (m.glide * sampleRate * 0.35)) : 0;
    let ratio = m.startRatio ?? 1;
    let phase = 0;
    let amp = m.amplitude;
    const w = (TWO_PI * m.freq) / sampleRate;
    for (let i = 0; i < total; i++) {
      out[i] += amp * Math.sin(phase);
      phase += w * ratio;
      amp *= decay;
      if (glide) ratio = 1 + (ratio - 1) * glide;
      if (amp < 1e-5) break;
    }
  }
  return out;
}

/** A short burst of band-limited noise (stick, finger or hammer contact). */
export function noiseBurst(
  sampleRate: number,
  seconds: number,
  opts: { lowHz: number; highHz: number; decay: number; seed: number },
): Float32Array {
  const total = Math.floor(seconds * sampleRate);
  const out = new Float32Array(total);
  const rnd = mulberry32(opts.seed);
  const aLow = 1 - Math.exp((-TWO_PI * opts.highHz) / sampleRate);
  const aHigh = 1 - Math.exp((-TWO_PI * opts.lowHz) / sampleRate);
  const k = Math.exp(-1 / (opts.decay * sampleRate));
  let lp = 0;
  let hp = 0;
  let env = 1;
  for (let i = 0; i < total; i++) {
    lp += (rnd() * 2 - 1 - lp) * aLow; // low-pass at highHz
    hp += (lp - hp) * aHigh; // tracks everything below lowHz
    out[i] = (lp - hp) * env;
    env *= k;
  }
  return out;
}

/* -------------------------------------------------------------------- */
/* helpers                                                               */
/* -------------------------------------------------------------------- */

export function mixInto(dst: Float32Array, src: Float32Array, gain: number, offset = 0): void {
  const n = Math.min(src.length, dst.length - offset);
  for (let i = 0; i < n; i++) dst[offset + i] += src[i] * gain;
}

/** Scale so that the largest sample equals `peak`. Returns the factor used. */
export function normalize(data: Float32Array, peak: number): number {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const a = data[i] < 0 ? -data[i] : data[i];
    if (a > max) max = a;
  }
  if (max <= 0) return 1;
  const k = peak / max;
  for (let i = 0; i < data.length; i++) data[i] *= k;
  return k;
}

/** Short fades so a rendered one-shot starts and ends at zero. */
export function fadeEdges(data: Float32Array, sampleRate: number, inSec: number, outSec: number): void {
  const a = Math.min(data.length, Math.floor(inSec * sampleRate));
  for (let i = 0; i < a; i++) data[i] *= i / a;
  const b = Math.min(data.length, Math.floor(outSec * sampleRate));
  for (let i = 0; i < b; i++) data[data.length - 1 - i] *= i / b;
}

/** RBJ peaking filter, applied in place — used for body resonances. */
export function peaking(data: Float32Array, sampleRate: number, freq: number, q: number, gainDb: number): void {
  const a = Math.pow(10, gainDb / 40);
  const w = (TWO_PI * freq) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const b0 = 1 + alpha * a;
  const b1 = -2 * cos;
  const b2 = 1 - alpha * a;
  const a0 = 1 + alpha / a;
  const a1 = -2 * cos;
  const a2 = 1 - alpha / a;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    data[i] = y;
  }
}

/**
 * Fundamental frequency of a (roughly periodic) signal near `expected` Hz,
 * by autocorrelation with parabolic interpolation. The models use it to
 * tune their output exactly: whatever the loop filters did to the pitch is
 * measured and corrected through the buffer's sample rate.
 */
export function estimateF0(data: Float32Array, sampleRate: number, expected: number, startSec = 0.12): number {
  const period = sampleRate / expected;
  const start = Math.min(Math.floor(startSec * sampleRate), Math.max(0, data.length - 1));
  const window = Math.min(data.length - start - Math.ceil(period * 1.1) - 2, Math.max(2048, Math.ceil(period * 12)));
  if (window < period * 3) return expected;
  const lo = Math.max(2, Math.floor(period * 0.94));
  const hi = Math.ceil(period * 1.06);
  const corr = (lag: number): number => {
    let s = 0;
    for (let i = 0; i < window; i++) s += data[start + i] * data[start + i + lag];
    return s;
  };
  let best = lo;
  let bestValue = -Infinity;
  const values: number[] = [];
  for (let lag = lo; lag <= hi; lag++) {
    const c = corr(lag);
    values.push(c);
    if (c > bestValue) {
      bestValue = c;
      best = lag;
    }
  }
  const i = best - lo;
  let shift = 0;
  if (i > 0 && i < values.length - 1) {
    const a = values[i - 1];
    const b = values[i];
    const c = values[i + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) shift = (0.5 * (a - c)) / denom;
  }
  return sampleRate / (best + shift);
}
