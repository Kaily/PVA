# MIDI mapping

MIDI input uses the Web MIDI API (Chrome, Edge, Opera; Firefox with its MIDI
permission). The browser asks for permission the first time. Devices are
detected when they are plugged in; the display shows **MIDI CONNECTED** and the
MIDI lamp on the panel lights and flickers with incoming data.

*Function → System → MIDI devices and monitor* (or the **MIDI** button) lists
the inputs, lets you listen to all of them or to one, and shows the last
message received.

## Received messages

The instrument listens on **all 16 channels** (omni).

| Message | Effect |
| --- | --- |
| Note On, velocity 1–127 | Plays the note exactly as the on-screen key would: split, layer, arpeggiator and harmony apply. Velocity goes through the Touch Response setting. Notes 36–96 also move the on-screen keys. |
| Note Off, or Note On with velocity 0 | Releases the note (subject to the pedals). |
| CC 0 Bank Select (MSB) | Remembered for the next Program Change. |
| Program Change | Selects the tone of **Upper 1** — see the table below. |
| CC 64 Sustain | ≥ 64 down, < 64 up. Upper parts; the Lower (split) part is not sustained. |
| CC 66 Sostenuto | Holds only the notes that are down when it is pressed. |
| CC 67 Soft | Softer, mellower notes while held. |
| CC 1 Modulation | Vibrato depth — or the rotor speed (slow / fast) of a part that has a rotary-speaker DSP. The modulation wheel on screen follows. |
| CC 7 Volume | Master volume 0–100; the volume knob follows. |
| CC 11 Expression | Level of the three keyboard parts (does not move the knob). |
| Pitch Bend (14-bit) | ± the bend range (default ±2 semitones, 0–12 in *Function → Pitch*); the pitch wheel on screen follows. |
| Channel Aftertouch | Adds vibrato, like the modulation wheel. |
| CC 120 All Sound Off | Same as the ALL NOTES OFF button. |
| CC 121 Reset All Controllers | Bend and modulation to centre, expression to full, MIDI pedals up. |
| CC 123 All Notes Off | Releases every note held over MIDI. |

Octave shift and transpose apply to MIDI notes as they do to the on-screen
keys. Notes outside a tone's range are silent.

## Selecting tones over MIDI

Send Bank Select (CC 0) if needed, then Program Change. The program number is
the General MIDI number counted from 0.

| Bank (CC 0) | Program | Tone |
| --- | --- | --- |
| 0 | 0 | Concert Grand (the sampled grand) |
| 0 | 1–127 | The General MIDI sound of that number, e.g. 4 = Tine Electric Piano, 48 = Fast Strings, 73 = Flute, 104 = Sitar |
| 1–26 | as in the SoundFont | Variations of the General MIDI sounds (GeneralUser GS bank numbers) |
| 2 | 0 | Studio Grand — the SoundFont's own grand piano |
| 50 | 0–11 | Harmonium, Shruti Box, Tanpura, Veena, Sarod, Santoor, Swarmandal, Bansuri, Pungi, Jal Tarang, Tabla, Tabla Tarang |
| 120 | 0, 1, 2, 8, 16, 24, 25, 26, 32, 40, 48, 56, 127 | Drum kits: Standard 1–3, Room, Power, Electronic, 808/909, Dance, Jazz, Brush, Orchestral, SFX, CM-64/32L |

A bank / program pair that does not exist falls back to the same program in
bank 0. The number shown in the tone browser (001–289) is the position in the
list, not the MIDI program. `toneByProgram()` in `src/data/tones.ts` is the
whole rule.

Only Upper 1 follows program changes; all channels are treated alike (there
is no multi-timbral mode).

## Things to know

- **First sound needs a click.** Browsers do not treat MIDI as a user action.
  If you play the MIDI keyboard before touching the page, the display says
  "Audio is waiting — click the keyboard or press a key once."
- **Unplugging a device** releases all notes and pedals it was holding.
- **Nothing is transmitted.** MIDI output and MIDI clock are not built yet.

## Where it lives in the code

- `src/midi/MidiManager.ts` — permission, device list, byte parsing.
- `src/input/KeyboardController.ts` — `controlChange()` holds the CC table above.
