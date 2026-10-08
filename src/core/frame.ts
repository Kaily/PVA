/**
 * One shared requestAnimationFrame loop for every imperative visual
 * (meters, beat LED, wheel spring, voice counter). The loop only runs while
 * something is subscribed and pauses automatically when the tab is hidden.
 */
type FrameFn = (nowMs: number, dtMs: number) => void;

const subscribers = new Set<FrameFn>();
let rafId = 0;
let last = 0;

function loop(now: number): void {
  const dt = last ? Math.min(100, now - last) : 16;
  last = now;
  for (const fn of subscribers) {
    try {
      fn(now, dt);
    } catch (err) {
      console.error('[frame] subscriber failed', err);
    }
  }
  rafId = subscribers.size > 0 ? requestAnimationFrame(loop) : 0;
}

export function onFrame(fn: FrameFn): () => void {
  subscribers.add(fn);
  if (!rafId && typeof requestAnimationFrame !== 'undefined') {
    last = 0;
    rafId = requestAnimationFrame(loop);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}
