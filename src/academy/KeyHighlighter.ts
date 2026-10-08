/**
 * KeyHighlighter — colours keys of the instrument's own keybed for the
 * lessons, imperatively (class toggles, no React), like key travel.
 *
 *   green  hl-target  the key to play now (finger number + note name on it)
 *   blue   hl-next    the upcoming keys
 *   red    hl-wrong   a wrong key that was pressed (fades by itself)
 *   gold   hl-gold    the keys of a phrase that was just completed
 *   —      hl-play    pressed by the lesson playback (Watch and Listen)
 *
 * Keys are found by the `data-midi` attribute the Keybed puts on each key.
 */
import { noteName } from '../music/notes';

export interface MarkedKey {
  midi: number;
  finger: number;
}

const FLASH_MS = { wrong: 650, gold: 1100 } as const;

export class KeyHighlighter {
  private keys: Map<number, HTMLElement> | null = null;
  private target: number | null = null;
  private next: number[] = [];
  private readonly timers = new Map<string, number>();
  showFingers = true;
  showNames = true;

  private el(midi: number): HTMLElement | undefined {
    if (!this.keys || this.keys.size === 0 || ![...this.keys.values()][0].isConnected) {
      this.keys = new Map();
      document.querySelectorAll<HTMLElement>('.keybed .key[data-midi]').forEach((k) => this.keys!.set(Number(k.dataset.midi), k));
    }
    return this.keys.get(midi);
  }

  private mark(midi: number, finger: number | null, tone: 'target' | 'next' | null): void {
    const mark = this.el(midi)?.querySelector<HTMLElement>('.key__mark');
    if (!mark) return;
    if (tone === null) {
      delete mark.dataset.finger;
      delete mark.dataset.note;
      mark.className = 'key__mark';
      return;
    }
    if (this.showFingers && finger !== null) mark.dataset.finger = String(finger);
    else delete mark.dataset.finger;
    if (this.showNames && tone === 'target') mark.dataset.note = noteName(midi);
    else delete mark.dataset.note;
    mark.className = `key__mark key__mark--${tone}`;
  }

  /** The key to play now, and the ones after it. A key that is both keeps the green. */
  set(target: MarkedKey | null, upcoming: MarkedKey[]): void {
    for (const midi of this.next) {
      this.el(midi)?.classList.remove('hl-next');
      this.mark(midi, null, null);
    }
    if (this.target !== null) {
      this.el(this.target)?.classList.remove('hl-target');
      this.mark(this.target, null, null);
    }
    this.target = target?.midi ?? null;
    this.next = [];
    for (const n of upcoming) {
      if (n.midi === this.target || this.next.includes(n.midi)) continue;
      this.next.push(n.midi);
      this.el(n.midi)?.classList.add('hl-next');
      this.mark(n.midi, n.finger, 'next');
    }
    if (target) {
      this.el(target.midi)?.classList.add('hl-target');
      this.mark(target.midi, target.finger, 'target');
    }
  }

  flash(midis: number[], kind: 'wrong' | 'gold'): void {
    for (const midi of midis) {
      const el = this.el(midi);
      if (!el) continue;
      const cls = `hl-${kind}`;
      const id = `${kind}:${midi}`;
      window.clearTimeout(this.timers.get(id));
      el.classList.remove(cls);
      void el.offsetWidth; // restart the fade when the same key flashes again
      el.classList.add(cls);
      this.timers.set(
        id,
        window.setTimeout(() => {
          el.classList.remove(cls);
          this.timers.delete(id);
        }, FLASH_MS[kind]),
      );
    }
  }

  /** Key pressed / released by the lesson playback. */
  play(midi: number, down: boolean): void {
    this.el(midi)?.classList.toggle('hl-play', down);
  }

  clear(): void {
    this.set(null, []);
    for (const t of this.timers.values()) window.clearTimeout(t);
    this.timers.clear();
    document.querySelectorAll('.keybed .key').forEach((k) => k.classList.remove('hl-wrong', 'hl-gold', 'hl-play', 'hl-target', 'hl-next'));
    document.querySelectorAll<HTMLElement>('.keybed .key__mark').forEach((m) => {
      m.className = 'key__mark';
      delete m.dataset.finger;
      delete m.dataset.note;
    });
  }
}
