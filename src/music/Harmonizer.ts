import type { Chord } from './ChordDetector';
import { pitchClass } from './notes';

/**
 * Auto harmonize — adds harmony notes to a melody note, taken from the chord
 * that is currently being played (in the lower zone when the keyboard is
 * split). Pure functions; the performance router plays the result.
 */

export type HarmonyMode = 'duet' | 'trio' | 'octave' | 'country' | 'block' | 'fourway';

export const HARMONY_MODES: { id: HarmonyMode; label: string; hint: string }[] = [
  { id: 'duet', label: 'Duet', hint: 'one chord note below the melody' },
  { id: 'trio', label: 'Trio', hint: 'two chord notes below' },
  { id: 'octave', label: 'Octave', hint: 'the melody doubled an octave lower' },
  { id: 'country', label: 'Country', hint: 'one chord note above the melody' },
  { id: 'block', label: 'Block', hint: 'the full chord under the melody, plus the lower octave' },
  { id: 'fourway', label: '4-Way', hint: 'three chord notes close under the melody' },
];

/** Harmony notes are played a little softer than the melody. */
export const HARMONY_VELOCITY = 0.72;

/** Pitch classes of a chord. */
function chordClasses(chord: Chord, fourPart: boolean): Set<number> {
  const set = new Set(chord.intervals.map((i) => pitchClass(chord.root + i)));
  if (fourPart && set.size < 4) {
    // A triad has only three notes: add the sixth (major) or the seventh
    // (minor) so that close four-part harmony does not double a voice.
    const minor = chord.intervals.includes(3) && !chord.intervals.includes(4);
    set.add(pitchClass(chord.root + (minor ? 10 : 9)));
  }
  return set;
}

/** Chord notes below `melody`, nearest first, within one octave. */
function below(melody: number, classes: Set<number>, minGap: number): number[] {
  const out: number[] = [];
  for (let n = melody - minGap; n > melody - 12; n--) if (classes.has(pitchClass(n))) out.push(n);
  return out;
}

/**
 * @returns MIDI notes to add to the melody note (never the melody itself).
 * Without a chord only "octave" produces anything — the other modes need to
 * know the harmony.
 */
export function harmonize(mode: HarmonyMode, melody: number, chord: Chord | null): number[] {
  if (mode === 'octave') return melody - 12 >= 0 ? [melody - 12] : [];
  if (!chord) return [];

  switch (mode) {
    case 'duet': {
      // at least a minor third below, so the two voices never clash a second apart
      const c = below(melody, chordClasses(chord, false), 3);
      return c.slice(0, 1);
    }
    case 'trio': {
      const c = below(melody, chordClasses(chord, false), 3);
      return c.slice(0, 2);
    }
    case 'country': {
      const classes = chordClasses(chord, false);
      for (let n = melody + 3; n < melody + 12; n++) if (classes.has(pitchClass(n))) return n <= 127 ? [n] : [];
      return [];
    }
    case 'block': {
      const c = below(melody, chordClasses(chord, false), 1);
      return melody - 12 >= 0 ? [...c, melody - 12] : c;
    }
    case 'fourway': {
      const c = below(melody, chordClasses(chord, true), 1);
      return c.slice(0, 3);
    }
  }
}
