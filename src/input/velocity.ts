import { clamp } from '../core/math';

/**
 * Touch response — how incoming key velocity is shaped before it reaches the
 * sound engine. The result selects the sample layer AND the level, so a
 * softer setting really sounds softer and warmer, not just quieter.
 */
export type TouchMode = 'off' | 'soft' | 'normal' | 'hard';

export const TOUCH_MODES: { id: TouchMode; label: string }[] = [
  { id: 'off', label: 'OFF' },
  { id: 'soft', label: 'SOFT' },
  { id: 'normal', label: 'NORMAL' },
  { id: 'hard', label: 'HARD' },
];

/** Curve exponents: <1 reaches loud dynamics with a light touch, >1 needs a firm one. */
const EXPONENT: Record<Exclude<TouchMode, 'off'>, number> = { soft: 0.62, normal: 1, hard: 1.55 };

/**
 * @param velocity raw velocity 1–127 (from MIDI, pointer position or the fixed PC-keyboard value)
 * @param mode touch response setting
 * @param fixed velocity used when touch response is OFF
 */
export function applyTouch(velocity: number, mode: TouchMode, fixed: number): number {
  if (mode === 'off') return clamp(Math.round(fixed), 1, 127);
  const v = clamp(velocity, 1, 127) / 127;
  return clamp(Math.round(Math.pow(v, EXPONENT[mode]) * 127), 1, 127);
}

/**
 * Velocity for mouse / touch from where the key was struck: close to the back
 * of the key is soft, the front edge is loud — the same lever feel a real key
 * has, and it lets a mouse player shape dynamics.
 *
 * @param depth 0 = back of the key, 1 = front edge
 */
export function velocityFromDepth(depth: number): number {
  const d = clamp(depth, 0, 1);
  return Math.round(38 + d * 82); // 38 … 120
}
