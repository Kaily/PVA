import { isBlackKey, pitchClass } from '../music/notes';

/**
 * Geometry of the 61-key keybed (C2–C7), expressed in fractions of the keybed
 * width / key length so the same numbers drive both the CSS layout and the
 * pointer hit-testing.
 *
 * Proportions follow a full-size keyboard:
 *   white key  23.5 mm wide, ~140 mm visible length
 *   black key  13.7 mm wide (0.58 of a white key), ~95 mm long (0.64)
 * and the black keys are NOT centred on the gaps — C#/F# sit left, D#/A#
 * sit right, G# is centred, as on a real instrument.
 */
export const FIRST_KEY = 36; // C2
export const LAST_KEY = 96; // C7
export const KEY_COUNT = LAST_KEY - FIRST_KEY + 1; // 61
export const WHITE_COUNT = 36;

export const BLACK_WIDTH = 0.58; // in white-key widths
export const BLACK_LENGTH = 0.64; // fraction of the white-key length

/** Offset of each black key's centre from the boundary between its neighbouring white keys (white-key widths). */
const BLACK_OFFSET: Record<number, number> = { 1: -0.13, 3: 0.13, 6: -0.17, 8: 0, 10: 0.17 };

export interface KeyGeometry {
  midi: number;
  index: number; // 0..60
  black: boolean;
  /** For white keys: 0..35. For black keys: index of the white key to its right. */
  whiteIndex: number;
  /** Left edge and width as fractions (0..1) of the keybed width. */
  left: number;
  width: number;
}

function build(): KeyGeometry[] {
  const keys: KeyGeometry[] = [];
  let white = 0;
  for (let midi = FIRST_KEY; midi <= LAST_KEY; midi++) {
    const index = midi - FIRST_KEY;
    if (isBlackKey(midi)) {
      const centre = white + BLACK_OFFSET[pitchClass(midi)];
      keys.push({
        midi,
        index,
        black: true,
        whiteIndex: white,
        left: (centre - BLACK_WIDTH / 2) / WHITE_COUNT,
        width: BLACK_WIDTH / WHITE_COUNT,
      });
    } else {
      keys.push({ midi, index, black: false, whiteIndex: white, left: white / WHITE_COUNT, width: 1 / WHITE_COUNT });
      white++;
    }
  }
  return keys;
}

export const KEYS: readonly KeyGeometry[] = build();
export const WHITE_KEYS: readonly KeyGeometry[] = KEYS.filter((k) => !k.black);
export const BLACK_KEYS: readonly KeyGeometry[] = KEYS.filter((k) => k.black);

const WHITE_BY_INDEX: readonly KeyGeometry[] = WHITE_KEYS;

export interface KeyHit {
  midi: number;
  /** 0 at the back of the key, 1 at the front edge — used for position-based velocity. */
  depth: number;
}

/**
 * Which key lies under a point? `x` and `y` are fractions of the keybed
 * (0,0 = back-left corner, 1,1 = front-right corner). Returns null outside.
 */
export function keyAt(x: number, y: number): KeyHit | null {
  if (x < 0 || x >= 1 || y < 0 || y > 1) return null;
  if (y <= BLACK_LENGTH) {
    // Only the two black keys bordering this white key can be under the point.
    const w = Math.min(WHITE_COUNT - 1, Math.floor(x * WHITE_COUNT));
    for (const k of BLACK_KEYS) {
      if (k.whiteIndex < w || k.whiteIndex > w + 1) continue;
      if (x >= k.left && x < k.left + k.width) return { midi: k.midi, depth: y / BLACK_LENGTH };
    }
  }
  const w = Math.min(WHITE_COUNT - 1, Math.floor(x * WHITE_COUNT));
  return { midi: WHITE_BY_INDEX[w].midi, depth: y };
}

export const isOnKeybed = (midi: number): boolean => midi >= FIRST_KEY && midi <= LAST_KEY;
