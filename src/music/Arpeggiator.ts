import type { Clock, Tick } from '../audio/Clock';
import { ARP_RATES, arpPatternById, DEFAULT_ARP, type ArpSettings } from '../data/arpPatterns';

/**
 * Arpeggiator — turns held keys into a rhythmic sequence on the clock grid.
 *
 * It does not make sound itself: it calls `play(key, velocity, when, until)`
 * for each note, with exact audio-clock times, and the performance router
 * plays it through the normal voice engine (so layers, octave, transpose and
 * effects all apply).
 *
 * Timing: steps sit on the clock's tick grid (24 per quarter note). If the
 * clock is already running — the metronome is on — the arpeggio locks to its
 * beat. Otherwise the first key starts the clock and the first note sounds at
 * once.
 */

export interface ArpNote {
  key: number;
  velocity: number;
}

export type ArpPlay = (key: number, velocity: number, when: number, until: number) => void;

const HOLDER = 'arpeggiator';

/** The note order for one pass, as [key, velocity] pairs. Pure — unit tested. */
export function arpSequence(held: ArpNote[], settings: ArpSettings, random: () => number = Math.random): ArpNote[][] {
  if (held.length === 0) return [];
  const sorted = [...held].sort((a, b) => a.key - b.key);
  const octaves = Math.max(1, Math.min(4, Math.round(settings.octaves)));
  const spread = (notes: ArpNote[]): ArpNote[] => {
    const out: ArpNote[] = [];
    for (let o = 0; o < octaves; o++) for (const n of notes) out.push({ key: n.key + 12 * o, velocity: n.velocity });
    return out;
  };

  switch (settings.mode) {
    case 'up':
      return spread(sorted).map((n) => [n]);
    case 'down':
      return spread(sorted)
        .reverse()
        .map((n) => [n]);
    case 'updown': {
      const up = spread(sorted);
      // do not repeat the top and bottom notes at the turning points
      const down = up.slice(1, -1).reverse();
      return [...up, ...down].map((n) => [n]);
    }
    case 'order':
      return spread(held).map((n) => [n]);
    case 'random': {
      const pool = spread(sorted);
      return pool.map(() => [pool[Math.floor(random() * pool.length)]]);
    }
    case 'chord': {
      const out: ArpNote[][] = [];
      for (let o = 0; o < octaves; o++) out.push(sorted.map((n) => ({ key: n.key + 12 * o, velocity: n.velocity })));
      return out;
    }
    case 'pattern': {
      const pattern = arpPatternById(settings.pattern);
      const out: ArpNote[][] = [];
      for (let o = 0; o < octaves; o++) {
        for (const step of pattern.steps) {
          if (step.note === null) {
            out.push([]);
            continue;
          }
          const accent = step.accent ?? 1;
          const shift = 12 * (o + (step.octave ?? 0));
          const pick = (i: number): ArpNote => {
            // indices past the top of the chord continue an octave higher
            const base = sorted[i % sorted.length];
            const wrap = Math.floor(i / sorted.length) * 12;
            return { key: base.key + wrap + shift, velocity: Math.max(1, Math.min(127, Math.round(base.velocity * accent))) };
          };
          out.push(step.chord ? sorted.map((_, i) => pick(i)) : [pick(step.note)]);
        }
      }
      return out;
    }
  }
}

export class Arpeggiator {
  private settings: ArpSettings = { ...DEFAULT_ARP };
  /** Keys physically down. */
  private readonly down = new Map<number, number>();
  /** Notes the arpeggio is built from (kept after release when latched), in the order played. */
  private notes: ArpNote[] = [];
  private step = 0;
  /** Tick on which the next step falls; −1 = start on the next tick. */
  private nextTick = -1;
  private sequence: ArpNote[][] = [];
  private dirty = true;

  constructor(
    private readonly clock: Clock,
    private readonly play: ArpPlay,
  ) {
    clock.events.on('tick', (tick) => this.onTick(tick));
  }

  get isOn(): boolean {
    return this.settings.on;
  }

  get isRunning(): boolean {
    return this.clock.isHeldBy(HOLDER);
  }

  configure(settings: ArpSettings): void {
    const wasOn = this.settings.on;
    const wasLatched = this.settings.latch;
    this.settings = { ...settings };
    this.dirty = true;
    if (wasOn && !settings.on) this.reset();
    // Latch switched off: forget notes whose keys are no longer down.
    if (wasLatched && !settings.latch) {
      this.notes = this.notes.filter((n) => this.down.has(n.key));
      if (this.notes.length === 0) this.stop();
    }
  }

  keyDown(key: number, velocity: number): void {
    if (this.settings.latch && this.down.size === 0) {
      // A new chord after all keys were lifted replaces the latched one.
      this.notes = [];
      this.step = 0;
    }
    this.down.set(key, velocity);
    this.notes = this.notes.filter((n) => n.key !== key);
    this.notes.push({ key, velocity });
    this.dirty = true;
    if (!this.isRunning) {
      this.step = 0;
      this.nextTick = -1;
      // First note almost at once when the clock was idle.
      this.clock.acquire(HOLDER, 0.012);
    }
  }

  keyUp(key: number): void {
    this.down.delete(key);
    if (this.settings.latch) return;
    this.notes = this.notes.filter((n) => n.key !== key);
    this.dirty = true;
    if (this.notes.length === 0) this.stop();
  }

  /** Stop and forget everything (panic, arpeggiator switched off, power off). */
  reset(): void {
    this.down.clear();
    this.notes = [];
    this.stop();
  }

  private stop(): void {
    this.step = 0;
    this.nextTick = -1;
    this.clock.release(HOLDER);
  }

  private onTick(tick: Tick): void {
    if (!this.settings.on || this.notes.length === 0 || !this.isRunning) return;
    const ticks = ARP_RATES.find((r) => r.id === this.settings.rate)?.ticks ?? 6;
    if (this.nextTick < 0) {
      // Lock onto the grid: the next tick that is a multiple of the step length.
      const ahead = tick.index % ticks;
      this.nextTick = ahead === 0 ? tick.index : tick.index + (ticks - ahead);
    }
    if (tick.index < this.nextTick) return;
    this.nextTick = tick.index + ticks;

    if (this.dirty) {
      this.sequence = arpSequence(this.notes, this.settings);
      this.dirty = false;
    }
    const seq = this.sequence;
    if (seq.length === 0) return;
    const index = this.step % seq.length;
    // "Random" draws fresh notes on every pass.
    if (index === 0 && this.settings.mode === 'random' && this.step > 0) {
      this.sequence = arpSequence(this.notes, this.settings);
    }
    const stepSeconds = ticks * tick.duration;
    // swing: every second step arrives late
    const late = this.step % 2 === 1 ? (stepSeconds * this.settings.swing) / 100 : 0;
    const when = tick.time + late;
    let length = (stepSeconds * this.settings.gate) / 100;
    if (this.settings.mode === 'pattern') {
      const pattern = arpPatternById(this.settings.pattern);
      length *= pattern.steps[index % pattern.steps.length].length ?? 1;
    }
    for (const n of this.sequence[index]) this.play(n.key, n.velocity, when, when + Math.max(0.02, length));
    this.step++;
  }
}
