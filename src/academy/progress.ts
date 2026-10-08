/**
 * Learning progress: what has been practised, how well, and for how long.
 *
 * Kept in localStorage through the app's StorageManager (key
 * `pva61.academy`, versioned envelope) — the same mechanism the instrument
 * already uses for its preferences, so no extra database is introduced.
 * Pure functions here; `AcademyStore` in LessonEngine does the reading and
 * writing.
 */
import { PASS_ACCURACY, type PracticeMode, type PracticeResult } from './scoring';

export const MAX_SESSIONS = 200;

export interface LessonProgress {
  attempts: number;
  /** Best accuracy per mode, full-song runs only. */
  best: Partial<Record<Exclude<PracticeMode, 'watch'>, number>>;
  /** Modes passed with a full-song run. */
  passed: Exclude<PracticeMode, 'watch'>[];
  /** Watch-and-listen has been played to the end at least once. */
  watched: boolean;
  lastPlayed: string | null;
  /** Note index → how often it went wrong or was missed (all runs). */
  weakNotes: Record<string, number>;
}

export interface AcademyProgress {
  lessons: Record<string, LessonProgress>;
  sessions: PracticeResult[];
  /** Seconds practised per local day (YYYY-MM-DD). */
  daily: Record<string, number>;
  totalSeconds: number;
}

export const emptyProgress = (): AcademyProgress => ({ lessons: {}, sessions: [], daily: {}, totalSeconds: 0 });

export const emptyLesson = (): LessonProgress => ({ attempts: 0, best: {}, passed: [], watched: false, lastPlayed: null, weakNotes: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accept stored data only if its shape is right; anything damaged is dropped instead of breaking the Academy. */
export function sanitizeProgress(raw: unknown): AcademyProgress {
  const p = emptyProgress();
  if (!isObj(raw)) return p;
  if (typeof raw.totalSeconds === 'number' && raw.totalSeconds >= 0) p.totalSeconds = raw.totalSeconds;
  if (isObj(raw.daily)) {
    for (const [day, sec] of Object.entries(raw.daily)) if (/^\d{4}-\d\d-\d\d$/.test(day) && typeof sec === 'number' && sec >= 0) p.daily[day] = sec;
  }
  if (Array.isArray(raw.sessions)) {
    p.sessions = raw.sessions
      .filter((s): s is PracticeResult => isObj(s) && typeof s.lessonId === 'string' && typeof s.accuracy === 'number' && typeof s.mode === 'string' && typeof s.at === 'string')
      .map((s) => ({ ...s, issues: Array.isArray(s.issues) ? s.issues : [] }))
      .slice(-MAX_SESSIONS);
  }
  if (isObj(raw.lessons)) {
    for (const [id, l] of Object.entries(raw.lessons)) {
      if (!isObj(l)) continue;
      const lesson = emptyLesson();
      if (typeof l.attempts === 'number') lesson.attempts = l.attempts;
      if (isObj(l.best)) for (const [m, v] of Object.entries(l.best)) if (m in PASS_ACCURACY && typeof v === 'number') lesson.best[m as keyof typeof PASS_ACCURACY] = v;
      if (Array.isArray(l.passed)) lesson.passed = l.passed.filter((m): m is keyof typeof PASS_ACCURACY => typeof m === 'string' && m in PASS_ACCURACY);
      lesson.watched = l.watched === true;
      if (typeof l.lastPlayed === 'string') lesson.lastPlayed = l.lastPlayed;
      if (isObj(l.weakNotes)) for (const [k, v] of Object.entries(l.weakNotes)) if (typeof v === 'number') lesson.weakNotes[k] = v;
      p.lessons[id] = lesson;
    }
  }
  return p;
}

/** Local calendar day of a date, YYYY-MM-DD. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Add practice time (seconds) to today and the total. Returns a new object. */
export function addPracticeTime(p: AcademyProgress, seconds: number, now: Date): AcademyProgress {
  if (!(seconds > 0)) return p;
  const key = dayKey(now);
  return { ...p, totalSeconds: p.totalSeconds + seconds, daily: { ...p.daily, [key]: (p.daily[key] ?? 0) + seconds } };
}

/** Store a finished run. Returns a new object. */
export function recordResult(p: AcademyProgress, r: PracticeResult): AcademyProgress {
  const lesson: LessonProgress = { ...(p.lessons[r.lessonId] ?? emptyLesson()) };
  lesson.attempts += 1;
  lesson.lastPlayed = r.at;
  lesson.weakNotes = { ...lesson.weakNotes };
  for (const issue of r.issues) {
    const key = String(issue.index);
    const weight = Math.max(1, issue.wrong + (issue.missed ? 1 : 0) + (issue.timing ? 1 : 0));
    lesson.weakNotes[key] = (lesson.weakNotes[key] ?? 0) + weight;
  }
  if (r.range === 'full') {
    lesson.best = { ...lesson.best, [r.mode]: Math.max(lesson.best[r.mode] ?? 0, r.accuracy) };
    if (r.accuracy >= PASS_ACCURACY[r.mode] && !lesson.passed.includes(r.mode)) lesson.passed = [...lesson.passed, r.mode];
  }
  const sessions = [...p.sessions, r].slice(-MAX_SESSIONS);
  return { ...p, lessons: { ...p.lessons, [r.lessonId]: lesson }, sessions };
}

export function markWatched(p: AcademyProgress, lessonId: string, at: Date): AcademyProgress {
  const lesson: LessonProgress = { ...(p.lessons[lessonId] ?? emptyLesson()), watched: true, lastPlayed: at.toISOString() };
  return { ...p, lessons: { ...p.lessons, [lessonId]: lesson } };
}

/** A lesson is complete when Watch was played through and Step, Guided and Perform were passed. */
export function lessonComplete(l: LessonProgress | undefined): boolean {
  return !!l && l.watched && (['step', 'guided', 'perform'] as const).every((m) => l.passed.includes(m));
}

/** Completion 0–1: Watch + three passed modes, a quarter each. */
export function lessonCompletion(l: LessonProgress | undefined): number {
  if (!l) return 0;
  return ((l.watched ? 1 : 0) + l.passed.length) / 4;
}

/** The note indices that went wrong most often, worst first. */
export function weakestNotes(l: LessonProgress | undefined, count = 3): number[] {
  if (!l) return [];
  return Object.entries(l.weakNotes)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    .slice(0, count)
    .map(([k]) => Number(k));
}

/** The mode to suggest next: the first one in teaching order that is not done yet. */
export function recommendedMode(l: LessonProgress | undefined): PracticeMode {
  if (!l || !l.watched) return 'watch';
  for (const m of ['step', 'guided', 'perform'] as const) if (!l.passed.includes(m)) return m;
  return 'perform';
}
