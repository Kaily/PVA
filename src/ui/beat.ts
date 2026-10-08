import { Emitter } from '../core/Emitter';
import { onFrame } from '../core/frame';
import { services } from '../services';

/**
 * Beat visuals. The clock schedules beats ahead of time; this turns them into
 * events at the moment they are actually heard (scheduled time + output
 * latency), so the LEDs flash with the click instead of ahead of it.
 */
type BeatEvents = {
  beat: { inBar: number; accent: boolean; beats: number };
  stop: null;
};

export const beatBus = new Emitter<BeatEvents>();

let started = false;

export function startBeatVisuals(): void {
  if (started) return;
  started = true;
  const { clock, engine, metronome } = services();
  onFrame(() => {
    if (!clock.isRunning) return;
    const audible = engine.ctx.currentTime - engine.outputDelay;
    for (const beat of clock.drainAudible(audible)) {
      const beats = metronome.beatsPerBar;
      const inBar = metronome.beatInBar(beat.index);
      beatBus.emit('beat', { inBar, accent: beats > 0 && inBar === 0, beats });
    }
  });
  clock.events.on('running', (running) => {
    if (!running) beatBus.emit('stop', null);
  });
}
