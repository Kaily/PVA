import { describe, expect, it } from 'vitest';
import { HAPPY_BIRTHDAY } from '../../src/academy/content';
import {
  addPracticeTime,
  emptyProgress,
  lessonComplete,
  markWatched,
  recommendedMode,
  recordResult,
  sanitizeProgress,
  weakestNotes,
} from '../../src/academy/progress';
import { guidedResult, performResult, stepResult } from '../../src/academy/scoring';
import { compileSong, parseNote, TICKS_PER_BEAT, type SongDef } from '../../src/academy/song';
import { alignPerformance, analyseRhythm, GuidedMatcher, judgeStep, timingVerdict, wrongKeyHint } from '../../src/academy/validation';
import { FIRST_KEY, LAST_KEY } from '../../src/data/keyboardLayout';

const song = HAPPY_BIRTHDAY;
const beatOf = (i: number): number => song.notes[i].startTick / TICKS_PER_BEAT;

describe('song model', () => {
  it('parses scientific note names', () => {
    expect(parseNote('C4')).toBe(60);
    expect(parseNote('G4')).toBe(67);
    expect(parseNote('C#5')).toBe(73);
    expect(parseNote('Bb3')).toBe(58);
    expect(parseNote('A0')).toBe(21);
    expect(() => parseNote('H4')).toThrow();
    expect(() => parseNote('G')).toThrow();
  });

  it('Happy Birthday has the exact melody of the lesson plan', () => {
    const phrases = song.phrases.map((p) => song.notes.slice(p.first, p.end).map((n) => n.name).join(' '));
    expect(phrases).toEqual([
      'G4 G4 A4 G4 C5 B4',
      'G4 G4 A4 G4 D5 C5',
      'G4 G4 G5 E5 C5 B4 A4',
      'F5 F5 E5 C5 D5 C5',
    ]);
    expect(song.notes[0].midi).toBe(67);
    expect(song.notes).toHaveLength(25);
  });

  it('uses real note lengths: dotted-eighth + sixteenth pickups, longer phrase ends', () => {
    for (const p of song.phrases) {
      const first = song.notes[p.first];
      const second = song.notes[p.first + 1];
      expect(first.beats).toBe(0.75);
      expect(second.beats).toBe(0.25);
      expect(first.midi).toBe(second.midi); // the repeated pickup note
    }
    expect(song.notes[5].beats).toBe(2); // "you" (B4)
    expect(song.notes[11].beats).toBe(2); // "you" (C5)
    expect(song.notes[24].beats).toBe(3); // final "you"
  });

  it('lays the song out in 3/4 with the pickup on beat 3 and ends on a bar line', () => {
    expect(song.beatsPerBar).toBe(3);
    expect(song.firstTick).toBe(2 * TICKS_PER_BEAT);
    expect(song.endTick % song.ticksPerBar).toBe(0);
    expect(song.endTick / song.ticksPerBar).toBe(9);
    // "birth-" of every phrase falls on beat 1 of a bar
    for (const p of song.phrases) expect(song.notes[p.first + 2].startTick % song.ticksPerBar).toBe(0);
    // no gaps or overlaps
    for (let i = 1; i < song.notes.length; i++) {
      expect(song.notes[i].startTick).toBe(song.notes[i - 1].startTick + song.notes[i - 1].durationTicks);
    }
  });

  it('every note is on the keybed and has a finger and a lyric', () => {
    for (const n of song.notes) {
      expect(n.midi).toBeGreaterThanOrEqual(FIRST_KEY);
      expect(n.midi).toBeLessThanOrEqual(LAST_KEY);
      expect(n.finger).toBeGreaterThanOrEqual(1);
      expect(n.finger).toBeLessThanOrEqual(5);
      expect(n.lyric.length).toBeGreaterThan(0);
    }
  });

  it('rejects broken song data', () => {
    const base: SongDef = { ...song.def, phrases: [{ title: 'x', lyric: '', tip: '', notes: [{ note: 'C4', beats: 1, finger: 1 }] }] };
    expect(() => compileSong(base)).not.toThrow();
    expect(() => compileSong({ ...base, phrases: [{ ...base.phrases[0], notes: [{ note: 'X9', beats: 1, finger: 1 }] }] })).toThrow();
    expect(() => compileSong({ ...base, phrases: [{ ...base.phrases[0], notes: [{ note: 'C4', beats: 1, finger: 6 }] }] })).toThrow();
    expect(() => compileSong({ ...base, phrases: [{ ...base.phrases[0], notes: [{ note: 'C4', beats: 0.3, finger: 1 }] }] })).toThrow();
    expect(() => compileSong({ ...base, pickupBeats: 3 })).toThrow();
  });
});

describe('step validation', () => {
  it('judges pitch only', () => {
    expect(judgeStep(67, 67).correct).toBe(true);
    expect(judgeStep(67, 69)).toEqual({ correct: false, distance: -2 });
  });

  it('explains a wrong key in Hindi, including the octave case', () => {
    expect(wrongKeyHint(67, 69)).toContain('A4');
    expect(wrongKeyHint(67, 69)).toContain('बाईं');
    expect(wrongKeyHint(67, 55)).toContain('octave');
  });
});

describe('guided matcher', () => {
  it('a perfect run hits every note on time', () => {
    const m = new GuidedMatcher(song.notes);
    for (let i = 0; i < song.notes.length; i++) {
      const e = m.press(song.notes[i].midi, beatOf(i));
      expect(e).toMatchObject({ kind: 'hit', index: i, verdict: 'on-time' });
    }
    m.finish();
    const r = guidedResult({ song, tempo: 60, duration: 30, range: 'full', results: m.judged(), extra: 0 });
    expect(r.accuracy).toBe(100);
    expect(r.timing).toBe(100);
    expect(r.issues).toEqual([]);
  });

  it('tells the two short pickup notes apart', () => {
    const m = new GuidedMatcher(song.notes);
    expect(m.press(67, 2.0)).toMatchObject({ kind: 'hit', index: 0 });
    expect(m.press(67, 2.8)).toMatchObject({ kind: 'hit', index: 1 });
    expect(m.press(69, 3.05)).toMatchObject({ kind: 'hit', index: 2 });
  });

  it('reports early, late, wrong, missed, extra and short holds', () => {
    expect(timingVerdict(-0.3)).toBe('early');
    expect(timingVerdict(0.3)).toBe('late');
    expect(timingVerdict(0.1)).toBe('on-time');
    const m = new GuidedMatcher(song.notes);
    expect(m.press(67, 1.7)).toMatchObject({ kind: 'hit', index: 0, verdict: 'early' });
    expect(m.press(60, 2.8)).toMatchObject({ kind: 'wrong', index: 1, expected: 67 });
    expect(m.press(40, 7.0)).toMatchObject({ kind: 'extra' });
    // note 1 never played correctly → missed once its window is over
    expect(m.advanceTo(3.0)).toEqual([1]);
    // A4 (1 beat) let go after a quarter of it
    expect(m.press(69, 3.3)).toMatchObject({ kind: 'hit', index: 2, verdict: 'late' });
    expect(m.release(69, 3.55)).toMatchObject({ kind: 'short', index: 2 });
    m.finish();
    const r = guidedResult({ song, tempo: 60, duration: 30, range: 'full', results: m.judged(), extra: 1 });
    expect(r.correct).toBe(2);
    expect(r.wrong).toBe(1);
    expect(r.missed).toBe(23);
    expect(r.accuracy).toBeLessThan(10);
  });

  it('judges only the practised phrase and can reset it', () => {
    const p = song.phrases[1];
    const m = new GuidedMatcher(song.notes, p.first, p.end);
    expect(m.press(67, beatOf(0))).toMatchObject({ kind: 'extra' }); // phrase 1 is not judged
    for (let i = p.first; i < p.end; i++) m.press(song.notes[i].midi, beatOf(i));
    expect(m.judged().every((r) => r.status === 'hit')).toBe(true);
    m.reset();
    expect(m.judged().every((r) => r.status === 'pending')).toBe(true);
  });
});

describe('independent performance', () => {
  const melody = song.notes.map((n) => n.midi);

  it('aligns a perfect performance', () => {
    const ops = alignPerformance(melody, melody);
    expect(ops.every((o) => o.op === 'match')).toBe(true);
  });

  it('finds a wrong, a missed and an extra note', () => {
    const played = [...melody];
    played[4] = 74; // wrong
    played.splice(10, 1); // missed
    played.splice(15, 0, 50); // extra
    const ops = alignPerformance(melody, played);
    expect(ops.filter((o) => o.op === 'wrong')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'missed')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'extra')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'match')).toHaveLength(23);
  });

  it('measures rhythm independent of the tempo the player chose', () => {
    const spb = 60 / 90; // played at 90 BPM, perfectly even
    const played = song.notes.map((n) => ({ midi: n.midi, time: 5 + (n.startTick / TICKS_PER_BEAT) * spb }));
    const r = performResult({ song, tempo: 60, duration: 20, range: 'full', played, from: 0, to: song.notes.length });
    expect(r.accuracy).toBe(100);
    expect(r.timing).toBe(100);
    expect(r.playedBpm).toBe(90);
    // all notes equally spaced — the dotted rhythm is lost
    const flat = song.notes.map((n, i) => ({ midi: n.midi, time: i * 0.6 }));
    const ops = alignPerformance(melody, melody);
    const rhythm = analyseRhythm(ops, song.notes, flat);
    expect(rhythm.steadiness!).toBeLessThan(0.7);
  });
});

describe('scoring and progress', () => {
  it('step accuracy counts wrong presses', () => {
    const wrong = new Array(song.notes.length).fill(0);
    wrong[2] = 2;
    wrong[7] = 1;
    const r = stepResult({ song, tempo: 60, duration: 50, range: 'full', wrongPerNote: wrong, from: 0, to: 25 });
    expect(r.accuracy).toBe(Math.round((25 / 28) * 100));
    expect(r.issues.map((i) => i.index)).toEqual([2, 7]);
  });

  it('records results, passes modes and finds weak notes', () => {
    let p = emptyProgress();
    const wrong = new Array(25).fill(0);
    wrong[14] = 3;
    p = recordResult(p, stepResult({ song, tempo: 60, duration: 50, range: 'full', wrongPerNote: wrong, from: 0, to: 25 }));
    const l = p.lessons['happy-birthday'];
    expect(l.attempts).toBe(1);
    expect(l.passed).toContain('step');
    expect(weakestNotes(l)).toEqual([14]);
    expect(recommendedMode(l)).toBe('watch');
    p = markWatched(p, 'happy-birthday', new Date());
    expect(recommendedMode(p.lessons['happy-birthday'])).toBe('guided');
    expect(lessonComplete(p.lessons['happy-birthday'])).toBe(false);
    // a single-phrase run is stored but does not pass a mode
    const phraseRun = stepResult({ song, tempo: 60, duration: 10, range: 'phrase-2', wrongPerNote: [], from: 6, to: 12 });
    expect(phraseRun.accuracy).toBe(100);
    p = recordResult(p, { ...phraseRun, mode: 'guided' });
    expect(p.lessons['happy-birthday'].passed).not.toContain('guided');
    expect(p.sessions).toHaveLength(2);
  });

  it('adds practice time per day', () => {
    const d = new Date(2026, 9, 8, 10);
    let p = addPracticeTime(emptyProgress(), 120, d);
    p = addPracticeTime(p, 30, d);
    expect(p.daily['2026-10-08']).toBe(150);
    expect(p.totalSeconds).toBe(150);
  });

  it('survives damaged storage', () => {
    expect(sanitizeProgress(null)).toEqual(emptyProgress());
    expect(sanitizeProgress('x')).toEqual(emptyProgress());
    const p = sanitizeProgress({ totalSeconds: -5, daily: { bad: 3, '2026-01-01': 60 }, sessions: [{ nope: 1 }], lessons: { a: 'x', b: { attempts: 2, passed: ['step', 'hack'] } } });
    expect(p.totalSeconds).toBe(0);
    expect(p.daily).toEqual({ '2026-01-01': 60 });
    expect(p.sessions).toEqual([]);
    expect(p.lessons.b.passed).toEqual(['step']);
    expect(p.lessons.a).toBeUndefined();
  });
});
