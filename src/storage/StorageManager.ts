/**
 * StorageManager — persistence.
 *
 * Phase 1 persists the small user preferences (touch response, key map,
 * metronome voice, MIDI input …) in localStorage, versioned and validated on
 * load so a corrupt or outdated entry can never break start-up.
 *
 * The performance set-up itself (tone, tempo, transpose, octave, sustain,
 * volume) deliberately starts from the factory defaults every time
 * (TASKS.md §9). Registrations, songs, phrases and session restore arrive in
 * Phases 4–5 and will use IndexedDB behind this same class.
 */
const PREFIX = 'pva61.';
const VERSION = 1;

interface Envelope<T> {
  v: number;
  data: T;
}

export class StorageManager {
  private readonly available: boolean;

  constructor() {
    let ok = false;
    try {
      const probe = `${PREFIX}probe`;
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      ok = true;
    } catch {
      ok = false; // private mode, blocked storage …
    }
    this.available = ok;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  /** Read a value; anything unreadable or from another schema version yields `fallback`. */
  load<T>(key: string, fallback: T, validate?: (value: unknown) => value is T): T {
    if (!this.available) return fallback;
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Envelope<unknown>;
      if (!parsed || parsed.v !== VERSION) return fallback;
      if (validate && !validate(parsed.data)) return fallback;
      return parsed.data as T;
    } catch {
      return fallback;
    }
  }

  save<T>(key: string, data: T): boolean {
    if (!this.available) return false;
    try {
      const envelope: Envelope<T> = { v: VERSION, data };
      window.localStorage.setItem(PREFIX + key, JSON.stringify(envelope));
      return true;
    } catch {
      return false; // quota exceeded
    }
  }

  remove(key: string): void {
    if (!this.available) return;
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  }

  /** Approximate bytes used by this app's keys. */
  usage(): number {
    if (!this.available) return 0;
    let bytes = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) bytes += key.length + (window.localStorage.getItem(key)?.length ?? 0);
    }
    return bytes * 2;
  }
}
