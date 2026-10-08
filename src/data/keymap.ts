/**
 * Computer-keyboard → piano mapping.
 *
 * Keys are identified by KeyboardEvent.code (physical position), so the map
 * works on any layout (QWERTY, AZERTY, Devanagari InScript …). Values are the
 * MIDI number of the virtual key that is pressed; octave shift and transpose
 * are applied afterwards by the instrument, exactly as for the on-screen keys.
 */
export type KeyMap = Record<string, number>;

/** Lower row: Z S X D C V G B H N J M  → C3 … B3 (continues on , L . ; /). */
const LOWER: string[] = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'];
/** Upper row: Q 2 W 3 E R 5 T 6 Y 7 U  → C4 … B4 (continues on I 9 O 0 P [ ]). */
const UPPER: string[] = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft'];

export const LOWER_ROW_BASE = 48; // C3
export const UPPER_ROW_BASE = 60; // C4

export function defaultKeyMap(): KeyMap {
  const map: KeyMap = {};
  LOWER.forEach((code, i) => (map[code] = LOWER_ROW_BASE + i));
  UPPER.forEach((code, i) => (map[code] = UPPER_ROW_BASE + i));
  // "]" would be F#5 in the pattern, but there is no key for F5 → leave "]" on G5 for a usable top note.
  map['BracketRight'] = UPPER_ROW_BASE + 19;
  return map;
}

/** Keys reserved for instrument functions — they can not be re-assigned to notes. */
export const CONTROL_KEYS: Record<string, string> = {
  Space: 'Sustain (hold)',
  ArrowLeft: 'Octave down',
  ArrowRight: 'Octave up',
  Minus: 'Transpose −',
  Equal: 'Transpose +',
  NumpadSubtract: 'Transpose −',
  NumpadAdd: 'Transpose +',
  ArrowUp: 'Display cursor up',
  ArrowDown: 'Display cursor down',
  Enter: 'Display enter',
  Escape: 'All notes off',
  F1: 'Keyboard help',
};

/** Rows of a standard keyboard, used to draw the mapping diagram. */
export const KEYBOARD_ROWS: { code: string; cap: string; w?: number }[][] = [
  [
    { code: 'Backquote', cap: '`' },
    { code: 'Digit1', cap: '1' },
    { code: 'Digit2', cap: '2' },
    { code: 'Digit3', cap: '3' },
    { code: 'Digit4', cap: '4' },
    { code: 'Digit5', cap: '5' },
    { code: 'Digit6', cap: '6' },
    { code: 'Digit7', cap: '7' },
    { code: 'Digit8', cap: '8' },
    { code: 'Digit9', cap: '9' },
    { code: 'Digit0', cap: '0' },
    { code: 'Minus', cap: '−' },
    { code: 'Equal', cap: '+' },
  ],
  [
    { code: 'KeyQ', cap: 'Q' },
    { code: 'KeyW', cap: 'W' },
    { code: 'KeyE', cap: 'E' },
    { code: 'KeyR', cap: 'R' },
    { code: 'KeyT', cap: 'T' },
    { code: 'KeyY', cap: 'Y' },
    { code: 'KeyU', cap: 'U' },
    { code: 'KeyI', cap: 'I' },
    { code: 'KeyO', cap: 'O' },
    { code: 'KeyP', cap: 'P' },
    { code: 'BracketLeft', cap: '[' },
    { code: 'BracketRight', cap: ']' },
  ],
  [
    { code: 'KeyA', cap: 'A' },
    { code: 'KeyS', cap: 'S' },
    { code: 'KeyD', cap: 'D' },
    { code: 'KeyF', cap: 'F' },
    { code: 'KeyG', cap: 'G' },
    { code: 'KeyH', cap: 'H' },
    { code: 'KeyJ', cap: 'J' },
    { code: 'KeyK', cap: 'K' },
    { code: 'KeyL', cap: 'L' },
    { code: 'Semicolon', cap: ';' },
    { code: 'Quote', cap: "'" },
  ],
  [
    { code: 'KeyZ', cap: 'Z' },
    { code: 'KeyX', cap: 'X' },
    { code: 'KeyC', cap: 'C' },
    { code: 'KeyV', cap: 'V' },
    { code: 'KeyB', cap: 'B' },
    { code: 'KeyN', cap: 'N' },
    { code: 'KeyM', cap: 'M' },
    { code: 'Comma', cap: ',' },
    { code: 'Period', cap: '.' },
    { code: 'Slash', cap: '/' },
  ],
];

export const ASSIGNABLE_CODES: ReadonlySet<string> = new Set(
  KEYBOARD_ROWS.flat()
    .map((k) => k.code)
    .filter((code) => !(code in CONTROL_KEYS)),
);
