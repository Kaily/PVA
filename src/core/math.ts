export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

export const gainToDb = (gain: number): number => (gain <= 1e-9 ? -180 : 20 * Math.log10(gain));

/** Interval in cents between a reference pitch and A4 = 440 Hz. */
export const hzToCents = (hz: number, ref = 440): number => 1200 * Math.log2(hz / ref);

export const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

/** Deterministic PRNG (mulberry32) — used for reproducible impulse responses. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** Signed display, e.g. +2 / 0 / -3. */
export const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
