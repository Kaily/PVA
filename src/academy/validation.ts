/**
 * Note and timing validation for the practice modes. Pure functions and
 * small state machines that work in *song beats*, so they know nothing about
 * audio clocks or the UI and are unit-tested directly.
 */
import { isBlackKey, noteName } from '../music/notes';
import type { Lang } from './text';
import type { TimedNote } from './song';
import { TICKS_PER_BEAT } from './song';

/* ------------------------------------------------------------------ */
/* Step-by-step (mode B): pitch only                                    */
/* ------------------------------------------------------------------ */

export interface StepJudgement {
  correct: boolean;
  /** Semitones from the pressed key to the expected one (+ = expected is higher, to the right). */
  distance: number;
}

export function judgeStep(expected: number, pressed: number): StepJudgement {
  return { correct: expected === pressed, distance: expected - pressed };
}

/** White keys strictly between two keys, plus one — i.e. how many white keys you move. */
function whiteSteps(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let n = 0;
  for (let k = lo + 1; k <= hi; k++) if (!isBlackKey(k)) n++;
  return n;
}

/** Supportive explanation of a wrong key, in simple Hindi or English. */
export function wrongKeyHint(expected: number, pressed: number, lang: Lang = 'hi'): string {
  const d = expected - pressed;
  const n = Math.abs(d);
  const exp = noteName(expected);
  const got = noteName(pressed);
  const up = d > 0;
  if (lang === 'en') {
    const dir = up ? 'to the right (higher)' : 'to the left (lower)';
    const you = `You pressed ${got}.`;
    if (n % 12 === 0) return `${you} Right name, but a different octave — ${exp} is ${n / 12} octave${n > 12 ? 's' : ''} ${dir}.`;
    if (isBlackKey(pressed) && !isBlackKey(expected)) return `${you} That is a black key. ${exp} is the white key next to it, ${dir}.`;
    if (!isBlackKey(pressed) && !isBlackKey(expected)) {
      const w = whiteSteps(expected, pressed);
      const how = w === 1 ? 'the very next white key' : `${w} white keys`;
      return `${you} The right key is ${exp} — ${how} ${dir}. Look for the green key.`;
    }
    return `${you} The right key is ${exp} — ${n} keys ${dir} (counting black keys). Look for the green key.`;
  }
  const dir = up ? 'दाईं ओर (ऊपर)' : 'बाईं ओर (नीचे)';
  const you = `आपने ${got} दबाया।`;
  if (n % 12 === 0) return `${you} नाम सही है, पर octave अलग है — ${exp} ${n / 12} octave ${dir} है।`;
  if (isBlackKey(pressed) && !isBlackKey(expected)) return `${you} यह काली (black) key है। ${exp} इसके पास वाली सफ़ेद key है, ${dir}।`;
  if (!isBlackKey(pressed) && !isBlackKey(expected)) {
    const w = whiteSteps(expected, pressed);
    const how = w === 1 ? 'बिल्कुल बगल वाली सफ़ेद key' : `${w} सफ़ेद keys`;
    return `${you} सही key ${exp} है — ${how} ${dir}। हरी key देखें।`;
  }
  return `${you} सही key ${exp} है — ${n} keys ${dir} (काली keys भी गिनें)। हरी key देखें।`;
}

/* ------------------------------------------------------------------ */
/* Guided practice (mode C): pitch + approximate timing                 */
/* ------------------------------------------------------------------ */

/** How far (in beats) a press may be from a note's start and still belong to it. */
export const MATCH_WINDOW_BEATS = 0.5;
/** |offset| up to this is "on time". */
export const ON_TIME_BEATS = 0.2;
/** |offset| up to this is "close" (still counted as a hit with a small timing remark). */
export const CLOSE_BEATS = 0.35;

export type TimingVerdict = 'on-time' | 'early' | 'late';

export function timingVerdict(offsetBeats: number): TimingVerdict {
  if (Math.abs(offsetBeats) <= ON_TIME_BEATS) return 'on-time';
  return offsetBeats < 0 ? 'early' : 'late';
}

export type GuidedNoteStatus = 'pending' | 'hit' | 'missed';

export interface GuidedNoteResult {
  index: number;
  status: GuidedNoteStatus;
  /** Press time − expected start, in beats (hits only). */
  offset: number | null;
  /** Wrong keys pressed while this note was due. */
  wrong: number;
  /** Held for this many beats (set when the key is released; hits only). */
  heldBeats: number | null;
}

export type GuidedEvent =
  | { kind: 'hit'; index: number; offset: number; verdict: TimingVerdict }
  | { kind: 'wrong'; index: number; expected: number; pressed: number }
  | { kind: 'extra'; pressed: number }
  | { kind: 'missed'; index: number }
  | { kind: 'short'; index: number; heldBeats: number };

/**
 * Matches the player's presses to the expected notes on a running timeline.
 *
 * A press belongs to the not-yet-hit note whose start is nearest, within
 * ±MATCH_WINDOW_BEATS (a note's window never reaches past the midpoint to
 * its neighbours, so the short pickup notes "Hap-py" are told apart). A
 * press with the right pitch is a hit; otherwise it is a wrong key for the
 * nearest note. Notes whose window has passed without a hit are missed.
 */
export class GuidedMatcher {
  readonly results: GuidedNoteResult[];
  private readonly starts: number[];
  private readonly windows: [number, number][];
  /** Pitch → index of the hit note still held, for measuring hold length. */
  private readonly held = new Map<number, { index: number; at: number }>();

  constructor(
    private readonly notes: TimedNote[],
    /** Only notes in [from, to) are judged (a single phrase can be practised). */
    private readonly from = 0,
    private readonly to = notes.length,
  ) {
    this.results = notes.map((n) => ({ index: n.index, status: 'pending', offset: null, wrong: 0, heldBeats: null }));
    this.starts = notes.map((n) => n.startTick / TICKS_PER_BEAT);
    this.windows = notes.map((_, i) => {
      const s = this.starts[i];
      const prev = i > 0 ? this.starts[i - 1] : -Infinity;
      const next = i < notes.length - 1 ? this.starts[i + 1] : Infinity;
      return [Math.max(s - MATCH_WINDOW_BEATS, (prev + s) / 2), Math.min(s + MATCH_WINDOW_BEATS, (s + next) / 2)];
    });
  }

  private inRange(i: number): boolean {
    return i >= this.from && i < this.to;
  }

  /** Index of the note whose window contains `beat` (or null). */
  private candidate(beat: number, midi: number): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (let i = this.from; i < this.to; i++) {
      if (this.results[i].status !== 'pending') continue;
      const [lo, hi] = this.windows[i];
      if (beat < lo || beat > hi) continue;
      // Prefer a note with the pressed pitch; otherwise the nearest one.
      const dist = Math.abs(beat - this.starts[i]) - (this.notes[i].midi === midi ? 1000 : 0);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  press(midi: number, beat: number): GuidedEvent {
    const i = this.candidate(beat, midi);
    if (i === null) return { kind: 'extra', pressed: midi };
    const expected = this.notes[i].midi;
    if (expected !== midi) {
      this.results[i].wrong++;
      return { kind: 'wrong', index: i, expected, pressed: midi };
    }
    const offset = beat - this.starts[i];
    this.results[i].status = 'hit';
    this.results[i].offset = offset;
    this.held.set(midi, { index: i, at: beat });
    return { kind: 'hit', index: i, offset, verdict: timingVerdict(offset) };
  }

  /** A key was let go. Reports notes of one beat or more released after less than half their length. */
  release(midi: number, beat: number): GuidedEvent | null {
    const h = this.held.get(midi);
    if (!h) return null;
    this.held.delete(midi);
    const heldBeats = Math.max(0, beat - h.at);
    this.results[h.index].heldBeats = heldBeats;
    const length = this.notes[h.index].beats;
    if (length >= 1 && heldBeats < length * 0.5) return { kind: 'short', index: h.index, heldBeats };
    return null;
  }

  /** Mark every note whose window has passed as missed; returns the newly missed ones. */
  advanceTo(beat: number): number[] {
    const missed: number[] = [];
    for (let i = this.from; i < this.to; i++) {
      if (this.results[i].status === 'pending' && beat > this.windows[i][1]) {
        this.results[i].status = 'missed';
        missed.push(i);
      }
    }
    return missed;
  }

  /** Everything still pending is missed (end of the run). */
  finish(): void {
    for (let i = this.from; i < this.to; i++) if (this.results[i].status === 'pending') this.results[i].status = 'missed';
  }

  /** Forget the results of [from, to) so a section can be played again. */
  reset(from = this.from, to = this.to): void {
    for (let i = from; i < to; i++) this.results[i] = { index: i, status: 'pending', offset: null, wrong: 0, heldBeats: null };
    this.held.clear();
  }

  judged(): GuidedNoteResult[] {
    return this.results.filter((r) => this.inRange(r.index));
  }
}

/* ------------------------------------------------------------------ */
/* Independent performance (mode D): alignment                          */
/* ------------------------------------------------------------------ */

export interface PlayedNote {
  midi: number;
  /** Seconds (any origin). */
  time: number;
}

export type AlignOp =
  | { op: 'match'; expected: number; played: number }
  | { op: 'wrong'; expected: number; played: number }
  | { op: 'missed'; expected: number }
  | { op: 'extra'; played: number };

/**
 * Minimum-edit alignment of the played pitches against the expected melody
 * (Levenshtein with back-trace). Matches cost 0, a wrong note, a missed note
 * and an extra note cost 1 each; ties prefer a wrong note, which is how a
 * listener hears a slip.
 */
export function alignPerformance(expected: number[], played: number[]): AlignOp[] {
  const n = expected.length;
  const m = played.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = d[i - 1][j - 1] + (expected[i - 1] === played[j - 1] ? 0 : 1);
      d[i][j] = Math.min(sub, d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }
  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = expected[i - 1] === played[j - 1];
      if (d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
        ops.push({ op: same ? 'match' : 'wrong', expected: i - 1, played: j - 1 });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: 'missed', expected: i - 1 });
      i--;
    } else {
      ops.push({ op: 'extra', played: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

export interface RhythmAnalysis {
  /** Estimated tempo of the performance (BPM), or null with fewer than two matched notes. */
  bpm: number | null;
  /** Share (0–1) of note-to-note gaps within ±30 % of the written length at that tempo. */
  steadiness: number | null;
  /** Pairs that were compared. */
  pairs: number;
}

/**
 * How even the rhythm was, independent of speed: compares the gaps between
 * consecutive matched notes with their written lengths, after estimating the
 * player's own tempo (median seconds per beat).
 */
export function analyseRhythm(ops: AlignOp[], notes: TimedNote[], played: PlayedNote[]): RhythmAnalysis {
  const matched = ops.filter((o): o is Extract<AlignOp, { op: 'match' }> => o.op === 'match');
  const ratios: { expectedBeats: number; seconds: number }[] = [];
  for (let k = 1; k < matched.length; k++) {
    const a = matched[k - 1];
    const b = matched[k];
    if (b.expected !== a.expected + 1) continue; // only neighbours in the melody
    const expectedBeats = (notes[b.expected].startTick - notes[a.expected].startTick) / TICKS_PER_BEAT;
    const seconds = played[b.played].time - played[a.played].time;
    if (expectedBeats > 0 && seconds > 0) ratios.push({ expectedBeats, seconds });
  }
  if (ratios.length === 0) return { bpm: null, steadiness: null, pairs: 0 };
  const spb = ratios.map((r) => r.seconds / r.expectedBeats).sort((x, y) => x - y);
  const median = spb[Math.floor(spb.length / 2)];
  const good = ratios.filter((r) => Math.abs(r.seconds / (r.expectedBeats * median) - 1) <= 0.3).length;
  return { bpm: Math.round(60 / median), steadiness: good / ratios.length, pairs: ratios.length };
}
