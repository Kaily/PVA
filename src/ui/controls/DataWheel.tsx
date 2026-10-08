import { useRef } from 'react';
import { unlockAudio } from '../../state/actions';

interface Props {
  /** Called with a signed number of detents. */
  onStep: (steps: number) => void;
}

const DETENT_DEG = 15; // 24 detents per turn

/**
 * Data wheel (rotary encoder). Turn it by dragging around its centre, with
 * the mouse wheel, or with the arrow keys. One detent = one value step; there
 * is deliberately no inertia, as on a hardware encoder.
 */
export function DataWheel({ onStep }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const rotor = useRef<HTMLDivElement>(null);
  const state = useRef({ active: false, last: 0, residue: 0, angle: 0, cx: 0, cy: 0, scroll: 0 });

  const turn = (deg: number): void => {
    const s = state.current;
    s.angle += deg;
    if (rotor.current) rotor.current.style.transform = `rotate(${s.angle}deg)`;
    s.residue += deg;
    const steps = Math.trunc(s.residue / DETENT_DEG);
    if (steps !== 0) {
      s.residue -= steps * DETENT_DEG;
      onStep(steps);
    }
  };

  const angleAt = (x: number, y: number): number => {
    const s = state.current;
    return (Math.atan2(y - s.cy, x - s.cx) * 180) / Math.PI;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    unlockAudio();
    const rect = e.currentTarget.getBoundingClientRect();
    const s = state.current;
    s.cx = rect.left + rect.width / 2;
    s.cy = rect.top + rect.height / 2;
    s.active = true;
    s.last = angleAt(e.clientX, e.clientY);
    s.residue = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = state.current;
    if (!s.active) return;
    const a = angleAt(e.clientX, e.clientY);
    let delta = a - s.last;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    s.last = a;
    turn(delta);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>): void => {
    state.current.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    // One detent per mouse-wheel notch (~100 px). Browsers may merge quick
    // notches into one event, and trackpads send many small ones, so work
    // from the distance scrolled rather than from the number of events.
    const s = state.current;
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    s.scroll += px;
    const steps = Math.trunc(s.scroll / 100) || (Math.abs(px) >= 50 ? Math.sign(px) : 0);
    if (steps === 0) return;
    s.scroll = Math.abs(px) >= 50 ? 0 : s.scroll - steps * 100;
    s.residue = 0;
    s.angle -= steps * DETENT_DEG;
    if (rotor.current) rotor.current.style.transform = `rotate(${s.angle}deg)`;
    onStep(-steps);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    state.current.residue = 0;
    turn(e.code === 'ArrowUp' ? DETENT_DEG : -DETENT_DEG);
  };

  return (
    <div
      ref={el}
      className="dwheel"
      role="slider"
      tabIndex={0}
      aria-label="Data wheel"
      aria-valuetext="Turn to change the selected value"
      aria-valuenow={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      <div ref={rotor} className="dwheel__rotor">
        <span className="dwheel__dimple" />
      </div>
    </div>
  );
}
