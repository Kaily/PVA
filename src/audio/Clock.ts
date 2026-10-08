import { Emitter } from '../core/Emitter';
import { clamp } from '../core/math';

/**
 * Clock — the musical transport.
 *
 * Classic look-ahead scheduler: a coarse timer wakes up every 25 ms and
 * schedules every tick that falls inside the next 120 ms on the *audio*
 * clock, so timing is sample-accurate regardless of UI load. The timer lives
 * in a Web Worker because main-thread timers are throttled in background
 * tabs.
 *
 * Resolution is 24 ticks per quarter note (the MIDI clock grid), which gives
 * every straight and triplet subdivision down to 1/32 as a whole number of
 * ticks. The metronome listens to beats, the arpeggiator to ticks; the rhythm
 * engine and the sequencer will use the same grid, so everything stays in
 * step.
 *
 * Several users can need the clock at once. Each one acquires it under its
 * own name and releases it when done; the clock runs while anyone holds it.
 */

export const TEMPO_MIN = 20;
export const TEMPO_MAX = 255;
export const TICKS_PER_BEAT = 24;

export interface Beat {
  /** Running beat number since the clock started. */
  index: number;
  /** AudioContext time at which the beat sounds. */
  time: number;
}

export interface Tick {
  /** Running tick number since the clock started (24 per beat). */
  index: number;
  time: number;
  /** Seconds one tick lasts at the current tempo. */
  duration: number;
}

type Events = {
  /** Fired ahead of time — schedule audio at `time`. */
  beat: Beat;
  tick: Tick;
  running: boolean;
};

const LOOKAHEAD_SEC = 0.12;
const TICK_MS = 25;

const WORKER_SOURCE = `
let id = null;
onmessage = (e) => {
  if (e.data === 'start') { if (id === null) id = setInterval(() => postMessage(0), ${TICK_MS}); }
  else { clearInterval(id); id = null; }
};`;

export class Clock {
  readonly events = new Emitter<Events>();

  private bpm = 120;
  private running = false;
  private nextTime = 0;
  private tickIndex = 0;
  private worker: Worker | null = null;
  private fallbackTimer = 0;
  private readonly holders = new Set<string>();
  /** Beats scheduled but not yet heard — drained by the UI to flash LEDs in time. */
  private readonly upcoming: Beat[] = [];

  constructor(private readonly ctx: AudioContext) {}

  get tempo(): number {
    return this.bpm;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Seconds per tick at the current tempo. */
  get tickSeconds(): number {
    return 60 / this.bpm / TICKS_PER_BEAT;
  }

  /** Takes effect from the next tick, so the pulse never jumps. */
  setTempo(bpm: number): void {
    this.bpm = clamp(Math.round(bpm), TEMPO_MIN, TEMPO_MAX);
  }

  /**
   * Ask for the clock to run. The first holder starts it; `leadSeconds` is how
   * soon the first tick sounds (the metronome leaves a short gap, the
   * arpeggiator wants its first note almost at once).
   */
  acquire(holder: string, leadSeconds = 0.06): void {
    this.holders.add(holder);
    if (!this.running) this.start(leadSeconds);
  }

  release(holder: string): void {
    this.holders.delete(holder);
    if (this.holders.size === 0) this.stop();
  }

  isHeldBy(holder: string): boolean {
    return this.holders.has(holder);
  }

  private start(leadSeconds: number): void {
    this.running = true;
    this.tickIndex = 0;
    this.upcoming.length = 0;
    this.nextTime = this.ctx.currentTime + leadSeconds;
    this.startTimer();
    this.schedule();
    this.events.emit('running', true);
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stopTimer();
    this.upcoming.length = 0;
    this.events.emit('running', false);
  }

  private schedule = (): void => {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    // If the tab slept, don't fire a burst of late ticks — resynchronise.
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.02;
    const horizon = now + LOOKAHEAD_SEC;
    while (this.nextTime < horizon) {
      const duration = 60 / this.bpm / TICKS_PER_BEAT;
      const index = this.tickIndex++;
      const time = this.nextTime;
      if (index % TICKS_PER_BEAT === 0) {
        const beat: Beat = { index: index / TICKS_PER_BEAT, time };
        this.upcoming.push(beat);
        this.events.emit('beat', beat);
      }
      this.events.emit('tick', { index, time, duration });
      this.nextTime += duration;
    }
  };

  /**
   * Beats that have become audible since the last call. `audibleTime` is the
   * context time currently at the speakers (currentTime − output latency).
   */
  drainAudible(audibleTime: number): Beat[] {
    const due: Beat[] = [];
    while (this.upcoming.length && this.upcoming[0].time <= audibleTime) due.push(this.upcoming.shift()!);
    return due;
  }

  private startTimer(): void {
    try {
      if (!this.worker) {
        const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        this.worker.onmessage = this.schedule;
        this.worker.onerror = () => {
          this.worker = null;
          if (this.running && !this.fallbackTimer) this.fallbackTimer = window.setInterval(this.schedule, TICK_MS);
        };
      }
      this.worker.postMessage('start');
    } catch {
      this.fallbackTimer = window.setInterval(this.schedule, TICK_MS);
    }
  }

  private stopTimer(): void {
    this.worker?.postMessage('stop');
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = 0;
    }
  }
}
