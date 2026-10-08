/**
 * Minimal typed event emitter.
 *
 * Used for the real-time paths (note events, key visuals, meters, MIDI
 * activity) that must NOT travel through React state. Listeners are called
 * synchronously in registration order.
 */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  private readonly map = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => {
      set.delete(fn as Listener<never>);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try {
        (fn as Listener<Events[K]>)(payload);
      } catch (err) {
        // A faulty listener must never break the audio/input path.
        console.error(`[Emitter] listener for "${String(type)}" failed`, err);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}
