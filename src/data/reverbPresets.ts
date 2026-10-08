/**
 * Reverb preset definitions. The impulse responses are generated from these
 * numbers at run time (see audio/reverbIR.ts) — no IR recordings are shipped.
 */
export interface ReverbPreset {
  id: string;
  name: string;
  /** RT60 of the low/mid band, seconds. */
  decay: number;
  /** Gap before the first reflection, ms. */
  preDelayMs: number;
  /** High band decay as a fraction of `decay` (smaller = darker tail). */
  damping: number;
  /** Frequency separating the two decay bands, Hz. */
  crossover: number;
  /** Time for the late field to build up, ms (bigger rooms diffuse slower). */
  buildMs: number;
  /** Early reflection spread, 0..1 (room size impression). */
  size: number;
  earlyCount: number;
  earlyGain: number;
  seed: number;
}

export const REVERB_PRESETS: ReverbPreset[] = [
  { id: 'room', name: 'Room', decay: 0.55, preDelayMs: 4, damping: 0.6, crossover: 2600, buildMs: 8, size: 0.2, earlyCount: 10, earlyGain: 0.75, seed: 11 },
  { id: 'studio', name: 'Studio', decay: 0.9, preDelayMs: 8, damping: 0.55, crossover: 2400, buildMs: 14, size: 0.32, earlyCount: 12, earlyGain: 0.65, seed: 23 },
  { id: 'stage', name: 'Stage', decay: 1.35, preDelayMs: 12, damping: 0.62, crossover: 3000, buildMs: 20, size: 0.5, earlyCount: 14, earlyGain: 0.6, seed: 37 },
  { id: 'hall', name: 'Hall', decay: 1.9, preDelayMs: 18, damping: 0.52, crossover: 2200, buildMs: 32, size: 0.68, earlyCount: 14, earlyGain: 0.5, seed: 41 },
  { id: 'concert', name: 'Concert Hall', decay: 2.6, preDelayMs: 24, damping: 0.48, crossover: 2000, buildMs: 45, size: 0.85, earlyCount: 16, earlyGain: 0.45, seed: 53 },
  { id: 'cathedral', name: 'Cathedral', decay: 4.8, preDelayMs: 36, damping: 0.4, crossover: 1700, buildMs: 70, size: 1, earlyCount: 16, earlyGain: 0.35, seed: 67 },
];

export const DEFAULT_REVERB_ID = 'concert';

export const reverbById = (id: string): ReverbPreset => REVERB_PRESETS.find((p) => p.id === id) ?? REVERB_PRESETS[4];
