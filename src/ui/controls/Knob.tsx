import { useRef } from 'react';
import { clamp } from '../../core/math';
import { unlockAudio } from '../../state/actions';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Value restored on double-click. */
  defaultValue: number;
  onChange: (value: number) => void;
}

const SWEEP = 270; // degrees from min to max
const TICKS = 21;

/**
 * Rotary knob. Drag up/down (or use the mouse wheel / arrow keys) to turn it;
 * hold Shift for fine steps; double-click returns to the default.
 */
export function Knob({ label, value, min, max, defaultValue, onChange }: Props) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const span = max - min;
  const angle = -SWEEP / 2 + ((value - min) / span) * SWEEP;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    unlockAudio();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, value };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    // A full sweep takes about 180 px of travel; Shift makes it four times finer.
    const perPixel = (span / 180) * (e.shiftKey ? 0.25 : 1);
    onChange(clamp(Math.round(d.value + (d.y - e.clientY) * perPixel), min, max));
  };

  const end = (e: React.PointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    onChange(clamp(value + (e.deltaY < 0 ? 2 : -2), min, max));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.code === 'ArrowUp') onChange(clamp(value + 1, min, max));
    else if (e.code === 'ArrowDown') onChange(clamp(value - 1, min, max));
    else if (e.code === 'Home') onChange(min);
    else if (e.code === 'End') onChange(max);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="knob">
      <div className="knob__dial">
        <svg className="knob__scale" viewBox="-50 -50 100 100" aria-hidden="true">
          {Array.from({ length: TICKS }, (_, i) => {
            const a = ((-SWEEP / 2 + (i / (TICKS - 1)) * SWEEP - 90) * Math.PI) / 180;
            const major = i % 5 === 0;
            const r1 = major ? 41 : 43.5;
            const lit = (i / (TICKS - 1)) * span + min <= value + 0.001;
            return (
              <line
                key={i}
                x1={Math.cos(a) * r1}
                y1={Math.sin(a) * r1}
                x2={Math.cos(a) * 48}
                y2={Math.sin(a) * 48}
                className={`knob__tick${major ? ' knob__tick--major' : ''}${lit ? ' is-lit' : ''}`}
              />
            );
          })}
        </svg>
        <div
          className="knob__cap"
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={end}
          onPointerCancel={end}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onDoubleClick={() => onChange(defaultValue)}
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <span className="knob__pointer" />
        </div>
      </div>
      <div className="knob__legend">
        <span>{label}</span>
        <output className="knob__value">{value}</output>
      </div>
    </div>
  );
}
