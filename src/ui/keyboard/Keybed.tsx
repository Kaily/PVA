import { memo, useEffect, useRef } from 'react';
import { useStore } from '../../core/store';
import { BLACK_KEYS, BLACK_LENGTH, FIRST_KEY, KEY_COUNT, WHITE_KEYS, isOnKeybed, keyAt } from '../../data/keyboardLayout';
import { velocityFromDepth } from '../../input/velocity';
import { keyLabel, noteName } from '../../music/notes';
import { services } from '../../services';
import { unlockAudio } from '../../state/actions';

/** Set while the key-map editor waits for a piano key to be chosen. */
type PickFn = (key: number) => void;
let pick: PickFn | null = null;
export function setKeyPick(fn: PickFn | null): void {
  pick = fn;
}

/**
 * The 61-key keybed.
 *
 * Rendered once. Key travel is applied by toggling a class directly on the
 * key elements from the controller's `key` event, so playing — by mouse,
 * touch, computer keyboard or MIDI — never causes a React render.
 *
 * Pointer handling is done on the keybed as a whole with geometric
 * hit-testing: every pointer (finger) is tracked separately, which gives
 * true multi-touch chords and glissando across keys with the button held.
 */
export const Keybed = memo(function Keybed() {
  const labels = useStore(services().store, (s) => s.noteLabels);
  const bed = useRef<HTMLDivElement>(null);
  const keyEls = useRef<(HTMLDivElement | null)[]>(new Array(KEY_COUNT).fill(null));

  /* key travel — imperative */
  useEffect(() => {
    const { controller } = services();
    const off = controller.events.on('key', ({ key, down }) => {
      if (!isOnKeybed(key)) return;
      keyEls.current[key - FIRST_KEY]?.classList.toggle('is-down', down);
    });
    // Reflect keys that are already down (e.g. after a hot reload).
    for (const key of controller.heldKeys()) {
      if (isOnKeybed(key)) keyEls.current[key - FIRST_KEY]?.classList.add('is-down');
    }
    return off;
  }, []);

  /* pointer input — mouse, pen and any number of fingers */
  useEffect(() => {
    const el = bed.current;
    if (!el) return;
    const { controller, store } = services();
    /** pointerId → key currently under that pointer (or -1 while it is off the keys) */
    const pointers = new Map<number, number>();
    let rect = el.getBoundingClientRect();

    const hit = (e: PointerEvent): { key: number; velocity: number } | null => {
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const k = keyAt(x, y);
      if (!k) return null;
      const s = store.get();
      const velocity = s.pointerVelocity === 'fixed' ? s.fixedVelocity : velocityFromDepth(k.depth);
      return { key: k.midi, velocity };
    };

    const source = (id: number): string => `pointer:${id}`;

    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      rect = el.getBoundingClientRect();
      unlockAudio();
      const h = hit(e);
      if (pick) {
        if (h) pick(h.key);
        return;
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      pointers.set(e.pointerId, h ? h.key : -1);
      if (h) controller.keyDown(source(e.pointerId), h.key, h.velocity);
    };

    const onMove = (e: PointerEvent): void => {
      const current = pointers.get(e.pointerId);
      if (current === undefined) return;
      const h = hit(e);
      const next = h ? h.key : -1;
      if (next === current) return;
      // Glissando: leave the old key, strike the new one.
      if (current >= 0) controller.keyUp(source(e.pointerId), current);
      if (h) controller.keyDown(source(e.pointerId), h.key, h.velocity);
      pointers.set(e.pointerId, next);
    };

    const onUp = (e: PointerEvent): void => {
      const current = pointers.get(e.pointerId);
      if (current === undefined) return;
      pointers.delete(e.pointerId);
      if (current >= 0) controller.keyUp(source(e.pointerId), current);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    const onResize = (): void => {
      rect = el.getBoundingClientRect();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
    const noMenu = (e: Event): void => e.preventDefault();
    el.addEventListener('contextmenu', noMenu);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      el.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      for (const [id, key] of pointers) if (key >= 0) controller.keyUp(source(id), key);
    };
  }, []);

  const setRef = (index: number) => (node: HTMLDivElement | null) => {
    keyEls.current[index] = node;
  };

  return (
    <div
      ref={bed}
      className={`keybed${labels !== 'off' ? ' keybed--labels' : ''}`}
      role="group"
      aria-label="61-key keyboard, C2 to C7"
      style={{ ['--black-len' as string]: `${BLACK_LENGTH * 100}%` }}
    >
      <div className="keybed__whites">
        {WHITE_KEYS.map((k) => (
          <div key={k.midi} ref={setRef(k.index)} className="key key--white" data-note={noteName(k.midi)}>
            {labels !== 'off' && <span className="key__label">{keyLabel(k.midi, labels)}</span>}
          </div>
        ))}
      </div>
      {BLACK_KEYS.map((k) => (
        <div
          key={k.midi}
          ref={setRef(k.index)}
          className="key key--black"
          data-note={noteName(k.midi)}
          style={{ left: `${k.left * 100}%`, width: `${k.width * 100}%` }}
        >
          {labels !== 'off' && <span className="key__label">{keyLabel(k.midi, labels)}</span>}
        </div>
      ))}
      <div className="keybed__overhang" aria-hidden="true" />
    </div>
  );
});
