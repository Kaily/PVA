import { NOTE_NAMES, pitchClass } from './notes';

/**
 * Chord recognition from a set of sounding notes.
 *
 * Works on pitch classes: every present pitch class is tried as the root and
 * the interval set is matched against the templates below. When several
 * readings fit (C6 = Am7, Csus2 = Gsus4, augmented and diminished-seventh
 * chords are symmetrical …) the reading whose root is the lowest note wins,
 * then the template listed first.
 *
 * Phase 1 uses it for the display. The arranger (Phase 3) feeds the same
 * result to the accompaniment engine.
 */

export interface ChordTemplate {
  /** Suffix shown after the root, e.g. "m7". */
  suffix: string;
  /** Semitones above the root. */
  intervals: number[];
}

/** Order = priority when two readings are otherwise equal. */
export const CHORD_TEMPLATES: ChordTemplate[] = [
  { suffix: '', intervals: [0, 4, 7] },
  { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] },
  { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] },
  { suffix: 'sus4', intervals: [0, 5, 7] },
  { suffix: 'sus2', intervals: [0, 2, 7] },
  { suffix: 'dim', intervals: [0, 3, 6] },
  { suffix: 'aug', intervals: [0, 4, 8] },
  { suffix: '6', intervals: [0, 4, 7, 9] },
  { suffix: 'm6', intervals: [0, 3, 7, 9] },
  { suffix: 'dim7', intervals: [0, 3, 6, 9] },
  { suffix: 'm7b5', intervals: [0, 3, 6, 10] },
  { suffix: 'mMaj7', intervals: [0, 3, 7, 11] },
  { suffix: '7sus4', intervals: [0, 5, 7, 10] },
  { suffix: 'add9', intervals: [0, 2, 4, 7] },
  { suffix: 'madd9', intervals: [0, 2, 3, 7] },
  { suffix: '9', intervals: [0, 2, 4, 7, 10] },
  { suffix: 'maj9', intervals: [0, 2, 4, 7, 11] },
  { suffix: 'm9', intervals: [0, 2, 3, 7, 10] },
  { suffix: '7b9', intervals: [0, 1, 4, 7, 10] },
  { suffix: '7#5', intervals: [0, 4, 8, 10] },
  { suffix: '7b5', intervals: [0, 4, 6, 10] },
  { suffix: '13', intervals: [0, 4, 7, 9, 10] },
  // Shell voicings (fifth omitted) — common in the left hand.
  { suffix: '7', intervals: [0, 4, 10] },
  { suffix: 'maj7', intervals: [0, 4, 11] },
  { suffix: 'm7', intervals: [0, 3, 10] },
];

export interface Chord {
  root: number; // pitch class 0..11
  suffix: string;
  /** Semitones above the root of every chord note. */
  intervals: number[];
  /** Pitch class of the lowest note. */
  bass: number;
  /** e.g. "Cmaj7", "Am", "C/E". */
  name: string;
}

const maskOf = (intervals: number[]): number => intervals.reduce((m, i) => m | (1 << i % 12), 0);
const TEMPLATE_MASKS = CHORD_TEMPLATES.map((t) => maskOf(t.intervals));

/** Rotate a 12-bit pitch-class mask so that `root` becomes bit 0. */
const rotate = (mask: number, root: number): number => ((mask >> root) | (mask << (12 - root))) & 0xfff;

/**
 * @param notes MIDI notes currently sounding (any order, duplicates and octaves allowed)
 * @returns the chord, or null when fewer than three pitch classes sound or nothing matches
 */
export function detectChord(notes: Iterable<number>): Chord | null {
  let mask = 0;
  let lowest = Infinity;
  for (const n of notes) {
    mask |= 1 << pitchClass(n);
    if (n < lowest) lowest = n;
  }
  if (lowest === Infinity) return null;
  let count = 0;
  for (let i = 0; i < 12; i++) if (mask & (1 << i)) count++;
  if (count < 3) return null;

  const bass = pitchClass(lowest);
  let best: { root: number; template: number } | null = null;
  let bestScore = Infinity;
  for (let root = 0; root < 12; root++) {
    if (!(mask & (1 << root))) continue;
    const rel = rotate(mask, root);
    const template = TEMPLATE_MASKS.indexOf(rel);
    if (template < 0) continue;
    // Root in the bass is strongly preferred; then earlier templates.
    const score = (root === bass ? 0 : 100) + template;
    if (score < bestScore) {
      bestScore = score;
      best = { root, template };
    }
  }
  if (!best) return null;

  const suffix = CHORD_TEMPLATES[best.template].suffix;
  const base = `${NOTE_NAMES[best.root]}${suffix}`;
  const name = best.root === bass ? base : `${base}/${NOTE_NAMES[bass]}`;
  return { root: best.root, suffix, intervals: CHORD_TEMPLATES[best.template].intervals, bass, name };
}
