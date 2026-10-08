export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Fixed-do solfège names. */
export const SOLFEGE_NAMES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'] as const;

export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;

/** Scientific octave: MIDI 60 = C4. */
export const octaveOf = (midi: number): number => Math.floor(midi / 12) - 1;

export const noteName = (midi: number): string => `${NOTE_NAMES[pitchClass(midi)]}${octaveOf(midi)}`;

export const isBlackKey = (midi: number): boolean => {
  const pc = pitchClass(midi);
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
};

export type NoteLabelMode = 'off' | 'note' | 'solfege';

export function keyLabel(midi: number, mode: NoteLabelMode): string {
  if (mode === 'off') return '';
  const pc = pitchClass(midi);
  if (mode === 'solfege') return SOLFEGE_NAMES[pc];
  // Show the octave number only on C so the labels stay readable.
  return pc === 0 ? `C${octaveOf(midi)}` : NOTE_NAMES[pc];
}
