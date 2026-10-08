# Architecture

This document explains how PVA-61 is put together. Sections 1–9 describe code
that exists today (Phases 1 and 2). Sections 10–12 describe engines that are
**not built yet**; for those it states where they will plug in, so the later
phases extend the system instead of rewriting it.

## The one rule

**Music does not go through React.** Note on/off, key travel, pitch bend,
meters, the arpeggiator and the beat lamps run on direct calls and imperative
DOM updates. React state (`state/appState.ts`) only holds what the *panel*
shows — tones, tempo, the selected parameter — and changes a few times a
second at most. A fast passage with 64 voices causes zero React renders.

```
 mouse / touch ─┐                        ┌─ Arpeggiator ◀─ Clock
 computer keys ─┼─▶ KeyboardController ──┼─ Harmonizer ◀─ ChordDetector
 MIDI ──────────┘     │  (zones, parts)  └▶ VoiceManager ─▶ Part ×3 ─▶ master ─▶ speakers
                      │                          ▲              ▲
                      │                          │              └ InstrumentManager
                      │                          └ SustainManager   (grand · SoundFont · models)
                      ├─▶ 'key' events ─▶ keybed DOM (class toggle)
                      └─▶ 'chord' ─▶ store ─▶ display
 panel buttons ─▶ actions ─▶ engines + store ─▶ display
```

`src/services.ts` is the composition root: it creates every engine once and
wires them. UI code reaches engines only through `services()` and the functions
in `state/actions.ts`.

## 1. Audio engine

`audio/AudioEngine.ts` owns the `AudioContext` (created with
`latencyHint: 'interactive'`) and the master section.

```
 voices → Part: volume → expression → [insert DSP] → pan ─┬─ dry ────────────────────┐
          (Upper 1, Upper 2, Lower)                       ├─ reverb send → reverb ───┤
                                                          ├─ chorus send → chorus ───┤
                                                          └─ delay send  → delay ────┤
 metronome ──────────────────────────────────────────────────────────────────────────┤
                                                                                     ▼
                                    masterIn → master EQ (4 bands) → master stage → output
```

The **master stage** is an `AudioWorkletProcessor`
(`public/worklets/master-processor.js`) that does three things in one pass on
the audio thread:

- **Master gain**, smoothed over ~12 ms so the volume knob never zippers.
  The panel value 0–100 maps to gain = (v/100)², so 75 ≈ −5 dB.
- **Peak limiter** with instant attack, ~120 ms release and *no look-ahead*.
  A look-ahead limiter would delay every note; this one only acts when the
  summed output would exceed −1 dBFS. It works on the signal *after* the
  volume control (output-referred), so turning the volume down gives headroom
  back instead of wasting it.
- **Metering**: true sample peak, RMS and gain reduction, posted to the UI
  about 50 times a second. The meters show this real data with standard
  ballistics (instant rise, 26 dB/s fall, 1.4 s peak hold).

If `AudioWorklet` is unavailable the engine falls back to
`DynamicsCompressor → Gain → Analyser`, so the instrument still plays.

Gain staging, measured at volume 75: a single piano note peaks at about
−24 dBFS at velocity 64 and −12 dBFS at velocity 127; a ten-note chord at
velocity 100 peaks near −4 dBFS, and only a ten-note chord at full velocity
reaches the −1 dBFS ceiling. The other tones are trimmed to sit beside the
piano (`INSTRUMENTS.md`, "Levels"). The limiter is a safety net, not part of
the sound — though a dense layered passage with everything switched on will
reach it.

**Latency.** The instrument adds: at most one render quantum (128 frames,
2.7–2.9 ms) between the key event and the start of the sample, plus a median
1 ms before a piano recording's attack. Everything else is the browser's
output buffer and the audio device; the actual figures for your machine are
shown under *Function → System → System monitor*. Wired headphones or speakers
give the lowest latency. Bluetooth audio adds a large delay of its own that no
software can remove.

**Strips keep rendering in silence.** Browsers stop processing a chain of
nodes that has no running source, and a parameter change made in that state
only starts to glide when the next note arrives — a volume or send changed
between two phrases would be heard moving at the start of the next note. Each
part (and the metronome bus) therefore has a silent constant source feeding
it. The end-to-end tests caught this; it is why "reverb off" is really off for
the very next note.

## 2. Voice management

`audio/VoiceManager.ts`. A voice is one note of one part. It consists of one
or more **layers** (`audio/voiceTypes.ts`) — the grand uses one, a SoundFont
preset one to five (stereo pairs, stacked sounds), a model tone one:

```
AudioBufferSourceNode ─▶ [BiquadFilter] ─▶ GainNode (envelope) ─▶ [StereoPanner] ─▶ Part input
        ▲ detune                ▲ detune          ▲ gain
        │                       │                 └─ LFO (tremolo)
        ├── Part pitch bus (bend + vibrato + tuning, cents)
        ├── modulation envelope (pitch)  ── also drives the filter
        └── LFO (vibrato)
```

A layer's **volume envelope** has delay, attack, hold, decay to a sustain
level and an exponential release; the **modulation envelope** is linear and
moves pitch and filter cut-off. Everything is scheduled on the audio clock at
note-on; key-up starts the release from exactly the level the envelope has
reached.

Life cycle of a voice:

```
held ──key up──────────────▶ releasing ─▶ ended
  ├─key up, pedal down─────▶ sustained ──pedal up──▶ releasing
  ├─key up, undamped note──▶ ringing (top of a piano) ─▶ ended
  └─stolen / cut / panic───▶ dying (≈25 ms fade) ─▶ ended
```

Every path ends in `ended` (when the last layer's source has finished, the
voice is removed and its nodes disconnected), and no path stops a source
without a fade. That is what guarantees no stuck notes and no clicks; the
end-to-end tests check both.

- **Release** follows the tone: the piano's dampers 0.20 s (bass) to 0.06 s
  (treble); a SoundFont zone's own release time; a model's.
- **Same key struck again**: the earlier strike fades under the new attack.
  At most two older voices of one note may ring out, so fast repetition cannot
  eat the polyphony.
- **Exclusive classes**: a layer can name a class; a new note of that class
  cuts sounding voices of the same class on the same part within ~12 ms
  (closed hi-hat stops the open one).
- **Polyphony** is 64 voices, and at most 160 layers. When the limit is hit,
  the victim is chosen in this order: voices already releasing; then
  pedal-held or ringing voices; then held voices — inside each group the
  quietest (estimated from the note's natural decay), ties going to the
  oldest. Voices younger than 30 ms are spared. The victim fades in ~25 ms.
- **Key-off noise**: the grand plays its key-release sample quietly when a key
  lifts without the pedal (can be switched off in the menu).
- `releaseVoice(voice, when)` ends one voice at a programmed time, ignoring
  the pedals — the arpeggiator uses it for note lengths.

## 3. Tones

`audio/InstrumentManager.ts` turns a tone id into something playable. Every
tone implements one method, `pick(note, velocity)`, which returns the layers
of a voice or `null`; the voice engine knows nothing else about where sound
comes from. `prepare(toneId, low, high)` makes a tone playable for a key range
and resolves when it is; concurrent requests share the work.

### 3.1 The sampled grand

`audio/SampleManager.ts` is the only code that fetches or decodes the piano.

- **Loading order.** One velocity layer first (the mezzo-forte one) for the 61
  keys. The instrument is playable as soon as that is decoded — typically
  about a second from a local disk. The remaining layers, then the key-release
  samples, load in the background. Four files are decoded at a time.
- **Trimming.** Each recording is cut to start just before its attack (this
  removes MP3 padding and pre-attack key noise, 10–60 ms that would otherwise
  be felt as latency) and, depending on the quality setting, shortened at the
  end with a fade.
- **Stereo balance.** The Salamander set jumps between −7 dB and +13 dB (right
  minus left) from one recording to the next. Each recording is corrected to a
  smooth player's-seat image, preserving loudness.
- **Loudness calibration.** The attack level of every recording is measured.
  `pick()` then sets each voice's gain so that loudness follows one law —
  level = 36·log₁₀(velocity/127) dB — relative to *that note's own loudest
  recording*. Changing velocity layer changes timbre only.
- **Note mapping.** A recording every minor third; other notes are pitched by
  at most one semitone.
- **Fallback.** A missing or broken file is reported on the display and lookup
  falls back to a neighbouring layer, then a neighbouring recording.
- **Range on demand.** Only the keys that can sound are loaded; transpose and
  octave shift fetch the extra recordings in the background.

### 3.2 SoundFont tones

`audio/sf2/SoundFont.ts` is a pure parser (unit-tested under Node): it reads
the RIFF tables and resolves a preset into flat *regions* — key range,
velocity range, sample, and the final value of all 60 generators with
instrument, preset and global zones combined. `SoundFontInstrument.pick()`
turns the regions that match a note into layers, evaluating the
velocity- and key-driven modulators at that moment.

The 31 MB file is fetched once, after the grand is playable, and kept in
memory. A sample is converted from 16-bit to an `AudioBuffer` the first time a
tone needs it (`SoundFontBank`); selecting a tone warms the buffers of the
playing range in the background, so the first notes do not wait. If the file
cannot be loaded, SoundFont tones cannot be selected, the display says so and
offers a retry; the grand and the models keep working.

What the engine implements and what it leaves out is listed in
`INSTRUMENTS.md`.

### 3.3 Model tones

`audio/models/`. `dsp.ts` holds the building blocks: an FFT, seamless additive
loops (whole cycles of every partial; the exact pitch comes from the buffer's
own sample rate), an extended Karplus-Strong string with fractional delay,
loss filter and a jawari bridge, modal synthesis, noise bursts. A string or
bar model does not land exactly on pitch by construction, so every rendered
note is *measured* (autocorrelation) and corrected through its sample rate.

`indianModels.ts` describes each instrument with these blocks;
`ModelInstrument` renders the needed notes into buffers — the middle of the
keyboard before the tone becomes selectable, the rest in the background — and
from then on the tone plays like a sample. Rendered tones are kept within a
memory budget (least recently used are dropped).

## 4. Parts, split and layer

`input/KeyboardController.ts` is the performance router. There are three
keyboard parts, each a channel strip (`Part` in `audio/MixerEngine.ts`) with
its own tone, volume, pan, octave, transpose, sends, insert and pitch bus:

| Part | Sounds when | Keys |
| --- | --- | --- |
| Upper 1 | always | the whole keyboard, or from the split point up |
| Upper 2 | LAYER is on | the same keys as Upper 1 |
| Lower | SPLIT is on | below the split point |

For every pressed key the controller remembers exactly which notes it started
on which parts. Key-up releases those — not whatever the settings say at that
moment — so changing transpose, octave, split point, layer or tone while keys
are down can never leave a note hanging. Changing a part's tone, or the
routing, lets the affected notes go.

Drum kits and effects have `fixedPitch`: keys keep their sounds whatever the
transpose and octave settings are.

## 5. MIDI routing

`midi/MidiManager.ts` turns Web MIDI bytes into events and knows nothing about
sound. `KeyboardController` subscribes:

| Message | Route |
| --- | --- |
| Note On / Off (any channel) | `keyDown` / `keyUp` — the same path as the on-screen keys, so touch response, split, layer, arpeggiator, transpose and key travel all apply |
| CC64 / 66 / 67 | `SustainManager`: sustain, sostenuto, soft (upper parts) |
| CC1, channel aftertouch | modulation: vibrato, or rotor speed when the part has a rotary DSP |
| CC7 | master volume (the knob moves) |
| CC11 | expression |
| CC0 + Program Change | tone of Upper 1 (`toneByProgram`) |
| Pitch bend | pitch bus of every part; the wheel on screen follows |
| CC120 / CC123 / CC121 | all sound off / all notes off / reset controllers |

Devices are hot-plugged. When a device in use disappears, the controller
releases every note and pedal that device was holding. MIDI messages do not
count as a user gesture for the browser, so until audio has been unlocked a
MIDI note shows a hint on the display instead of queueing up silently.

## 6. Sustain logic

`audio/SustainManager.ts`. A pedal can be held by several sources at once —
the panel SUSTAIN latch, the space bar, a MIDI pedal. It is *down* while at
least one source holds it and lifts when the last lets go.

- **Sustain down:** a key-up marks the voice `sustained` instead of releasing it.
- **Sustain up:** every `sustained` voice enters its normal release envelope.
- **Sostenuto:** captures the voices whose keys are down at the moment it is
  pressed; only those are held.
- **Soft:** scales incoming velocity by 0.72, which selects a softer recording
  as well as a lower level.

The pedals act on Upper 1 and Upper 2. The Lower part is left alone, as on an
arranger keyboard, so a held bass note or chord does not smear.

## 7. Effects

`audio/EffectsEngine.ts` — three **send effects** shared by all parts. Each
part has its own send levels; the returns go to the master.

- **Reverb.** A `ConvolverNode` with impulse responses generated at run time
  from six presets (`audio/reverbIR.ts`): sparse early reflections followed by
  a diffuse two-band tail whose high band decays faster. Changing preset
  cross-fades between two convolvers; the old tail rings out.
- **Chorus.** Two to four modulated delay lines per preset, panned across the
  stereo field. Their LFOs are looping buffers rather than oscillators, so
  each can start at a chosen phase and the voices sweep against each other.
- **Delay.** Two delay lines with self- and cross-feedback and a tone filter
  in the loop. The send is summed to mono first, so "Ping Pong" really
  alternates sides. Two presets follow the tempo; delay times glide, so a
  tempo change bends the repeats instead of clicking.

**Insert DSP** (`audio/dsp/inserts.ts`): one effect per part, in the strip
before the pan: compressor, overdrive, amp simulation, tremolo, phaser,
flanger, auto-wah, rotary speaker — 54 presets. An insert is swapped behind a
25 ms fade of that part, so changing it never clicks. An effect may take the
modulation wheel (the rotary's rotor speed); the controller then stops adding
vibrato to that part.

**Master EQ**: four filters in the master chain (low shelf, two peaking bands,
high shelf). `AudioEngine.eqResponse()` computes the curve drawn on the display
from filters with exactly the settings in use, so the graph and the sound
cannot disagree (the tests compare them).

The metronome bypasses all effects.

## 8. Clock, arpeggiator, harmonizer

`audio/Clock.ts` is a look-ahead scheduler: a timer in a Web Worker (not
throttled in background tabs) wakes every 25 ms and schedules every tick of
the next 120 ms on the audio clock. The grid is 24 ticks per quarter note,
which gives every straight and triplet value down to 1/32 a whole number of
ticks. Tempo changes apply from the next tick. Users *acquire* the clock under
a name and release it; it runs while anyone holds it (metronome, arpeggiator,
later the rhythm engine and sequencer — all on one grid).

`audio/Metronome.ts` listens to the beats and synthesises the clicks. The beat
lamps are driven from the same beats, delayed by the output latency so they
flash with the sound.

`music/Arpeggiator.ts`. `arpSequence()` is a pure function from the held
notes and the settings to a list of steps (unit-tested). The class walks that
list on the tick grid and hands each note to the controller with its start
and end time *on the audio clock* — timing does not depend on the UI thread.
Swing delays every second step; gate sets the note length; latch keeps the
chord after the keys are lifted. Keys of the upper zone go to the arpeggiator
instead of sounding directly while it is on.

`music/Harmonizer.ts`. `harmonize(type, melody, chord)` returns the notes to
add, also a pure function. The chord comes from `ChordDetector` looking at
the lower zone (it is remembered after the chord is released, so the left hand
can move). Harmony notes are played slightly softer than the melody and
belong to the melody key: they end with it.

## 9. State, display and storage

`state/appState.ts` is the panel state; `state/actions.ts` holds every change
the panel can make (validate → engines → store → persist). `state/params.ts`
is a registry with one description per editable value; the display pages, the
data wheel, the −/+ buttons and the cursor keys all work from it, so most
pages are just lists of parameter ids (`PAGE_GROUPS`). The tone browser and
the EQ graph are the two pages with their own components.

`storage/StorageManager.ts` stores preferences in `localStorage` under
`pva61.preferences` — versioned, and validated key by key on load so a damaged
entry falls back to defaults instead of breaking start-up. Stored: touch, key
map, metronome, MIDI input, sample quality, favourites, recently used tones,
the user EQ curve. The performance set-up (tones, layer, split, tempo,
transpose, effects) deliberately starts from the factory defaults every time,
as `TASKS.md` §9 specifies. Registrations, songs and session restore
(Phases 4–5) will use IndexedDB behind the same class.

## 10. Rhythm engine — not built (Phase 3)

The transport exists (section 8). The plan is a data-driven `RhythmEngine`
subscribing to the same tick grid, playing tracks (drums, percussion, bass,
chords, pad, phrases) through their own `Part` instances. The drum kits and
the tabla are already playable tones.

## 11. Arranger engine — not built (Phase 3)

`music/ChordDetector.ts` recognises the chord from sounding notes (27
templates, inversions as slash chords, ambiguous sets resolved by the bass
note). The arranger will consume it and switch intro / variation / fill /
ending sections on bar boundaries of the clock, transposing the accompaniment
to the detected chord.

## 12. Sequencer — not built (Phase 4)

Every performance event already passes through one place,
`KeyboardController` (`keyDown`, `keyUp`, controllers, pedals). The recorder
will tap that stream with clock timestamps, and playback will call the same
`VoiceManager` / `SustainManager` methods on per-track parts.

## Extending

- **A new tone:** see `docs/INSTRUMENTS.md`, "Adding tones".
- **A new setting:** add one entry to `state/params.ts` and an action in
  `state/actions.ts`, and put its id on a page in `PAGE_GROUPS`.
- **A new effect preset:** a line in `data/effectPresets.ts`.
- **A new part** (rhythm track, song track): `mixer.createPart(id)` gives a
  channel strip with its own sends, insert and pitch bus.
