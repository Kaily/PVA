import { useEffect, useState } from 'react';
import { FIRST_KEY, LAST_KEY } from '../../data/keyboardLayout';
import { ASSIGNABLE_CODES, CONTROL_KEYS, KEYBOARD_ROWS } from '../../data/keymap';
import { setKeyLearn } from '../../input/ComputerKeyboard';
import { isBlackKey, noteName } from '../../music/notes';
import * as act from '../../state/actions';
import { useApp } from '../hooks';
import { setKeyPick } from '../keyboard/Keybed';

const ROW_INDENT = [0, 1.5, 1.85, 2.4]; // key widths, like a real keyboard's stagger

/**
 * Computer-keyboard reference card and key-map editor.
 *
 * Editing: choose "Change a key", click a piano key on the instrument, then
 * press the computer key that should play it. The panel stays out of the way
 * of the keybed so the piano key can be clicked.
 */
export function HelpOverlay() {
  const open = useApp((s) => s.helpOpen);
  const keyMap = useApp((s) => s.keyMap);
  const [edit, setEdit] = useState<{ step: 'pick' | 'press'; key: number | null } | null>(null);

  // Wire the two capture hooks for the current edit step.
  useEffect(() => {
    if (!open || !edit) {
      setKeyPick(null);
      setKeyLearn(null);
      return;
    }
    if (edit.step === 'pick') {
      setKeyLearn(null);
      setKeyPick((key) => setEdit({ step: 'press', key }));
    } else {
      setKeyPick((key) => setEdit({ step: 'press', key }));
      setKeyLearn((code) => {
        if (edit.key === null) return;
        if (!ASSIGNABLE_CODES.has(code)) {
          act.notify('That key is reserved for an instrument function.');
          return;
        }
        act.assignKey(code, edit.key);
        setEdit({ step: 'pick', key: null });
      });
    }
    return () => {
      setKeyPick(null);
      setKeyLearn(null);
    };
  }, [open, edit]);

  useEffect(() => {
    if (!open) setEdit(null);
  }, [open]);

  if (!open) return null;

  return (
    <aside className="help" role="dialog" aria-label="Computer keyboard map">
      <header className="help__head">
        <h2>Keyboard controls</h2>
        <button type="button" className="help__close" onClick={() => act.toggleHelp(false)} aria-label="Close">
          Close
        </button>
      </header>

      <div className="help__body">
        <div className="help__keys" aria-label="Note keys">
          {KEYBOARD_ROWS.map((row, r) => (
            <div className="help__row" key={r} style={{ paddingLeft: `calc(var(--kc) * ${ROW_INDENT[r]})` }}>
              {row.map((k) => {
                const note = keyMap[k.code];
                const control = CONTROL_KEYS[k.code];
                const cls = note !== undefined ? (isBlackKey(note) ? ' is-black' : ' is-white') : control ? ' is-control' : '';
                const target = edit?.step === 'press' && edit.key === note;
                return (
                  <button
                    type="button"
                    key={k.code}
                    className={`kcap${cls}${target ? ' is-target' : ''}`}
                    title={note !== undefined ? `Plays ${noteName(note)}. Click to clear.` : (control ?? 'Not assigned')}
                    disabled={!edit || note === undefined}
                    onClick={() => act.assignKey(k.code, null)}
                  >
                    <span className="kcap__cap">{k.cap}</span>
                    <span className="kcap__note">{note !== undefined ? noteName(note) : control ? control.replace('Transpose ', 'Tr ') : ''}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <dl className="help__list">
          <div>
            <dt>Z – M row</dt>
            <dd>lower notes (C3 upward), black keys on S D G H J</dd>
          </div>
          <div>
            <dt>Q – U row</dt>
            <dd>upper notes (C4 upward), black keys on 2 3 5 6 7</dd>
          </div>
          <div>
            <dt>Space</dt>
            <dd>sustain pedal (hold)</dd>
          </div>
          <div>
            <dt>← →</dt>
            <dd>octave down / up</dd>
          </div>
          <div>
            <dt>− +</dt>
            <dd>transpose down / up</dd>
          </div>
          <div>
            <dt>↑ ↓ Enter</dt>
            <dd>move and confirm on the display</dd>
          </div>
          <div>
            <dt>Esc</dt>
            <dd>back to the main screen, then all notes off</dd>
          </div>
          <div>
            <dt>F1</dt>
            <dd>show or hide this card</dd>
          </div>
          <div>
            <dt>Hold a button</dt>
            <dd>Reverb, Chorus, Delay, DSP, Arpeggio, Harmony, Layer, Split: open its settings</dd>
          </div>
        </dl>
      </div>

      <footer className="help__foot">
        {!edit && (
          <>
            <button type="button" className="help__btn" onClick={() => setEdit({ step: 'pick', key: null })}>
              Change a key
            </button>
            <span className="help__hint">
              The on-screen keys run from {noteName(FIRST_KEY)} to {noteName(LAST_KEY)}. Mouse and touch play louder towards the front of a key.
            </span>
          </>
        )}
        {edit && (
          <>
            <span className="help__step">
              {edit.step === 'pick' || edit.key === null
                ? '1  Click a piano key on the instrument.'
                : `2  Now press the computer key that should play ${noteName(edit.key)}.`}
            </span>
            <span className="help__hint">Click a mapped key above to clear it.</span>
            <button type="button" className="help__btn help__btn--quiet" onClick={act.resetKeyMap}>
              Restore default map
            </button>
            <button type="button" className="help__btn" onClick={() => setEdit(null)}>
              Done
            </button>
          </>
        )}
      </footer>
    </aside>
  );
}
