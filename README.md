# PVA-61 — Professional Virtual Arranger Keyboard

A 61-key virtual arranger keyboard that runs in the browser: a sampled concert
grand, 287 playable tones, three keyboard parts (layer and split), effects,
arpeggiator, auto-harmonize, MIDI, and a panel that behaves like hardware.

**This build covers Phase 1 "Real Piano" and Phase 2 "Performance" of
`TASKS.md`.** Rhythms, the arranger, the recorder, registrations and pads
(Phases 3–5) are **not in this build yet**. Nothing on the panel is a dummy:
every control you see works. `docs/PHASES.md` lists, section by section, what
is done, what is partial and what is still to come.

## Run it

You need [Node.js](https://nodejs.org) 20.19 or newer (22 LTS recommended).

**Windows:** double-click `start.bat`. The first run installs the dependencies
(about a minute), builds, and opens the instrument in your browser.

**Any system:**

```bash
npm install
npm run build
npm run preview        # then open the address it prints (http://localhost:4173)
```

For development with hot reload use `npm run dev`.

Use **Chrome or Edge** for MIDI keyboards (Web MIDI). Firefox and Safari play
fine with mouse, touch and the computer keyboard. The page must be served from
`localhost` or HTTPS — opening `index.html` straight from disk will not work,
because browsers block audio worklets and MIDI there.

Click a key or press one on your keyboard once: browsers only allow sound after
a first user action. After that everything, MIDI included, is live.

The grand piano is playable about a second after the page opens. The tone
library (one 31 MB file) loads in the background right after it; the display
says "Loading tone library…" until the other tones can be selected.

## Playing

| Input | What it does |
| --- | --- |
| Mouse / touch | Press keys; drag across them for a glissando; several fingers play chords. Towards the front of a key is louder. |
| Computer keyboard | `Z S X D C V G B H N J M` = C3…B3, `Q 2 W 3 E R 5 T 6 Y 7 U` = C4…B4 (and onwards). |
| `Space` | Sustain pedal (hold) |
| `←` `→` | Octave down / up |
| `−` `+` | Transpose down / up |
| `↑` `↓` `Enter` | Move and confirm on the display |
| `Esc` | Back to the main screen; on the main screen: all notes off |
| `F1` | Keyboard reference card and key-map editor |
| MIDI keyboard | Notes with velocity, sustain / sostenuto / soft pedals, pitch bend, modulation, volume, expression, bank select + program change |

Details: `docs/KEYBOARD-MAPPING.md`, `docs/MIDI-MAPPING.md`.

## The panel

**TONE** (left of the display)

- **UPPER 1 / UPPER 2 / LOWER** choose which of the three keyboard parts the
  tone buttons work on (green lamp). Press the lit one again for that part's
  mixer page: volume, pan, octave, transpose, effect sends.
- **LAYER** adds Upper 2 on top of Upper 1. **SPLIT** gives the keys below the
  split point to the Lower part. Hold LAYER or SPLIT for their settings.
  While split is on, a flag above the keys shows the split point — drag it.
- The 18 **category** buttons open the tone list on that category. **LIST**
  opens it on the current tone. In the list: click a tone, or use the data
  wheel / cursor keys; the star marks a favourite; **Search** finds tones by
  name, number, category or keyword (typing there does not play notes) — type
  a tone number and press Enter to jump straight to it.
- **TONE − / +** step to the previous / next tone without opening the list.
  **FAV** stars the current tone, **FAV LIST** shows the starred ones,
  **MIXER** opens the part's mixer page.

Tones the instrument has no sound for (Sarangi, Esraj) are listed greyed out
with *N/A*; selecting one says why instead of playing something else.

**PERFORM** (right of the display)

- **REVERB, CHORUS, DELAY** switch the three send effects. **DSP** switches the
  insert effect of the selected part (54 presets: compressor, overdrive, rotary
  speaker, phaser, flanger, tremolo, auto-wah, amp). **Hold** any of them for
  its settings page.
- **EQ** opens the 4-band master equaliser: ten curves, or drag the four
  handles on the graph (up/down = gain, sideways = frequency). The lamp is lit
  whenever the curve is not flat.
- **ARPEGGIO** plays the keys you hold as a pattern in time with the tempo
  (hold for mode, rate, octaves, gate, swing, latch). **HARMONY** adds harmony
  notes to your melody, taken from the chord you hold in the lower zone, so
  switch SPLIT on with it (the *Octave* type works without a chord).
- **TOUCH**, **SUSTAIN**, **LABELS** as before.

Everything is also reachable from **FUNCTION**.

## Piano Academy

The **ACADEMY** button (graduation cap, on the right speaker) turns the panel
into a piano teacher; the keybed below stays the instrument's own. This build
has one complete lesson — **Happy Birthday to You**, absolute beginner, right
hand — in four modes: Watch & Listen, Step-by-Step, Guided Practice (with
count-in and metronome) and Independent Performance. Green key = play now,
blue = coming next, red = wrong key, gold = phrase complete. The teaching
language is chosen on the first visit — **हिंदी or English** — and can be
switched at any time. Practice results are kept in the browser.

Instructions: `docs/ACADEMY-GUIDE-HI.md` (simple Hindi), `docs/ACADEMY-GUIDE-EN.md`
(English). Design, tests and what comes next: `docs/ACADEMY.md`.

## What is in the build

**Sound**

- Concert grand from real recordings: 4 velocity layers by default (6 shipped),
  every key's loudness calibrated, key-release samples, undamped top register
- 274 tones from the GeneralUser GS SoundFont (real recordings): pianos,
  electric pianos, organs, strings, choir, brass, woodwind, guitars, basses,
  synths, leads, pads, mallets, percussion, 13 drum kits, world, effects
- Indian bank: Sitar and Shehnai (recordings), and twelve tones computed from
  synthesis models at run time — Harmonium, Shruti Box, Tanpura, Veena, Sarod,
  Santoor, Swarmandal, Bansuri, Pungi, Jal Tarang, Tabla (12 strokes), Tabla
  Tarang. The models are approximations, not recordings; see
  `docs/INSTRUMENTS.md` for what each one does.
- 64-voice engine with voice stealing, layered voices, drum-kit choke groups,
  sustain / sostenuto / soft pedals, panic

**Performance**

- Three parts: Upper 1, Upper 2 (layer), Lower (split), each with its own tone,
  volume, pan, octave, transpose, reverb / chorus / delay send and insert DSP
- Reverb (6 rooms), chorus (4), delay (4, two of them in time with the tempo),
  4-band master EQ, 54 DSP presets
- Arpeggiator: up, down, up/down, random, as played, chord, 8 patterns;
  1/4 … 1/32 with triplets; 1–4 octaves; gate; swing; latch
- Auto harmonize: Duet, Trio, Octave, Country, Block, 4-Way
- Tone browser with categories, favourites, recently used and search
- Pitch bend and modulation wheels, transpose ±12, octave ±3, tuning
  415.5–465.9 Hz, touch response, metronome 20–255 BPM, tap tempo
- Master volume, limiter that adds no latency, true stereo output meters
- Favourites, recent tones, the user EQ curve and the Phase 1 preferences are
  remembered. The performance set-up (tones, layer, split, effects) starts from
  the factory defaults every time, as `TASKS.md` §9 asks.

## Memory

Decoded audio is uncompressed, so sample-based tones are large.

| What | Memory |
| --- | --- |
| Concert grand, *Standard* quality (default) | about 260 MB (*Light* 130 MB, *Full length* 660 MB — *Function → Sound*) |
| Tone library file, kept in memory | 31 MB |
| A SoundFont tone you have selected | its samples are decoded on first use, typically 0.5–6 MB each |
| A modelled tone | rendered when selected, 2–40 MB each; at most about 90 MB of them are kept, older ones are rendered again when you return to them |

In *Standard*, a held piano note fades out after 10 seconds instead of ringing
for the full 15–25 seconds of a real grand.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the built app |
| `npm test` | 95 unit tests: the Academy's song, validation and progress rules, chords, key layout, velocity, the SoundFont parser, the instrument models (pitch), arpeggiator, harmonizer, tone table … |
| `npm run test:e2e` | 49 checks in a real browser — needs Chrome installed and a build. See `docs/PHASES.md` for what they cover. |
| `npm run test:academy` | 13 checks of the Piano Academy demo lesson in a real browser (same requirements) |
| `npm run fetch:soundfont` | Download the tone library again if `public/soundfonts/GeneralUser-GS.sf2` is missing (checksum verified) |
| `npm run tones` | Regenerate the preset table from the SoundFont file |

## Project layout

```
src/
  audio/         AudioEngine, VoiceManager, InstrumentManager, SampleManager,
                 SustainManager, MixerEngine, EffectsEngine, Clock, Metronome
    sf2/         SoundFont 2 parser and tone engine
    models/      synthesis models of the Indian instruments, DSP helpers
    dsp/         insert effects
  midi/          MidiManager (Web MIDI)
  input/         KeyboardController (parts, split, layer, arpeggiator, harmony),
                 computer keyboard, velocity curves
  music/         ChordDetector, Arpeggiator, Harmonizer, TapTempo, note helpers
  data/          tone table, effect / EQ / DSP / arpeggio presets, key layout …
  state/         panel state, actions, parameter registry, tone browser lists
  storage/       StorageManager
  ui/            the instrument: keybed, controls, display pages, panel sections
  styles/        CSS
public/
  samples/       Salamander Grand Piano
  soundfonts/    GeneralUser GS
  worklets/      master stage (gain, limiter, meter) for the audio thread
docs/            architecture, mappings, instrument metadata, phase status
tests/           unit and end-to-end tests
```

Start with `docs/ARCHITECTURE.md` for how the pieces fit together.

## Sound credits and licences

- **Salamander Grand Piano V3** (a Yamaha C5) recorded by **Alexander Holm**,
  **CC BY 3.0** (<https://creativecommons.org/licenses/by/3.0/>), in the MP3
  edition packaged by Jan Forst (`@audio-samples/piano-mp3-*`). Files were
  renamed to MIDI note numbers; at run time the app trims silence, shortens
  tails and evens out the stereo balance. See
  `public/samples/salamander-grand/LICENSE.txt`.
- **GeneralUser GS 2.0.3** by **S. Christian Collins**
  (<https://github.com/mrbumpy409/GeneralUser-GS>), used unmodified. Its
  licence allows use and redistribution in software, free or commercial. Read
  `public/soundfonts/GeneralUser-GS-LICENSE.txt` before you publish a product
  with it: the author states that he cannot be completely sure where every
  sample in the bank originally came from. For private use and development
  that is not a concern; for a commercial release it is your decision to make.
- The modelled tones contain no recordings; they are computed by the code in
  `src/audio/models/`.

No manufacturer's samples, logos or panel designs are used. Fonts: Barlow Semi
Condensed and Rajdhani (SIL Open Font License). Icons: Font Awesome Free.
