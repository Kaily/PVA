# Computer keyboard mapping

Keys are matched by **physical position** (`KeyboardEvent.code`), so the map is
the same on any keyboard layout. The names below are the US-QWERTY legends.

## Note keys (default)

Each computer key presses one key of the on-screen keybed. Octave shift and
transpose are applied afterwards, exactly as for the mouse.

| Row | Keys | Notes |
| --- | --- | --- |
| Lower, white | `Z X C V B N M , . /` | C3 D3 E3 F3 G3 A3 B3 C4 D4 E4 |
| Lower, black | `S D G H J L ;` | C#3 D#3 F#3 G#3 A#3 C#4 D#4 |
| Upper, white | `Q W E R T Y U I O P [ ]` | C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 |
| Upper, black | `2 3 5 6 7 9 0` | C#4 D#4 F#4 G#4 A#4 C#5 D#5 |

(`]` plays G5 rather than F#5 so the top of the row ends on a usable note.)

All computer-keyboard notes use one velocity, 96 by default
(*Function → Keyboard → Computer keyboard velocity*).

## Control keys (fixed)

| Key | Function |
| --- | --- |
| `Space` | Sustain pedal while held |
| `←` / `→` | Octave down / up (−3 … +3) |
| `−` / `+` (also on the number pad) | Transpose down / up (−12 … +12) |
| `↑` / `↓` | Move the cursor on the display |
| `Enter` | Confirm / toggle the selected item |
| `Esc` | Close the card or return to the main screen; on the main screen: ALL NOTES OFF |
| `F1` | Show / hide the keyboard reference card |

While the cursor is in the **Search** box of the tone browser, the keyboard
types text instead of playing: `Enter` selects the first tone found, `Esc`
clears the search and gives the keyboard back to the instrument.

On the display, the cursor keys of the panel (and `↑` `↓` here) depend on the
page: in parameter lists `▲▼` select and `◀▶` change the value; in the tone
browser, which has two columns, `◀▶` step one tone and `▲▼` one row.

Keys held together with Ctrl, Alt or ⌘ are left to the browser. Holding a key
does not retrigger the note (operating-system auto-repeat is ignored). If the
window loses focus, every held key and the sustain pedal are released so no
note can hang.

## Changing the map

1. Press `F1` (or the **Key map** button) and choose **Change a key**.
2. Click a piano key on the instrument.
3. Press the computer key that should play it.

Repeat for as many keys as you like. While editing, click a mapped key on the
card to clear it, or use **Restore default map**. Control keys cannot be
reassigned. The map is saved in the browser.

In code the default map is `defaultKeyMap()` in `src/data/keymap.ts`; the
stored map lives in the `keyMap` preference.

## Mouse and touch

- Press = Note On, release = Note Off. Leaving a key while pressed stops it.
- Drag across the keys with the button (or finger) down for a glissando.
- Any number of fingers at once on a touch screen.
- Velocity follows where you strike the key: the back of the key is soft
  (38), the front edge loud (120). To use one fixed velocity instead, set
  *Function → Keyboard → Mouse / touch velocity* to **Fixed**.

## Panel gestures

- A panel button acts when it is pressed, not when it is released.
- **Hold** REVERB, CHORUS, DELAY, DSP, ARPEGGIO or HARMONY for about half a
  second to open its settings page; LAYER for Upper 2's mixer page; SPLIT for
  the split point. The same pages are in the FUNCTION menu.
- Press the lit part button (UPPER 1 / UPPER 2 / LOWER) again for that part's
  mixer page.
- Tempo, transpose, tone − / + and the value buttons repeat while held.
- The split marker above the keys can be dragged; with the keyboard focus on
  it, the arrow keys move it one key at a time.
- The four numbered handles on the EQ graph can be dragged: up / down for
  gain, sideways for frequency.
