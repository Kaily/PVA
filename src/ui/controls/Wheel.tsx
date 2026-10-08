import { useEffect, useRef } from 'react';
import { clamp } from '../../core/math';
import { onFrame } from '../../core/frame';
import { unlockAudio } from '../../state/actions';

interface Props {
  label: string;
  /** "spring" returns to the centre when released (pitch bend); "free" stays put (modulation). */
  mode: 'spring' | 'free';
  /** Called with −1…+1 (spring) or 0…1 (free). */
  onChange: (value: number) => void;
  /** External movement (e.g. a MIDI controller): subscribe, return the unsubscribe function. */
  follow?: (apply: (value: number) => void) => () => void;
}

const MAX_ANGLE = 52; // degrees of wheel rotation at full throw
const SPRING_MS = 140;

/**
 * Performance wheel. The visual is driven imperatively (CSS variables on the
 * element) so dragging it never re-renders React.
 */
export function Wheel({ label, mode, onChange, follow }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const value = useRef(0);
  const drag = useRef<{ y: number; start: number; height: number } | null>(null);
  const stopSpring = useRef<(() => void) | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  const min = mode === 'spring' ? -1 : 0;

  const paint = (v: number): void => {
    const node = el.current;
    if (!node) return;
    // Centre the free wheel's travel on the window as well.
    const norm = mode === 'spring' ? v : v * 2 - 1;
    node.style.setProperty('--wheel', norm.toFixed(4));
    node.style.setProperty('--wheel-sin', Math.sin((norm * MAX_ANGLE * Math.PI) / 180).toFixed(4));
    node.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  };

  const apply = (v: number, notify: boolean): void => {
    const next = clamp(v, min, 1);
    if (next === value.current) return;
    value.current = next;
    paint(next);
    if (notify) change.current(next);
  };

  useEffect(() => {
    paint(0);
    if (!follow) return;
    return follow((v) => {
      if (!drag.current) apply(v, false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => stopSpring.current?.(), []);

  const springBack = (): void => {
    stopSpring.current?.();
    const from = value.current;
    if (from === 0) return;
    let elapsed = 0;
    const off = onFrame((_now, dt) => {
      elapsed += dt;
      const t = Math.min(1, elapsed / SPRING_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      apply(from * (1 - eased), true);
      if (t >= 1) {
        off();
        stopSpring.current = null;
      }
    });
    stopSpring.current = off;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    unlockAudio();
    stopSpring.current?.();
    stopSpring.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, start: value.current, height: e.currentTarget.getBoundingClientRect().height };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    // Dragging by ~45 % of the visible wheel height reaches full throw.
    const range = mode === 'spring' ? 2 : 1;
    apply(d.start + ((d.y - e.clientY) / (d.height * 0.9)) * range, true);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (mode === 'spring') springBack();
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (mode === 'free') apply(value.current + (e.deltaY < 0 ? 0.06 : -0.06), true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    apply(value.current + (e.code === 'ArrowUp' ? 0.1 : -0.1), true);
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (mode === 'spring' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) springBack();
  };

  return (
    <div className="wheel">
      <div
        ref={el}
        className={`wheel__slot wheel__slot--${mode}`}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={min * 100}
        aria-valuemax={100}
        aria-valuenow={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <div className="wheel__body">
          <div className="wheel__ribs" />
          <div className="wheel__notch" />
          <div className="wheel__shade" />
        </div>
      </div>
      <span className="wheel__legend">{label}</span>
    </div>
  );
}
