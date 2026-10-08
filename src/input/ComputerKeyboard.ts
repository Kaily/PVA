import { services } from '../services';
import * as act from '../state/actions';
import { activateSelected, exitPage, moveCursor } from '../state/params';

/**
 * Computer keyboard input.
 *
 * Note keys come from the editable key map (state.keyMap, keyed by
 * KeyboardEvent.code). Control keys are fixed — see CONTROL_KEYS in
 * data/keymap.ts and docs/KEYBOARD-MAPPING.md.
 *
 * A "learn" hook lets the key-map editor capture the next key press instead
 * of playing it.
 */

const SOURCE = 'qwerty';

type LearnFn = (code: string) => void;
let learn: LearnFn | null = null;

/** While set, the next assignable key press is delivered to `fn` instead of being played. */
export function setKeyLearn(fn: LearnFn | null): void {
  learn = fn;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function attachComputerKeyboard(): () => void {
  /** code → key that was started, so key-up releases the right note even if the map changed meanwhile. */
  const down = new Map<string, number>();

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    const { store, controller } = services();
    const s = store.get();

    if (e.code === 'F1') {
      e.preventDefault();
      if (!e.repeat) act.toggleHelp();
      return;
    }
    if (!s.power) return;
    act.unlockAudio();

    if (learn) {
      if (e.code === 'Escape') {
        learn = null;
      } else if (!e.repeat) {
        learn(e.code);
      }
      e.preventDefault();
      return;
    }

    // A focused button must not also be "clicked" by the space bar / Enter.
    const onControl = e.target instanceof HTMLElement && e.target.closest('button, [role="slider"]') !== null;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!e.repeat) act.holdSustain(true);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        act.nudgeOctave(-1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        act.nudgeOctave(+1);
        return;
      case 'Minus':
      case 'NumpadSubtract':
        e.preventDefault();
        act.nudgeTranspose(-1);
        return;
      case 'Equal':
      case 'NumpadAdd':
        e.preventDefault();
        act.nudgeTranspose(+1);
        return;
      case 'ArrowUp':
        if (onControl && (e.target as HTMLElement).getAttribute('role') === 'slider') return;
        e.preventDefault();
        moveCursor('up');
        return;
      case 'ArrowDown':
        if (onControl && (e.target as HTMLElement).getAttribute('role') === 'slider') return;
        e.preventDefault();
        moveCursor('down');
        return;
      case 'Enter':
        if (onControl) return; // let the focused control handle it
        e.preventDefault();
        if (!e.repeat) activateSelected();
        return;
      case 'Escape':
        if (!e.repeat) {
          if (s.helpOpen || s.lcdPage !== 'main') exitPage();
          else act.panic();
        }
        return;
      default:
        break;
    }

    const key = s.keyMap[e.code];
    if (key === undefined) return;
    e.preventDefault();
    if (e.repeat || down.has(e.code)) return; // OS auto-repeat must not retrigger the note
    down.set(e.code, key);
    controller.keyDown(SOURCE, key, s.pcKeyVelocity);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      act.holdSustain(false);
      return;
    }
    const key = down.get(e.code);
    if (key === undefined) return;
    down.delete(e.code);
    services().controller.keyUp(SOURCE, key);
  };

  const onBlur = (): void => {
    down.clear(); // the controller releases the notes itself on blur (see boot)
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
