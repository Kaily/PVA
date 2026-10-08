/**
 * Turning a finished practice run into a result: accuracy, counts, the
 * notes that need work, and which supportive comment fits. Pure.
 */
import type { CompiledSong } from './song';
import { TICKS_PER_BEAT } from './song';
import { alignPerformance, analyseRhythm, type GuidedNoteResult, type PlayedNote } from './validation';

export type PracticeMode = 'watch' | 'step' | 'guided' | 'perform';

export interface NoteIssue {
  index: number;
  wrong: number;
  missed: boolean;
  /** Timing remark for guided mode. */
  timing?: 'early' | 'late';
}

export interface PracticeResult {
  lessonId: string;
  mode: Exclude<PracticeMode, 'watch'>;
  /** ISO time the run finished. */
  at: string;
  /** Seconds from start to finish. */
  duration: number;
  tempo: number;
  /** "full" or "phrase-N" (1-based). */
  range: string;
  /** Notes judged in this run. */
  total: number;
  correct: number;
  wrong: number;
  missed: number;
  extra: number;
  /** 0–100, see each builder. */
  accuracy: number;
  /** 0–100 timing / rhythm score where the mode measures it, else null. */
  timing: number | null;
  /** Estimated tempo of an independent performance. */
  playedBpm?: number | null;
  issues: NoteIssue[];
  /** Short comment, shown in the chosen language (see i18n `comment_*`). */
  commentKey: CommentKey;
}

export type CommentKey = 'comment_excellent' | 'comment_timing' | 'comment_good' | 'comment_half' | 'comment_start';

/** Accuracy needed for a mode to count as passed. */
export const PASS_ACCURACY: Record<Exclude<PracticeMode, 'watch'>, number> = { step: 70, guided: 75, perform: 80 };

const pct = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 100);

export function comment(accuracy: number, timing: number | null, mode: PracticeResult['mode']): CommentKey {
  if (accuracy >= 95 && (timing === null || timing >= 80)) return 'comment_excellent';
  if (accuracy >= PASS_ACCURACY[mode]) return timing !== null && timing < 60 ? 'comment_timing' : 'comment_good';
  if (accuracy >= 50) return 'comment_half';
  return 'comment_start';
}

interface Common {
  song: CompiledSong;
  tempo: number;
  duration: number;
  range: string;
  at?: Date;
}

/** Step-by-step: every expected note was eventually played; accuracy = right presses / all presses. */
export function stepResult(c: Common & { wrongPerNote: number[]; from: number; to: number }): PracticeResult {
  const total = c.to - c.from;
  let wrong = 0;
  const issues: NoteIssue[] = [];
  for (let i = c.from; i < c.to; i++) {
    const w = c.wrongPerNote[i] ?? 0;
    wrong += w;
    if (w > 0) issues.push({ index: i, wrong: w, missed: false });
  }
  const accuracy = pct(total / Math.max(1, total + wrong));
  return {
    lessonId: c.song.def.id,
    mode: 'step',
    at: (c.at ?? new Date()).toISOString(),
    duration: Math.round(c.duration),
    tempo: c.tempo,
    range: c.range,
    total,
    correct: total,
    wrong,
    missed: 0,
    extra: 0,
    accuracy,
    timing: null,
    issues,
    commentKey: comment(accuracy, null, 'step'),
  };
}

/**
 * Guided: accuracy = notes hit with the right key / notes due, minus a small
 * deduction for wrong keys; timing = share of hits within the on-time window,
 * with half credit for "close".
 */
export function guidedResult(c: Common & { results: GuidedNoteResult[]; extra: number }): PracticeResult {
  const total = c.results.length;
  const hits = c.results.filter((r) => r.status === 'hit');
  const missed = c.results.filter((r) => r.status === 'missed').length;
  const wrong = c.results.reduce((s, r) => s + r.wrong, 0);
  const accuracy = pct((hits.length - 0.25 * (wrong + c.extra)) / Math.max(1, total));
  let timingPoints = 0;
  for (const h of hits) {
    const off = Math.abs(h.offset ?? 0);
    timingPoints += off <= 0.2 ? 1 : off <= 0.35 ? 0.5 : 0;
  }
  const timing = hits.length ? pct(timingPoints / hits.length) : null;
  const issues: NoteIssue[] = [];
  for (const r of c.results) {
    const late = r.offset !== null && r.offset > 0.35;
    const early = r.offset !== null && r.offset < -0.35;
    if (r.wrong > 0 || r.status === 'missed' || late || early) {
      issues.push({ index: r.index, wrong: r.wrong, missed: r.status === 'missed', timing: late ? 'late' : early ? 'early' : undefined });
    }
  }
  return {
    lessonId: c.song.def.id,
    mode: 'guided',
    at: (c.at ?? new Date()).toISOString(),
    duration: Math.round(c.duration),
    tempo: c.tempo,
    range: c.range,
    total,
    correct: hits.length,
    wrong,
    missed,
    extra: c.extra,
    accuracy,
    timing,
    issues,
    commentKey: comment(accuracy, timing, 'guided'),
  };
}

/** Independent performance: align what was played with the melody, then judge pitch and rhythm. */
export function performResult(c: Common & { played: PlayedNote[]; from: number; to: number }): PracticeResult {
  const notes = c.song.notes.slice(c.from, c.to);
  const expected = notes.map((n) => n.midi);
  const ops = alignPerformance(
    expected,
    c.played.map((p) => p.midi),
  );
  // Re-base the alignment's expected indices to song indices for the rhythm analysis.
  const rebased = ops.map((o) => ('expected' in o ? { ...o, expected: o.expected + c.from } : o));
  const rhythm = analyseRhythm(rebased, c.song.notes, c.played);
  const correct = ops.filter((o) => o.op === 'match').length;
  const wrong = ops.filter((o) => o.op === 'wrong').length;
  const missed = ops.filter((o) => o.op === 'missed').length;
  const extra = ops.filter((o) => o.op === 'extra').length;
  const accuracy = pct((correct - 0.25 * extra) / Math.max(1, expected.length));
  const issues: NoteIssue[] = [];
  for (const o of ops) {
    if (o.op === 'wrong') issues.push({ index: o.expected + c.from, wrong: 1, missed: false });
    if (o.op === 'missed') issues.push({ index: o.expected + c.from, wrong: 0, missed: true });
  }
  const timing = rhythm.steadiness === null ? null : pct(rhythm.steadiness);
  return {
    lessonId: c.song.def.id,
    mode: 'perform',
    at: (c.at ?? new Date()).toISOString(),
    duration: Math.round(c.duration),
    tempo: c.tempo,
    range: c.range,
    total: expected.length,
    correct,
    wrong,
    missed,
    extra,
    accuracy,
    timing,
    playedBpm: rhythm.bpm,
    issues,
    commentKey: comment(accuracy, timing, 'perform'),
  };
}

/** Length of a song section in beats (for display). */
export const sectionBeats = (song: CompiledSong, from: number, to: number): number =>
  (song.notes[to - 1].startTick + song.notes[to - 1].durationTicks - song.notes[from].startTick) / TICKS_PER_BEAT;
