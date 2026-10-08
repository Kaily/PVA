/**
 * Song model of the Piano Academy.
 *
 * A lesson song is data (`content/*.json`): phrases of notes, each note with
 * its length in beats, finger, lyric syllable and an optional hand-shift
 * instruction. `compileSong()` validates that data and turns it into a flat
 * timeline on the instrument's clock grid (24 ticks per beat, see
 * audio/Clock.ts), which every practice mode works from.
 *
 * Pure — no browser APIs — so it is unit-tested under Node.
 */
import { isText, type Text } from './text';

export const TICKS_PER_BEAT = 24;

export interface SongNoteDef {
  /** Scientific pitch name, e.g. "G4" (C4 = MIDI 60), "F#5", "Bb3". */
  note: string;
  /** Length in beats (quarter note = 1). */
  beats: number;
  /** Recommended finger, 1 = thumb … 5 = little finger. */
  finger: number;
  lyric?: string;
  /** Hand-position change to make before this note. */
  shift?: Text;
}

export interface PhraseDef {
  title: string;
  lyric: string;
  /** Teaching tip shown while this phrase is practised. */
  tip: Text;
  notes: SongNoteDef[];
}

export interface SongDef {
  id: string;
  title: string;
  difficulty: Text;
  keySignature: string;
  hand: 'right' | 'left';
  practice: Text;
  timeSignature: { beats: number; unit: number };
  /** Beats before the first full bar (anacrusis). 0 = the song starts on beat 1. */
  pickupBeats: number;
  tempo: { default: number; min: number; max: number };
  intro: Text;
  phrases: PhraseDef[];
}

export interface TimedNote {
  /** Position in the whole song, 0-based. */
  index: number;
  midi: number;
  name: string;
  beats: number;
  finger: number;
  lyric: string;
  shift?: Text;
  phrase: number;
  indexInPhrase: number;
  /** Start and length on the clock grid, counted from the start of bar 0 (which contains the pickup). */
  startTick: number;
  durationTicks: number;
}

export interface CompiledPhrase {
  index: number;
  title: string;
  lyric: string;
  tip: Text;
  /** Index of the first note and one past the last. */
  first: number;
  end: number;
  startTick: number;
  endTick: number;
}

export interface CompiledSong {
  def: SongDef;
  notes: TimedNote[];
  phrases: CompiledPhrase[];
  beatsPerBar: number;
  ticksPerBar: number;
  /** Tick at which the first note starts (the pickup). */
  firstTick: number;
  /** Tick at which the last note ends. */
  endTick: number;
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "G4" → 67, "C#5" → 73, "Bb3" → 58. Throws on anything else. */
export function parseNote(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`Invalid note name "${name}"`);
  const pc = LETTER[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + pc;
  if (midi < 0 || midi > 127) throw new Error(`Note "${name}" is out of the MIDI range`);
  return midi;
}

export function beatsToTicks(beats: number): number {
  const ticks = beats * TICKS_PER_BEAT;
  const rounded = Math.round(ticks);
  if (Math.abs(ticks - rounded) > 1e-6) throw new Error(`${beats} beats is not on the 1/24-beat grid`);
  return rounded;
}

/** Validate a song definition and lay it out on the tick grid. */
export function compileSong(def: SongDef): CompiledSong {
  const beatsPerBar = def.timeSignature.beats;
  if (!(beatsPerBar >= 1 && beatsPerBar <= 12)) throw new Error('timeSignature.beats must be 1–12');
  if (def.pickupBeats < 0 || def.pickupBeats >= beatsPerBar) throw new Error('pickupBeats must be less than one bar');
  if (!(def.tempo.min <= def.tempo.default && def.tempo.default <= def.tempo.max)) throw new Error('tempo.default outside min/max');
  if (def.phrases.length === 0) throw new Error('A song needs at least one phrase');
  const bilingual = (v: unknown, where: string): void => {
    if (!isText(v) || !v.hi.trim() || !v.en.trim()) throw new Error(`${where} needs both "hi" and "en" text`);
  };
  bilingual(def.difficulty, 'difficulty');
  bilingual(def.practice, 'practice');
  bilingual(def.intro, 'intro');

  const ticksPerBar = beatsPerBar * TICKS_PER_BEAT;
  const firstTick = beatsToTicks(beatsPerBar - def.pickupBeats) % ticksPerBar;
  const notes: TimedNote[] = [];
  const phrases: CompiledPhrase[] = [];
  let tick = firstTick;

  def.phrases.forEach((p, phraseIndex) => {
    if (p.notes.length === 0) throw new Error(`Phrase ${phraseIndex + 1} has no notes`);
    bilingual(p.tip, `Phrase ${phraseIndex + 1} tip`);
    const first = notes.length;
    const startTick = tick;
    p.notes.forEach((n, i) => {
      if (!(n.beats > 0)) throw new Error(`Phrase ${phraseIndex + 1}, note ${i + 1}: beats must be > 0`);
      if (![1, 2, 3, 4, 5].includes(n.finger)) throw new Error(`Phrase ${phraseIndex + 1}, note ${i + 1}: finger must be 1–5`);
      if (n.shift !== undefined) bilingual(n.shift, `Phrase ${phraseIndex + 1}, note ${i + 1} shift`);
      const midi = parseNote(n.note);
      const durationTicks = beatsToTicks(n.beats);
      notes.push({
        index: notes.length,
        midi,
        name: n.note,
        beats: n.beats,
        finger: n.finger,
        lyric: n.lyric ?? '',
        shift: n.shift,
        phrase: phraseIndex,
        indexInPhrase: i,
        startTick: tick,
        durationTicks,
      });
      tick += durationTicks;
    });
    phrases.push({
      index: phraseIndex,
      title: p.title,
      lyric: p.lyric,
      tip: p.tip,
      first,
      end: notes.length,
      startTick,
      endTick: tick,
    });
  });

  return { def, notes, phrases, beatsPerBar, ticksPerBar, firstTick, endTick: tick };
}

/** Seconds a note lasts at a tempo. */
export const noteSeconds = (beats: number, bpm: number): number => (beats * 60) / bpm;

/** Plain-language name of a note length: `hi` in Hindi, `en` the English term. */
export function durationLabel(beats: number): Text {
  const table: [number, string, string][] = [
    [0.25, 'बहुत छोटा', 'sixteenth'],
    [0.5, 'छोटा', 'eighth'],
    [0.75, 'छोटा', 'dotted eighth'],
    [1, 'एक गिनती', 'quarter'],
    [1.5, 'डेढ़ गिनती', 'dotted quarter'],
    [2, 'दो गिनती', 'half'],
    [3, 'तीन गिनती', 'dotted half'],
    [4, 'चार गिनती', 'whole'],
  ];
  const hit = table.find(([b]) => Math.abs(b - beats) < 1e-6);
  return hit ? { hi: hit[1], en: hit[2] } : { hi: `${beats} गिनती`, en: `${beats} beats` };
}

/** Name of a finger number. */
export const FINGER_NAMES: Record<number, Text> = {
  1: { hi: 'अँगूठा', en: 'thumb' },
  2: { hi: 'तर्जनी', en: 'index finger' },
  3: { hi: 'बीच की उँगली', en: 'middle finger' },
  4: { hi: 'अनामिका', en: 'ring finger' },
  5: { hi: 'छोटी उँगली', en: 'little finger' },
};

/** Which phrase a note index belongs to. */
export function phraseOf(song: CompiledSong, index: number): CompiledPhrase {
  const i = Math.max(0, Math.min(song.notes.length - 1, index));
  return song.phrases[song.notes[i].phrase];
}
