# Phase status against TASKS.md

`TASKS.md` §77 asks for phased development. This build contains
**Phase 1 — Real Piano** and **Phase 2 — Performance**, both complete.
Phases 3–5 have not been started; where the engine already has a hook for
them, the table says so.

Legend: **Done** — built and covered by tests · **Partial** — the part that
belongs to Phases 1–2 exists · **Later** — not built.

## Phase 1 checklist (§77)

| Item | Status |
| --- | --- |
| 61 keys, professional chassis | Done |
| Grand piano sound (sampled, velocity layers) | Done |
| Mouse input, glissando, multi-touch | Done |
| Computer keyboard (editable map) | Done |
| MIDI (notes, velocity, CC64/66/67/1/7/11, bend, aftertouch, device select, hot-plug) | Done — tested with injected MIDI data, not yet with hardware |
| Velocity / touch response | Done |
| 64-note polyphony with voice stealing | Done |
| Sustain | Done |
| Pitch bend | Done |
| Master volume, limiter, meters | Done |
| Transpose, octave | Done |
| Metronome, tap tempo | Done |

## Phase 2 checklist (§77)

| Item | Status |
| --- | --- |
| Tone browser | Done — categories, favourites, recently used, search by name / number / category / keyword. No "user tones" tab: there is no tone editor yet |
| Instrument categories | Done — 18 categories, 287 playable tones. Not the ~800 of §12: only tones with a real sound are listed (see `INSTRUMENTS.md`) |
| Split | Done — Lower part below a movable split point |
| Layer | Done — Upper 2 on top of Upper 1 |
| Indian instruments | Done with limits — Sitar and Shehnai from recordings; Harmonium, Shruti Box, Tanpura, Veena, Sarod, Santoor, Swarmandal, Bansuri, Pungi, Jal Tarang, Tabla, Tabla Tarang from synthesis models; Sarangi and Esraj are listed as unavailable |
| Effects | Done — reverb (6), chorus (4), delay (4), insert DSP (54 presets) |
| EQ | Done — 4-band master EQ, 10 curves + user curve, editable on a response graph |
| Arpeggiator | Done |
| Auto harmonize | Done — needs a chord in the lower zone (split), except the Octave type |

## Section by section

| § | Topic | Status | Notes |
| --- | --- | --- | --- |
| 2 | Technology | Done | React + TypeScript + Vite, Web Audio, AudioWorklet master stage, Web MIDI; real-time path kept out of React |
| 3 | Sampled piano | Done | Sympathetic resonance (marked optional) is not simulated |
| 4–5 | 61 keys, key travel | Done | |
| 6 | Playing inputs | Done | |
| 7 | Touch response | Done | OFF / SOFT / NORMAL / HARD, velocity meter on the display |
| 8 | Voice engine | Done | 64 voices; a voice can have several sample layers |
| 9 | Start-up defaults | Done | Grand on Upper 1, layer / split / arpeggio / harmony off. Rhythm does not exist yet |
| 10 | Control panel | Partial | Master, tone, display, perform, tempo/pitch, system. Rhythm, arranger, registration, pad and transport sections come with their phases |
| 11 | Display | Partial | Main, tone browser, part mixer, reverb, chorus, delay, DSP, EQ, arpeggiator, harmony, function menu, MIDI, system monitor. Rhythm / recorder / registration screens later |
| 12 | Tone engine (~800 slots) | Partial | 287 real tones in 18 categories; numbering and banks have room for more. No placeholder tones |
| 13 | Indian instrument bank | Partial | 14 playable (2 recorded, 12 modelled), 2 marked unavailable. The models are approximations |
| 14 | Tone browser | Partial | Search, category, favourites, recent; select by click, cursor keys, data wheel, number (type it in Search, Enter) and MIDI program change. User tones: later, with a tone editor |
| 15 | Layer | Done | Own tone, volume, pan, octave, transpose, sends and DSP per part |
| 16 | Split | Done | Split point by dragging the marker, by the data wheel, or in the menu |
| 17 | Transpose | Done | Global ±12 and per part ±12. Drum kits and effects are not transposed |
| 18 | Octave shift | Done | Global ±3 and per part ±2 |
| 19 | Tuning | Done | 415.5–465.9 Hz in 0.1 Hz steps |
| 20 | Sustain | Done | Panel latch, space bar, CC64. Acts on the upper parts; the lower part is left dry |
| 21 | Pedals | Done | Sustain, sostenuto, soft, expression over MIDI |
| 22 | Pitch bend | Done | Spring-loaded wheel, range 0–12, follows MIDI, all parts |
| 23 | Modulation | Partial | Vibrato per tone; rotor speed when a rotary DSP is inserted. Filter / tremolo targets are not assignable |
| 24–26 | Rhythms, Indian rhythms, arranger buttons | Later | Phase 3. The clock they will run on exists (24 ticks per beat) |
| 27 | Auto accompaniment | Partial | Chord recognition is built, shown, and used by auto harmonize; accompaniment is Phase 3 |
| 28–30 | Tempo, tap tempo, metronome | Done | |
| 31 | Effects | Done | Reverb, chorus, delay as send effects; one insert DSP per part, 54 presets (a preset is one line of data, so the ~100 the spec mentions is a matter of adding lines) |
| 32 | Equaliser | Done | Master EQ. No per-part EQ |
| 33 | Mixer | Partial | Volume, pan and sends of the three keyboard parts. The full mixer comes with the rhythm and song tracks (Phase 4) |
| 34–35 | Registrations, phrase pads | Later | Phase 5 |
| 36–40 | Recorder, piano roll, MIDI files, audio recording | Later | Phase 4 |
| 41–42 | Master volume, output meters | Done | Meters show the real output level |
| 43 | Speaker grilles | Done | Static; no animation |
| 44–45 | Performance / studio modes | Later | Phase 5 / 4 |
| 46 | Fullscreen | Done | |
| 47–49 | Visual design, buttons, data wheel | Done | |
| 50 | Responsiveness | Done | Scales as one object; scrolls sideways when the window is too narrow. Legends get small below about 1400 px width |
| 51–53 | Low latency, preloading, SampleManager | Done | Tone changes are instant for loaded tones; a model tone needs 0.1–0.4 s the first time |
| 54 | Instrument definitions | Done | `data/tones.ts`, `data/instruments.ts` |
| 55 | Rhythm definitions | Later | Phase 3 |
| 56 | Storage | Partial | Preferences, favourites, recent tones, user EQ in localStorage. IndexedDB for songs / registrations later |
| 57 | Autosave / restore session | Later | Phase 5. Preferences are saved automatically today; the performance set-up starts from factory defaults (§9) |
| 58 | Settings | Partial | Through the function menu. No separate appearance / storage pages |
| 59–61 | Keyboard help, note labels, chord display | Done | |
| 62 | Arpeggiator | Done | 7 modes, 6 rates, 8 patterns, 1–4 octaves, gate, swing, latch; on the audio clock |
| 63 | Auto harmonize | Done | Duet, Trio, Octave, Country, Block, 4-Way |
| 64 | Music presets | Later | With registrations (Phase 5) |
| 65 | Search | Partial | Tone search. Rhythm search with Phase 3 |
| 66 | Accessibility | Done | ARIA names on all controls, visible focus, keyboard operation; hold gestures always have a second route through the menu |
| 67 | Error handling | Done | Audio blocked, missing sample, tone library missing (with retry), unavailable tone, MIDI refused / unsupported / unplugged |
| 68 | Performance monitor | Done | Function → System → System monitor: latency, voices and layers, memory of grand / library / models |
| 69–70 | Module architecture, audio graph | Done | See `ARCHITECTURE.md` |
| 71 | Musical rules, panic | Done | |
| 72–73 | Visual detail, depth | Done | CSS only, no WebGL |
| 74 | First start | Done | |
| 75 | Demo songs | Later | Needs the sequencer |
| 76 | Quality bar | See below | |
| 79 | Restrictions | Respected | No dummy controls, no oscillator piano, no cloned branding, no proprietary samples, missing tones marked unavailable |
| 80 | Delivery | Done for Phases 1–2 | Rhythm metadata does not exist yet |

## Quality bar (§76)

Checked automatically in a real browser by `npm run test:e2e` — 49 checks.

*Piano (Phase 1):* single notes, repeated notes, 10-note chords, rapid playing,
sustain, sostenuto, 64 voices with stealing, pitch bend (measured in Hz),
tuning, MIDI input, computer keyboard, multi-touch, glissando,
transpose/octave, chord recognition, metronome timing, tempo changes, tap
tempo, panel controls, display navigation, quality reload, resize, panic,
power.

*Performance (Phase 2):*

- every one of the 287 tones loads and has signal; unavailable tones cannot be selected
- tone browser, search (typing does not play notes), favourites, recent
- the modelled Indian tones and Sitar / Shehnai within 14 cents at A4 (measured: all within 5)
- MIDI bank select + program change
- layer: one voice per part, per-part octave and volume, no hanging voice when switched off
- split: zones, the pedal acting on the upper zone only, dragging the split marker
- auto harmonize: chord tones below the melody in four types, nothing left hanging
- arpeggiator: pattern order, notes exactly 0.25 s apart at 120 BPM (audio clock), stops with the keys, latch
- effects: reverb and delay tails present and gone when switched off, chorus widens a mono tone, every preset selectable
- master EQ: a −12 dB band measures −11.8 dB on the output and −12.0 dB on the drawn curve; dragging a handle
- DSP: all 54 presets pass sound at a sane level; rotary takes the modulation wheel
- drum kit: not transposed, closed hi-hat cuts the open one
- changing tone while keys are held
- the tone library file missing: grand and models still play, the display explains, retry works
- every enabled button on the panel and display has a handler
- at the end: no stuck notes, silence, no console errors

Plus 73 unit tests (`npm test`).

Not applicable yet: rhythm sync, accompaniment, recording, playback.

## Not verified — please check

- **Listening.** The tests measure levels, pitch, timing, tails and silence.
  Nobody has listened to this build. That matters most for the **modelled
  Indian tones**: they are in tune and at the right level, but whether a
  harmonium or tanpura *sounds right* only an ear can tell. The same goes for
  the balance between tones and for the effect amounts.
- **A real MIDI keyboard** and pedal (program change included).
- **A real touch screen.**
- **Latency on the actual audio device** (see the system monitor).
- **Firefox and Safari.** The tests ran in Chromium only.
- **`start.bat` on Windows.** Written carefully, not run.
- **CPU load on a modest laptop** with layer + split + effects and dense
  playing. A stress run in the test browser showed no drop-outs, but that
  machine is not yours.

## Known limits of Phase 2

- The SoundFont engine evaluates modulators at note-on only (velocity, key).
  Presets that rely on controller-driven modulators sound as they do with the
  controllers at rest.
- Selecting a model tone for the first time computes it on the main thread
  (0.1–0.4 s, the rest of its range in the background); a key pressed in that
  moment can be late.
- Effect sends are reset to the tone's defaults when a part's tone changes.
- One insert DSP per part; DSP parameters are presets, not individually editable.
- The arpeggiator plays the upper zone (both upper parts when layer is on).
