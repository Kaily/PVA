/**
 * LessonEngine — the Piano Academy's teacher.
 *
 * Runs one lesson song in one of four practice modes:
 *
 *   watch    Watch and Listen — the instrument plays the melody and lights
 *            each key as it sounds.
 *   step     Step-by-Step — one green key at a time; the lesson moves on when
 *            the right key is pressed. No timing.
 *   guided   Guided Practice — the player plays along with a slow metronome
 *            (one bar of count-in); every note is checked for the right key
 *            and approximate timing.
 *   perform  Independent Performance — no help on the keys; what was played
 *            is compared with the melody afterwards.
 *
 * It sits on the instrument's own engines and never goes through React for
 * anything time-critical:
 *
 *   KeyboardController 'key' events ─▶ input (mouse, computer keys, MIDI)
 *   Clock 'tick' (24 per beat, audio clock) ─▶ lesson timeline ─▶ controller.playNote / metronome.clickAt
 *   visual queue (drained at the moment a sound is heard) ─▶ KeyHighlighter (class toggles)
 *
 * The small `store` holds what the Academy panel shows (current note,
 * feedback, results) and changes a few times per second at most.
 */
import type { AudioEngine } from '../audio/AudioEngine';
import type { Clock, Tick } from '../audio/Clock';
import type { Metronome } from '../audio/Metronome';
import type { Voice } from '../audio/VoiceManager';
import { onFrame } from '../core/frame';
import { createStore, type Store } from '../core/store';
import type { KeyboardController } from '../input/KeyboardController';
import type { MidiManager } from '../midi/MidiManager';
import { noteName } from '../music/notes';
import type { StorageManager } from '../storage/StorageManager';
import { HAPPY_BIRTHDAY } from './content';
import { KeyHighlighter, type MarkedKey } from './KeyHighlighter';
import { addPracticeTime, emptyProgress, markWatched, recordResult, sanitizeProgress, type AcademyProgress } from './progress';
import { guidedResult, performResult, stepResult, type PracticeMode, type PracticeResult } from './scoring';
import { durationLabel, TICKS_PER_BEAT, type CompiledSong, type TimedNote } from './song';
import { GuidedMatcher, MATCH_WINDOW_BEATS, wrongKeyHint, type PlayedNote } from './validation';

export type { PracticeMode } from './scoring';
export type LessonStatus = 'ready' | 'countin' | 'running' | 'paused' | 'finished';
export type InputFilter = 'all' | 'computer' | 'midi';
export type NoteMark = 'pending' | 'ok' | 'fixed' | 'bad' | 'missed';
export type FeedbackTone = 'info' | 'good' | 'warn' | 'bad' | 'gold';

export interface Feedback {
  tone: FeedbackTone;
  text: string;
  /** Changes with every message, so the panel can restart its fade-in. */
  key: number;
}

export interface AcademyState {
  open: boolean;
  songId: string;
  mode: PracticeMode;
  status: LessonStatus;
  /** Note the lesson is on (the one to play, or the one sounding in Watch). */
  index: number;
  /** null = whole song, else the phrase (0-based) being practised. */
  phrase: number | null;
  loop: boolean;
  tempo: number;
  metronome: boolean;
  /** Guided mode: play the melody quietly along. */
  guideMelody: boolean;
  showFingers: boolean;
  showNames: boolean;
  input: InputFilter;
  marks: NoteMark[];
  phraseDone: boolean[];
  /** Count-in / beat read-out ("1", "2", "3"), null when not counting. */
  count: string | null;
  /** Beat in the bar (0-based) of the last heard beat, for the beat lamps; -1 when stopped. */
  beat: number;
  feedback: Feedback | null;
  live: { correct: number; wrong: number; missed: number; played: number };
  result: PracticeResult | null;
  progress: AcademyProgress;
}

export interface AcademyDeps {
  engine: AudioEngine;
  clock: Clock;
  metronome: Metronome;
  controller: KeyboardController;
  midi: MidiManager;
  storage: StorageManager;
}

interface Runner {
  kind: 'watch' | 'guided' | 'preview' | 'clicks';
  active: boolean;
  aligned: boolean;
  /** Song tick of the next clock tick. */
  cursor: number;
  /** Where a loop jumps back to. */
  loopTo: number;
  /** Tick at which the run (or one pass of a loop) ends. */
  endTick: number;
  /** Notes [from, to) belong to this run. */
  from: number;
  to: number;
}

interface Visual {
  time: number;
  fn: () => void;
}

const HOLDER = 'academy';
const STORAGE_KEY = 'academy';
const PLAY_VELOCITY = 84;
const GUIDE_VELOCITY = 40;
/** Played notes are held for this share of their written length, so repeated notes are heard as two. */
const LEGATO = 0.9;
/** A second key arriving within this time of a wrong one is treated as the same, simultaneous press. */
const CHORD_GRACE_MS = 45;
const PERFORM_IDLE_MS = 7000;

let feedbackKey = 0;

export class LessonEngine {
  readonly store: Store<AcademyState>;
  readonly keys = new KeyHighlighter();

  private song: CompiledSong = HAPPY_BIRTHDAY;
  private readonly byTick = new Map<number, TimedNote>();
  private runner: Runner | null = null;
  private lastTick: { time: number; songTick: number; dur: number } | null = null;
  private visuals: Visual[] = [];
  private voices: Voice[] = [];
  private frameOff: (() => void) | null = null;
  private timer = 0;

  /* per-run state */
  private matcher: GuidedMatcher | null = null;
  private extra = 0;
  private wrongPerNote: number[] = [];
  private played: PlayedNote[] = [];
  private runStarted = 0;
  private lastInput = 0;
  private pendingWrong: { token: number; timer: number; at: number; commit: () => void } | null = null;
  private wrongToken = 0;
  private lastCorrect: { midi: number; at: number } | null = null;
  private performTimer = 0;
  private guidedTarget = -2;
  private unsavedSeconds = 0;

  constructor(private readonly deps: AcademyDeps) {
    for (const n of this.song.notes) this.byTick.set(n.startTick, n);
    const progress = sanitizeProgress(deps.storage.load<unknown>(STORAGE_KEY, emptyProgress()));
    this.store = createStore<AcademyState>({
      open: false,
      songId: this.song.def.id,
      mode: 'watch',
      status: 'ready',
      index: 0,
      phrase: null,
      loop: false,
      tempo: this.song.def.tempo.default,
      metronome: true,
      guideMelody: false,
      showFingers: true,
      showNames: true,
      input: 'all',
      marks: this.song.notes.map(() => 'pending'),
      phraseDone: this.song.phrases.map(() => false),
      count: null,
      beat: -1,
      feedback: null,
      live: { correct: 0, wrong: 0, missed: 0, played: 0 },
      result: null,
      progress,
    });
    deps.clock.events.on('tick', this.onTick);
    deps.controller.events.on('key', (e) => this.onKey(e.key, e.down, e.source));
    deps.midi.events.on('disconnected', ({ name }) => {
      if (!this.s.open) return;
      if (this.s.status === 'running' || this.s.status === 'countin') {
        if (this.s.mode === 'watch' || this.s.mode === 'guided') this.pause();
      }
      this.say('warn', `MIDI keyboard "${name}" हट गया। दोबारा लगाएँ, या computer keyboard / mouse से बजाएँ।`);
    });
  }

  /* ---------------------------------------------------------------- */
  /* small helpers                                                     */
  /* ---------------------------------------------------------------- */

  private get s(): AcademyState {
    return this.store.get();
  }

  private set(patch: Partial<AcademyState>): void {
    this.store.set(patch);
  }

  get compiled(): CompiledSong {
    return this.song;
  }

  private say(tone: FeedbackTone, text: string): void {
    this.set({ feedback: { tone, text, key: ++feedbackKey } });
  }

  /** Notes [from, to) of the current range. */
  range(): { from: number; to: number; label: string } {
    const p = this.s.phrase;
    if (p === null) return { from: 0, to: this.song.notes.length, label: 'full' };
    const ph = this.song.phrases[p];
    return { from: ph.first, to: ph.end, label: `phrase-${p + 1}` };
  }

  private barStart(tick: number): number {
    return Math.floor(tick / this.song.ticksPerBar) * this.song.ticksPerBar;
  }

  private ceilBar(tick: number): number {
    return Math.ceil(tick / this.song.ticksPerBar) * this.song.ticksPerBar;
  }

  private beatInBar(songTick: number): number {
    const beats = this.song.beatsPerBar;
    return (((Math.round(songTick / TICKS_PER_BEAT)) % beats) + beats) % beats;
  }

  /** Song position (beats) at an audio-clock time, from the latest scheduled tick. */
  private songBeat(time: number): number {
    const t = this.lastTick;
    if (!t) return -Infinity;
    return (t.songTick + (time - t.time) / t.dur) / TICKS_PER_BEAT;
  }

  private marked(i: number): MarkedKey | null {
    const n = this.song.notes[i];
    return n ? { midi: n.midi, finger: n.finger } : null;
  }

  private upcoming(from: number, count: number, to: number): MarkedKey[] {
    const list: MarkedKey[] = [];
    for (let i = from; i < Math.min(to, from + count); i++) list.push(this.marked(i)!);
    return list;
  }

  private queue(time: number, fn: () => void): void {
    const v = this.visuals;
    let i = v.length;
    while (i > 0 && v[i - 1].time > time) i--;
    v.splice(i, 0, { time, fn });
  }

  /* ---------------------------------------------------------------- */
  /* open / close                                                      */
  /* ---------------------------------------------------------------- */

  open(): void {
    if (this.s.open) return;
    this.set({ open: true });
    this.deps.clock.setTempo(this.s.tempo);
    this.keys.showFingers = this.s.showFingers;
    this.keys.showNames = this.s.showNames;
    this.frameOff = onFrame(this.frame);
    this.timer = window.setInterval(this.everySecond, 1000);
    this.reset();
  }

  close(): void {
    if (!this.s.open) return;
    this.stop();
    this.flushTime();
    this.frameOff?.();
    this.frameOff = null;
    window.clearInterval(this.timer);
    this.keys.clear();
    this.set({ open: false });
  }

  /* ---------------------------------------------------------------- */
  /* settings                                                          */
  /* ---------------------------------------------------------------- */

  setMode(mode: PracticeMode): void {
    if (mode === this.s.mode && this.s.status === 'ready') return;
    this.stop();
    this.set({ mode });
    this.reset();
  }

  /** null = whole song. */
  setPhrase(phrase: number | null): void {
    this.stop();
    this.set({ phrase });
    this.reset();
  }

  setLoop(loop: boolean): void {
    this.set({ loop });
  }

  setTempo(bpm: number): void {
    const { min, max } = this.song.def.tempo;
    const tempo = Math.max(min, Math.min(max, Math.round(bpm)));
    this.set({ tempo });
    if (this.s.open) this.deps.clock.setTempo(tempo); // applies from the next tick — no jump
  }

  setMetronome(on: boolean): void {
    this.set({ metronome: on });
  }

  setGuideMelody(on: boolean): void {
    this.set({ guideMelody: on });
  }

  setShowFingers(on: boolean): void {
    this.set({ showFingers: on });
    this.keys.showFingers = on;
    this.refreshKeys();
  }

  setShowNames(on: boolean): void {
    this.set({ showNames: on });
    this.keys.showNames = on;
    this.refreshKeys();
  }

  setInput(input: InputFilter): void {
    this.set({ input });
  }

  /* ---------------------------------------------------------------- */
  /* transport                                                         */
  /* ---------------------------------------------------------------- */

  /** Back to the beginning of the range, nothing running. */
  reset(): void {
    this.stop();
    const { from, to } = this.range();
    this.matcher = null;
    this.extra = 0;
    this.wrongPerNote = this.song.notes.map(() => 0);
    this.played = [];
    this.guidedTarget = -2;
    const marks = this.song.notes.map(() => 'pending' as NoteMark);
    this.set({
      status: 'ready',
      index: from,
      marks,
      phraseDone: this.song.phrases.map(() => false),
      count: null,
      beat: -1,
      live: { correct: 0, wrong: 0, missed: 0, played: 0 },
      result: null,
    });
    this.keys.clear();
    const first = this.song.notes[from];
    switch (this.s.mode) {
      case 'watch':
        this.say('info', 'Play दबाएँ — piano पूरा गाना बजाएगा और हर key हरी होकर दिखेगी। ध्यान से सुनें और देखें।');
        break;
      case 'step':
        this.keys.set(this.marked(from), this.upcoming(from + 1, 2, to));
        this.say('info', `हरी key दबाएँ: ${first.name}, उँगली ${first.finger}। समय की चिंता न करें — सही key पर lesson आगे बढ़ेगा।`);
        break;
      case 'guided':
        this.keys.set(this.marked(from), this.upcoming(from + 1, 2, to));
        this.say('info', `Start दबाएँ। पहले एक bar की गिनती (1-2-3) होगी, फिर "1-2" के बाद ${first.name} से शुरू करें।`);
        break;
      case 'perform':
        this.say('info', `अब कोई मदद नहीं दिखेगी। Start दबाकर ${first.name} से शुरू करें और अपनी रफ़्तार से पूरा गाना बजाएँ।`);
        break;
    }
  }

  /** Stop everything that runs on the clock; keeps the per-run results. */
  private stop(): void {
    if (this.runner) {
      this.runner.active = false;
      this.runner = null;
    }
    this.deps.clock.release(HOLDER);
    this.deps.controller.cutNotes(this.voices);
    this.voices = [];
    this.visuals = [];
    this.lastTick = null;
    window.clearTimeout(this.performTimer);
    if (this.pendingWrong) window.clearTimeout(this.pendingWrong.timer);
    this.pendingWrong = null;
    for (const n of this.song.notes) this.keys.play(n.midi, false);
  }

  /** Start (or restart) the current mode from the beginning of the range. */
  start(): void {
    this.reset();
    const { from, to } = this.range();
    const first = this.song.notes[from];
    const last = this.song.notes[to - 1];
    const lastEnd = last.startTick + last.durationTicks;
    this.runStarted = performance.now();
    switch (this.s.mode) {
      case 'watch':
        this.run({ kind: 'watch', cursor: first.startTick, loopTo: this.barStart(first.startTick), endTick: this.s.loop ? this.ceilBar(lastEnd) : lastEnd, from, to });
        this.set({ status: 'running' });
        this.say('info', 'सुनिए… हर note के साथ उसकी key हरी होगी।');
        break;
      case 'step':
        this.set({ status: 'running' });
        this.keys.set(this.marked(from), this.upcoming(from + 1, 2, to));
        break;
      case 'guided': {
        this.matcher = new GuidedMatcher(this.song.notes, from, to);
        const tail = Math.round(MATCH_WINDOW_BEATS * TICKS_PER_BEAT) + 2;
        const bar = this.barStart(first.startTick);
        this.run({ kind: 'guided', cursor: bar - this.song.ticksPerBar, loopTo: bar, endTick: this.s.loop ? this.ceilBar(lastEnd + tail) : lastEnd + tail, from, to });
        this.set({ status: 'countin' });
        this.say('info', 'गिनती सुनें: 1 – 2 – 3, 1 – 2 … और बजाएँ!');
        break;
      }
      case 'perform':
        this.set({ status: 'running' });
        if (this.s.metronome) this.run({ kind: 'clicks', cursor: 0, loopTo: 0, endTick: Number.MAX_SAFE_INTEGER, from, to });
        this.say('info', `शुरू करें — ${first.name} से। ख़त्म होने पर "Finish" दबाएँ (या आख़िरी note के बाद अपने-आप रुक जाएगा)।`);
        break;
    }
  }

  private run(r: Omit<Runner, 'active' | 'aligned'>): void {
    this.runner = { ...r, active: true, aligned: false };
    this.lastTick = null;
    // A short lead: the panel re-renders for the start before the first note, so the first key lights on time.
    this.deps.clock.acquire(HOLDER, 0.3);
  }

  togglePlay(): void {
    const st = this.s.status;
    if (st === 'running' || st === 'countin') this.pause();
    else if (st === 'paused') this.resume();
    else this.start();
  }

  pause(): void {
    const st = this.s.status;
    if (st !== 'running' && st !== 'countin') return;
    const mode = this.s.mode;
    if (mode === 'step' || mode === 'perform') return; // nothing runs on the clock
    const r = this.runner;
    this.stop();
    this.set({ status: 'paused', count: null, beat: -1 });
    if (mode === 'guided' && this.matcher) {
      // The phrase that was being played is played again after the pause.
      const target = this.firstPending(r?.from ?? 0, r?.to ?? this.song.notes.length);
      const ph = this.song.phrases[this.song.notes[Math.min(target, this.song.notes.length - 1)].phrase];
      const from = Math.max(ph.first, r?.from ?? 0);
      const to = Math.min(ph.end, r?.to ?? this.song.notes.length);
      this.matcher.reset(from, to);
      const marks = [...this.s.marks];
      for (let i = from; i < to; i++) marks[i] = 'pending';
      this.set({ marks, index: from });
      this.keys.set(this.marked(from), this.upcoming(from + 1, 2, to));
      this.say('info', `रुका हुआ। Resume पर ${ph.title} फिर से (गिनती के साथ) शुरू होगा।`);
    } else {
      this.say('info', 'रुका हुआ। Resume दबाएँ — यहीं से आगे चलेगा।');
    }
    this.resumeFrom = r ? { from: r.from, to: r.to } : null;
  }

  private resumeFrom: { from: number; to: number } | null = null;

  resume(): void {
    if (this.s.status !== 'paused') return;
    const { from, to } = this.resumeFrom ?? this.range();
    const last = this.song.notes[to - 1];
    const lastEnd = last.startTick + last.durationTicks;
    const at = this.song.notes[this.s.index];
    if (this.s.mode === 'watch') {
      const cursor = Math.floor(at.startTick / TICKS_PER_BEAT) * TICKS_PER_BEAT;
      const first = this.song.notes[from];
      this.run({ kind: 'watch', cursor, loopTo: this.barStart(first.startTick), endTick: this.s.loop ? this.ceilBar(lastEnd) : lastEnd, from, to });
      this.set({ status: 'running' });
    } else if (this.s.mode === 'guided') {
      const tail = Math.round(MATCH_WINDOW_BEATS * TICKS_PER_BEAT) + 2;
      const bar = this.barStart(at.startTick);
      this.run({ kind: 'guided', cursor: bar - this.song.ticksPerBar, loopTo: this.barStart(this.song.notes[from].startTick), endTick: this.s.loop ? this.ceilBar(lastEnd + tail) : lastEnd + tail, from, to });
      this.set({ status: 'countin' });
      this.say('info', 'गिनती के बाद फिर से बजाएँ।');
    }
  }

  /** Step mode / Watch: back to the start of the phrase the lesson is on. */
  repeatPhrase(): void {
    const ph = this.song.phrases[this.song.notes[this.s.index].phrase];
    if (this.s.mode === 'step') {
      const { from, to } = this.range();
      const first = Math.max(from, ph.first);
      const marks = [...this.s.marks];
      for (let i = first; i < Math.min(to, ph.end); i++) marks[i] = 'pending';
      const phraseDone = [...this.s.phraseDone];
      phraseDone[ph.index] = false;
      this.set({ index: first, marks, phraseDone, status: this.s.status === 'finished' ? 'running' : this.s.status, result: null });
      this.keys.set(this.marked(first), this.upcoming(first + 1, 2, to));
      this.say('info', `${ph.title} फिर से — हरी key ${this.song.notes[first].name} से।`);
    } else {
      this.setPhrase(ph.index);
      this.start();
    }
  }

  /** Play the note the lesson is on (Step mode "listen"). */
  listen(): void {
    const n = this.song.notes[this.s.index];
    if (!n) return;
    const now = this.deps.engine.ctx.currentTime + 0.02;
    const len = (n.beats * 60) / this.s.tempo;
    this.voices.push(...this.deps.controller.playNote(n.midi, PLAY_VELOCITY, now, now + len * LEGATO));
    this.keys.play(n.midi, true);
    window.setTimeout(() => this.keys.play(n.midi, false), len * LEGATO * 1000);
  }

  /** Step mode: hear the phrase the lesson is on, without leaving Step mode. */
  previewPhrase(): void {
    if (this.s.mode !== 'step' || this.runner) return;
    const ph = this.song.phrases[this.song.notes[this.s.index].phrase];
    const last = this.song.notes[ph.end - 1];
    this.run({ kind: 'preview', cursor: ph.startTick, loopTo: ph.startTick, endTick: last.startTick + last.durationTicks, from: ph.first, to: ph.end });
    this.say('info', `${ph.title} सुनिए…`);
  }

  /** Independent performance: the player says they are done. */
  finishPerformance(): void {
    if (this.s.mode !== 'perform' || this.s.status !== 'running') return;
    this.finish();
  }

  /* ---------------------------------------------------------------- */
  /* clock-driven timeline (Watch, Guided, preview, practice clicks)   */
  /* ---------------------------------------------------------------- */

  private readonly onTick = (tick: Tick): void => {
    const r = this.runner;
    if (!r || !r.active) return;
    if (!r.aligned) {
      // Start on a beat of the clock, so a running metronome / arpeggio stays in step.
      if (tick.index % TICKS_PER_BEAT !== 0) return;
      r.aligned = true;
    }
    const songTick = r.cursor;
    this.lastTick = { time: tick.time, songTick, dur: tick.duration };
    if (songTick % TICKS_PER_BEAT === 0) this.onBeat(r, songTick, tick.time);
    const note = r.kind === 'clicks' ? undefined : this.byTick.get(songTick);
    if (note && note.index >= r.from && note.index < r.to) this.onNote(r, note, tick);
    r.cursor++;
    if (r.cursor >= r.endTick) this.onPassEnd(r, tick.time + tick.duration);
  };

  private onBeat(r: Runner, songTick: number, time: number): void {
    const inBar = this.beatInBar(songTick);
    const firstTick = this.song.notes[r.from].startTick;
    const counting = r.kind === 'guided' && songTick < firstTick;
    if (r.kind !== 'preview' && (this.s.metronome || counting)) this.deps.metronome.clickAt(time, inBar === 0);
    this.queue(time, () => {
      if (this.runner !== r) return;
      const patch: Partial<AcademyState> = { beat: inBar };
      if (r.kind === 'guided') {
        patch.count = counting ? String(inBar + 1) : null;
        if (!counting && this.s.status === 'countin') patch.status = 'running';
      }
      this.set(patch);
    });
  }

  private onNote(r: Runner, note: TimedNote, tick: Tick): void {
    const length = note.durationTicks * tick.duration;
    const end = tick.time + length * LEGATO;
    if (r.kind === 'guided') {
      if (this.s.guideMelody) this.voices.push(...this.deps.controller.playNote(note.midi, GUIDE_VELOCITY, tick.time, end));
      return;
    }
    this.voices.push(...this.deps.controller.playNote(note.midi, PLAY_VELOCITY, tick.time, end));
    if (this.voices.length > 48) this.voices.splice(0, this.voices.length - 48);
    this.queue(tick.time, () => {
      if (this.runner !== r) return;
      this.keys.play(note.midi, true);
      this.keys.set(this.marked(note.index), this.upcoming(note.index + 1, 2, r.to));
      if (r.kind === 'watch') {
        const marks = [...this.s.marks];
        marks[note.index] = 'ok';
        this.set({ index: note.index, marks });
      }
    });
    this.queue(end, () => {
      this.keys.play(note.midi, false);
      const ph = this.song.phrases[note.phrase];
      if (note.index === ph.end - 1 && this.runner === r) {
        this.keys.flash(this.phraseKeys(ph.index), 'gold');
        if (r.kind === 'watch') {
          const phraseDone = [...this.s.phraseDone];
          phraseDone[ph.index] = true;
          this.set({ phraseDone });
        }
      }
    });
  }

  private onPassEnd(r: Runner, time: number): void {
    if (r.kind === 'guided') {
      // Judge the pass once its last window has been heard.
      if (this.s.loop) {
        r.cursor = r.loopTo;
        const passFrom = r.from;
        const passTo = r.to;
        this.queue(time, () => {
          if (this.runner !== r || !this.matcher) return;
          this.matcher.finish();
          this.storeResult(this.buildGuided(passFrom, passTo), false);
          this.matcher.reset(passFrom, passTo);
          const marks = [...this.s.marks];
          for (let i = passFrom; i < passTo; i++) marks[i] = 'pending';
          this.set({ marks, phraseDone: this.song.phrases.map(() => false), live: { correct: 0, wrong: 0, missed: 0, played: 0 } });
          this.guidedTarget = -2;
          this.runStarted = performance.now();
        });
        return;
      }
      r.active = false;
      this.queue(time, () => this.finish());
      return;
    }
    if (r.kind === 'watch' && this.s.loop) {
      r.cursor = r.loopTo;
      this.queue(time, () => {
        if (this.runner === r) this.set({ marks: this.song.notes.map(() => 'pending'), phraseDone: this.song.phrases.map(() => false) });
      });
      return;
    }
    r.active = false;
    this.queue(time, () => {
      if (r.kind === 'preview') {
        if (this.runner === r) {
          this.runner = null;
          this.deps.clock.release(HOLDER);
          const { to } = this.range();
          this.keys.set(this.marked(this.s.index), this.upcoming(this.s.index + 1, 2, to));
          this.say('info', `अब आप बजाएँ — हरी key ${this.song.notes[this.s.index].name}।`);
        }
        return;
      }
      this.finish();
    });
  }

  private phraseKeys(phrase: number): number[] {
    const ph = this.song.phrases[phrase];
    return [...new Set(this.song.notes.slice(ph.first, ph.end).map((n) => n.midi))];
  }

  private firstPending(from: number, to: number): number {
    if (!this.matcher) return from;
    for (let i = from; i < to; i++) if (this.matcher.results[i].status === 'pending') return i;
    return to;
  }

  /** Runs every animation frame while the Academy is open. */
  private readonly frame = (): void => {
    const ctx = this.deps.engine.ctx;
    const audible = ctx.currentTime - this.deps.engine.outputDelay;
    while (this.visuals.length && this.visuals[0].time <= audible) {
      const v = this.visuals.shift()!;
      try {
        v.fn();
      } catch (err) {
        console.error('[Academy] visual update failed', err);
      }
    }
    const r = this.runner;
    if (r && r.kind === 'guided' && r.active && this.matcher && this.lastTick) {
      const missed = this.matcher.advanceTo(this.songBeat(ctx.currentTime));
      if (missed.length) {
        const marks = [...this.s.marks];
        for (const i of missed) marks[i] = this.matcher.results[i].wrong > 0 ? 'bad' : 'missed';
        const live = { ...this.s.live, missed: this.s.live.missed + missed.length };
        this.set({ marks, live });
        const n = this.song.notes[missed[missed.length - 1]];
        this.say('warn', `${n.name} ("${n.lyric}") छूट गया — कोई बात नहीं, अगले note पर ध्यान दें।`);
      }
      const target = this.firstPending(r.from, r.to);
      if (target !== this.guidedTarget) {
        this.guidedTarget = target;
        if (target < r.to) {
          this.keys.set(this.marked(target), this.upcoming(target + 1, 2, r.to));
          this.set({ index: target });
        } else {
          this.keys.set(null, []);
        }
      }
    }
    if (this.s.mode === 'perform' && this.s.status === 'running' && this.played.length >= 3 && performance.now() - this.lastInput > PERFORM_IDLE_MS) {
      this.finish();
    }
  };

  /* ---------------------------------------------------------------- */
  /* input                                                             */
  /* ---------------------------------------------------------------- */

  private accepts(source: string): boolean {
    const f = this.s.input;
    if (f === 'all') return true;
    const isMidi = source.startsWith('midi');
    return f === 'midi' ? isMidi : !isMidi;
  }

  private onKey(key: number, down: boolean, source: string): void {
    if (!this.s.open || source === 'panic' || !this.accepts(source)) return;
    if (!down) {
      if (this.s.mode === 'guided' && this.matcher && this.lastTick) {
        const e = this.matcher.release(key, this.songBeat(this.deps.engine.ctx.currentTime));
        if (e?.kind === 'short') {
          const n = this.song.notes[e.index];
          this.say('warn', `${n.name} जल्दी छोड़ दिया। यह ${durationLabel(n.beats).hi} का note है — गिनती पूरी होने तक दबाए रखें।`);
        }
      }
      return;
    }
    this.lastInput = performance.now();
    switch (this.s.mode) {
      case 'step':
        this.stepPress(key);
        break;
      case 'guided':
        this.guidedPress(key);
        break;
      case 'perform':
        this.performPress(key);
        break;
      default:
        break;
    }
  }

  private commitPendingWrong(): void {
    this.pendingWrong?.commit();
  }

  private stepPress(key: number): void {
    const st = this.s.status;
    if (st === 'finished' || this.runner) return; // results on screen, or a phrase preview is playing
    const { to } = this.range();
    const i = this.s.index;
    const note = this.song.notes[i];
    if (!note) return;
    if (st === 'ready') {
      this.runStarted = performance.now();
      this.set({ status: 'running' });
    }
    if (key !== note.midi) {
      // A wrong key pressed together with the right one (two fingers at once) is not held against the player —
      // whether it arrives just before the right key, with it, or just after it.
      const prev = this.lastCorrect;
      const together = prev !== null && performance.now() - prev.at < CHORD_GRACE_MS * 2 && this.deps.controller.isKeyDown(prev.midi);
      if (this.deps.controller.isKeyDown(note.midi) || together) {
        this.say('info', 'एक समय में एक ही key दबाएँ।');
        return;
      }
      // Judged a moment later: if the right key follows almost at once, both were pressed together.
      this.commitPendingWrong();
      const token = ++this.wrongToken;
      const commit = (): void => {
        if (this.pendingWrong?.token !== token) return;
        window.clearTimeout(this.pendingWrong.timer);
        this.pendingWrong = null;
        if (this.s.index !== i || this.s.status === 'finished') return;
        this.wrongPerNote[i]++;
        const marks = [...this.s.marks];
        marks[i] = 'bad';
        this.set({ marks, live: { ...this.s.live, wrong: this.s.live.wrong + 1 } });
        this.keys.flash([key], 'wrong');
        this.say('bad', wrongKeyHint(note.midi, key));
      };
      this.pendingWrong = { token, at: performance.now(), commit, timer: window.setTimeout(commit, CHORD_GRACE_MS) };
      return;
    }
    if (this.pendingWrong) {
      // Within the grace time the two keys were one gesture; later (e.g. a busy page delayed the timer) it was a real mistake.
      if (performance.now() - this.pendingWrong.at >= CHORD_GRACE_MS) this.commitPendingWrong();
      else {
        window.clearTimeout(this.pendingWrong.timer);
        this.pendingWrong = null;
      }
    }
    this.lastCorrect = { midi: key, at: performance.now() };
    const marks = [...this.s.marks];
    marks[i] = this.wrongPerNote[i] > 0 ? 'fixed' : 'ok';
    const next = i + 1;
    const ph = this.song.phrases[note.phrase];
    const live = { ...this.s.live, correct: this.s.live.correct + 1 };
    if (i === ph.end - 1) {
      const phraseDone = [...this.s.phraseDone];
      phraseDone[ph.index] = true;
      this.set({ marks, phraseDone, live });
      this.keys.flash(this.phraseKeys(ph.index), 'gold');
      if (next < to) this.say('gold', `${ph.title} पूरा हुआ! अगला phrase: ${this.song.phrases[ph.index + 1].lyric}।`);
    } else {
      this.set({ marks, live });
      const n2 = this.song.notes[next];
      const tip = n2.shift ? ` ${n2.shift}` : '';
      this.say('good', `सही! ${note.name} ✓  अब ${n2.name}, उँगली ${n2.finger}।${tip}`);
    }
    if (next >= to) {
      if (this.s.loop) {
        this.storeResult(this.buildStep(), false);
        this.say('gold', 'बहुत बढ़िया! फिर से — Loop चालू है।');
        const { from } = this.range();
        this.wrongPerNote = this.song.notes.map(() => 0);
        const fresh = [...this.s.marks];
        for (let k = from; k < to; k++) fresh[k] = 'pending';
        this.set({ index: from, marks: fresh, phraseDone: this.song.phrases.map(() => false) });
        this.keys.set(this.marked(from), this.upcoming(from + 1, 2, to));
        this.runStarted = performance.now();
        return;
      }
      this.set({ index: i });
      this.finish();
      return;
    }
    this.set({ index: next });
    this.keys.set(this.marked(next), this.upcoming(next + 1, 2, to));
  }

  private guidedPress(key: number): void {
    const r = this.runner;
    if (!r || r.kind !== 'guided' || !this.matcher || !this.lastTick) {
      if (this.s.status !== 'finished') this.say('info', 'पहले Start दबाएँ — गिनती के बाद बजाना है।');
      return;
    }
    const beat = this.songBeat(this.deps.engine.ctx.currentTime);
    const firstBeat = this.song.notes[r.from].startTick / TICKS_PER_BEAT;
    if (beat < firstBeat - MATCH_WINDOW_BEATS) {
      this.say('info', 'अभी गिनती चल रही है… "1-2" के बाद बजाएँ।');
      return;
    }
    const e = this.matcher.press(key, beat);
    const live = { ...this.s.live };
    if (e.kind === 'hit') {
      live.correct++;
      const marks = [...this.s.marks];
      marks[e.index] = e.verdict === 'on-time' ? 'ok' : 'fixed';
      const n = this.song.notes[e.index];
      const ph = this.song.phrases[n.phrase];
      const phraseClean = this.matcher.results.slice(ph.first, ph.end).every((x) => x.status === 'hit');
      if (e.index === ph.end - 1 && phraseClean) {
        const phraseDone = [...this.s.phraseDone];
        phraseDone[ph.index] = true;
        this.set({ marks, live, phraseDone });
        this.keys.flash(this.phraseKeys(ph.index), 'gold');
        this.say('gold', `${ph.title} पूरा — हर note सही!`);
        return;
      }
      this.set({ marks, live });
      if (e.verdict === 'on-time') this.say('good', `सही! ${n.name} — समय पर ✓`);
      else this.say('warn', `${n.name} सही key — पर थोड़ा ${e.verdict === 'early' ? 'जल्दी' : 'देर से'}। गिनती के साथ बजाएँ।`);
    } else if (e.kind === 'wrong') {
      live.wrong++;
      const marks = [...this.s.marks];
      marks[e.index] = 'bad';
      this.set({ marks, live });
      this.keys.flash([key], 'wrong');
      this.say('bad', `गलत key: ${noteName(key)} — चाहिए ${noteName(e.expected)} (हरी key)।`);
    } else if (e.kind === 'extra') {
      this.extra++;
      live.wrong++;
      this.set({ live });
      this.keys.flash([key], 'wrong');
      this.say('warn', 'अभी कोई note नहीं था — हरी key के समय का इंतज़ार करें।');
    }
  }

  private performPress(key: number): void {
    if (this.s.status === 'ready') {
      this.runStarted = performance.now();
      this.set({ status: 'running' });
      if (this.s.metronome && !this.runner) {
        const { from, to } = this.range();
        this.run({ kind: 'clicks', cursor: 0, loopTo: 0, endTick: Number.MAX_SAFE_INTEGER, from, to });
      }
    }
    if (this.s.status !== 'running') return;
    this.played.push({ midi: key, time: this.deps.engine.ctx.currentTime });
    this.set({ live: { ...this.s.live, played: this.played.length } });
    // Ends by itself once the last two notes of the melody have been played.
    const { from, to } = this.range();
    const expected = this.song.notes.slice(from, to);
    const n = this.played.length;
    window.clearTimeout(this.performTimer);
    if (n >= Math.ceil(expected.length * 0.6) && n >= 2) {
      const tail = expected.slice(-2).map((x) => x.midi);
      if (this.played[n - 2].midi === tail[0] && this.played[n - 1].midi === tail[1]) {
        const last = expected[expected.length - 1];
        this.performTimer = window.setTimeout(() => this.finishPerformance(), Math.min(2500, ((last.beats * 60) / this.s.tempo) * 1000));
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* results                                                           */
  /* ---------------------------------------------------------------- */

  private common(): { song: CompiledSong; tempo: number; duration: number; range: string } {
    return { song: this.song, tempo: this.s.tempo, duration: (performance.now() - this.runStarted) / 1000, range: this.range().label };
  }

  private buildStep(): PracticeResult {
    const { from, to } = this.range();
    return stepResult({ ...this.common(), wrongPerNote: this.wrongPerNote, from, to });
  }

  private buildGuided(from: number, to: number): PracticeResult {
    const results = this.matcher!.results.slice(from, to);
    return guidedResult({ ...this.common(), results, extra: this.extra });
  }

  private finish(): void {
    const mode = this.s.mode;
    const { from, to, label } = this.range();
    let result: PracticeResult | null = null;
    if (mode === 'step') result = this.buildStep();
    else if (mode === 'guided' && this.matcher) {
      this.matcher.finish();
      result = this.buildGuided(from, to);
    } else if (mode === 'perform') {
      result = performResult({ ...this.common(), played: this.played, from, to });
    }
    this.stop();
    this.set({ status: 'finished', count: null, beat: -1 });
    if (mode === 'watch') {
      if (label === 'full') this.saveProgress(markWatched(this.s.progress, this.song.def.id, new Date()));
      this.keys.set(null, []);
      this.say('gold', 'पूरा गाना सुन लिया! अब "Step-by-Step" mode में ख़ुद बजाकर देखें।');
      return;
    }
    if (!result) return;
    this.storeResult(result, true);
    this.keys.set(null, []);
    if (mode === 'perform') this.showPerformMarks(result);
  }

  /** After a performance, colour the note strip from the issues. */
  private showPerformMarks(r: PracticeResult): void {
    const { from, to } = this.range();
    const marks = [...this.s.marks];
    for (let i = from; i < to; i++) marks[i] = 'ok';
    for (const issue of r.issues) marks[issue.index] = issue.missed ? 'missed' : 'bad';
    this.set({ marks });
  }

  private storeResult(result: PracticeResult, show: boolean): void {
    this.saveProgress(recordResult(this.s.progress, result));
    if (show) {
      this.set({ result });
      this.say(result.accuracy >= 75 ? 'gold' : result.accuracy >= 50 ? 'good' : 'info', result.comment);
    } else {
      this.say('good', `पिछला दौर: ${result.accuracy}% सही।`);
    }
  }

  private saveProgress(progress: AcademyProgress): void {
    this.set({ progress });
    this.deps.storage.save(STORAGE_KEY, progress);
  }

  /** Hide the result card (the result stays stored). */
  dismissResult(): void {
    this.set({ result: null });
  }

  /** Clear all stored Academy progress. */
  resetProgress(): void {
    this.deps.storage.remove(STORAGE_KEY);
    this.set({ progress: emptyProgress() });
  }

  /* ---------------------------------------------------------------- */
  /* practice time                                                     */
  /* ---------------------------------------------------------------- */

  private readonly everySecond = (): void => {
    if (document.hidden) return;
    const st = this.s.status;
    const active = st === 'running' || st === 'countin' || performance.now() - this.lastInput < 20000;
    if (!active) return;
    this.unsavedSeconds++;
    if (this.unsavedSeconds >= 15) this.flushTime();
  };

  private flushTime(): void {
    if (this.unsavedSeconds <= 0) return;
    this.saveProgress(addPracticeTime(this.s.progress, this.unsavedSeconds, new Date()));
    this.unsavedSeconds = 0;
  }

  /** Practice seconds not yet written to storage (for the live read-out). */
  get pendingSeconds(): number {
    return this.unsavedSeconds;
  }

  private refreshKeys(): void {
    const st = this.s;
    if (!st.open || st.mode === 'perform' || st.status === 'finished') return;
    const { to } = this.range();
    this.keys.set(this.marked(st.index), this.upcoming(st.index + 1, 2, to));
  }
}
