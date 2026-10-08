import { useRef } from 'react';
import { FIRST_KEY, KEYS, keyAt } from '../../data/keyboardLayout';
import { noteName } from '../../music/notes';
import * as act from '../../state/actions';
import { useApp } from '../hooks';

/**
 * Shows where the keyboard is split, on the felt strip above the keys: the
 * lower zone is marked along its length and a flag stands at the split point.
 * The flag can be dragged along the keyboard (or moved with the arrow keys
 * when it has the focus).
 */
export function SplitMarker() {
  const on = useApp((s) => s.power && s.splitOn);
  const point = useApp((s) => s.splitPoint);
  const zone = useRef<HTMLDivElement>(null);
  const dragging = useRef(-1);

  if (!on) return null;
  const x = (KEYS[point - FIRST_KEY]?.left ?? 0) * 100;

  const move = (e: React.PointerEvent): void => {
    if (dragging.current !== e.pointerId) return;
    const rect = zone.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const fraction = Math.min(0.9999, Math.max(0, (e.clientX - rect.left) / rect.width));
    const hit = keyAt(fraction, 0.3); // in the black-key area, so a black key can be the split point too
    if (hit) act.setSplitPoint(hit.midi);
  };
  const end = (e: React.PointerEvent): void => {
    if (dragging.current === e.pointerId) dragging.current = -1;
  };

  return (
    <div ref={zone} className="splitzone">
      <div className="splitzone__lower" style={{ width: `${x}%` }} aria-hidden="true">
        <span>Lower</span>
      </div>
      <div
        className="splitzone__flag"
        style={{ left: `${x}%` }}
        role="slider"
        tabIndex={0}
        aria-label="Split point"
        aria-valuemin={FIRST_KEY + 1}
        aria-valuemax={FIRST_KEY + KEYS.length - 1}
        aria-valuenow={point}
        aria-valuetext={noteName(point)}
        title="Drag to move the split point"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = e.pointerId;
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            act.setSplitPoint(point - 1);
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            act.setSplitPoint(point + 1);
          }
        }}
      >
        <b>{noteName(point)}</b>
      </div>
    </div>
  );
}
