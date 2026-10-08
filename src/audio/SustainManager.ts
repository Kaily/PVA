import { Emitter } from '../core/Emitter';
import type { PedalState, VoiceManager } from './VoiceManager';

/**
 * SustainManager — pedal logic for every part.
 *
 * A pedal can be held by several sources at once (panel SUSTAIN latch, the
 * space bar, a MIDI CC64 pedal). The pedal is "down" while at least one
 * source holds it and only lifts when the last one lets go, so sources can
 * never cancel each other and leave notes hanging or cut them short.
 *
 *   sustain   Note Off is deferred while down; lifting it sends every
 *             deferred note into its normal release envelope (no hard stop).
 *   sostenuto holds only the notes whose keys were down when it was pressed.
 *   soft      (una corda) makes new notes softer and mellower.
 *   expression is a level control and lives on the part (MixerEngine).
 */

export type PedalKind = 'sustain' | 'sostenuto' | 'soft';

type Events = {
  change: { partId: string; pedal: PedalKind; down: boolean };
};

interface PartPedals {
  sustain: Set<string>;
  sostenuto: Set<string>;
  soft: Set<string>;
}

/** How much the soft pedal scales incoming velocity. */
export const SOFT_PEDAL_VELOCITY = 0.72;

export class SustainManager implements PedalState {
  readonly events = new Emitter<Events>();
  private readonly parts = new Map<string, PartPedals>();

  constructor(private readonly voices: VoiceManager) {
    voices.attachPedals(this);
  }

  private state(partId: string): PartPedals {
    let p = this.parts.get(partId);
    if (!p) {
      p = { sustain: new Set(), sostenuto: new Set(), soft: new Set() };
      this.parts.set(partId, p);
    }
    return p;
  }

  isSustainDown(partId: string): boolean {
    return (this.parts.get(partId)?.sustain.size ?? 0) > 0;
  }

  isDown(partId: string, pedal: PedalKind): boolean {
    return (this.parts.get(partId)?.[pedal].size ?? 0) > 0;
  }

  /** Press or release a pedal on behalf of one source ("panel", "space", "midi"). */
  set(partId: string, pedal: PedalKind, source: string, down: boolean): void {
    const holders = this.state(partId)[pedal];
    const wasDown = holders.size > 0;
    if (down) holders.add(source);
    else holders.delete(source);
    const isDown = holders.size > 0;
    if (wasDown === isDown) return;

    if (pedal === 'sustain' && !isDown) this.voices.releaseSustained(partId);
    if (pedal === 'sostenuto') {
      if (isDown) this.voices.captureSostenuto(partId);
      else this.voices.releaseSostenuto(partId);
    }
    this.events.emit('change', { partId, pedal, down: isDown });
  }

  /** Velocity after the soft pedal. */
  applySoft(partId: string, velocity: number): number {
    return this.isDown(partId, 'soft') ? Math.max(1, Math.round(velocity * SOFT_PEDAL_VELOCITY)) : velocity;
  }

  /** Drop every hold that came from one source (e.g. a MIDI device that disappeared). */
  releaseSource(source: string): void {
    for (const partId of this.parts.keys()) {
      (['sustain', 'sostenuto', 'soft'] as const).forEach((pedal) => this.set(partId, pedal, source, false));
    }
  }

  /** Lift all pedals (panic). */
  reset(): void {
    for (const [partId, p] of this.parts) {
      (['sustain', 'sostenuto', 'soft'] as const).forEach((pedal) => {
        if (p[pedal].size === 0) return;
        p[pedal].clear();
        if (pedal === 'sustain') this.voices.releaseSustained(partId);
        if (pedal === 'sostenuto') this.voices.releaseSostenuto(partId);
        this.events.emit('change', { partId, pedal, down: false });
      });
    }
  }
}
