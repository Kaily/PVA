import { useEffect, useRef, type ReactNode } from 'react';
import { unlockAudio } from '../../state/actions';

export type LedColor = 'amber' | 'red' | 'green';

interface Props {
  /** Legend printed on the panel above the cap. */
  label?: string;
  /** Text or icon on the cap itself. */
  cap?: ReactNode;
  /** Accessible name when the legend is not descriptive enough. */
  ariaLabel?: string;
  /** undefined = no LED window on this button. */
  led?: boolean;
  ledColor?: LedColor;
  /** Toggle buttons report their state to assistive tech. */
  latched?: boolean;
  disabled?: boolean;
  /** Keep firing while held (tempo, transpose …): slow at first, then fast. */
  repeat?: boolean;
  variant?: 'default' | 'small' | 'wide' | 'round' | 'danger' | 'cat' | 'slim';
  title?: string;
  onPress: () => void;
  /**
   * Fired once when the button is kept down for about half a second (after
   * `onPress` already ran on the way down) — used for "hold to open the
   * settings page". Never the only way to reach something.
   */
  onHold?: () => void;
}

const REPEAT_DELAY = 420;
const REPEAT_SLOW = 110;
const REPEAT_FAST = 45;
const HOLD_MS = 480;

/**
 * A physical panel button. Acts on pointer *down* (like hardware, no waiting
 * for the release), supports hold-to-repeat, and stays out of the keyboard
 * focus order when used with a mouse so the space bar keeps working as the
 * sustain pedal.
 */
export function PanelButton({
  label,
  cap,
  ariaLabel,
  led,
  ledColor = 'amber',
  latched,
  disabled,
  repeat,
  variant = 'default',
  title,
  onPress,
  onHold,
}: Props) {
  const timer = useRef(0);
  const handledByPointer = useRef(false);
  const press = useRef(onPress);
  press.current = onPress;
  const hold = useRef(onHold);
  hold.current = onHold;

  const stop = (): void => {
    window.clearTimeout(timer.current);
    timer.current = 0;
  };
  useEffect(() => stop, []);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); // no focus steal, no text selection
    handledByPointer.current = true;
    unlockAudio();
    press.current();
    if (repeat) {
      let count = 0;
      const tick = (): void => {
        press.current();
        count++;
        timer.current = window.setTimeout(tick, count > 8 ? REPEAT_FAST : REPEAT_SLOW);
      };
      timer.current = window.setTimeout(tick, REPEAT_DELAY);
    } else if (hold.current) {
      timer.current = window.setTimeout(() => hold.current?.(), HOLD_MS);
    }
  };

  const onClick = (): void => {
    // Keyboard / assistive activation. Pointer presses were handled on pointer down.
    if (handledByPointer.current) {
      handledByPointer.current = false;
      return;
    }
    if (!disabled) {
      unlockAudio();
      press.current();
    }
  };

  return (
    <div className={`pbtn pbtn--${variant}`}>
      {label && <span className="pbtn__legend">{label}</span>}
      <button
        type="button"
        className={`pbtn__cap${latched ? ' is-latched' : ''}`}
        aria-label={ariaLabel ?? label}
        aria-pressed={latched}
        disabled={disabled}
        title={title}
        onPointerDown={onPointerDown}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={onClick}
        onKeyUp={(e) => {
          if (e.code === 'Space') e.preventDefault(); // space is the sustain pedal
        }}
      >
        {led !== undefined && <span className={`pbtn__led pbtn__led--${ledColor}${led ? ' is-on' : ''}`} aria-hidden="true" />}
        {cap !== undefined && <span className="pbtn__text">{cap}</span>}
      </button>
    </div>
  );
}
