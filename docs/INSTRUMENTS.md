# Tones, engines and sound metadata

All tone data lives in `src/data/`, separate from engine and UI code. This
file lists what the instrument can play, how each kind of tone is produced,
and how to add more.

## The tone list

`src/data/tones.ts` builds one table, `TONES`, numbered 001–289 in browser
order. **Only tones that really have a sound are playable.** A tone the
instrument cannot produce is listed with `available: false` and a reason; the
browser shows it greyed out with *N/A* and refuses to select it — it is never
pointed at another tone's sound.

| Category | Numbers | Tones | Source |
| --- | --- | --- | --- |
| Piano | 001–012 | 12 | Concert Grand (Salamander) + 11 SoundFont |
| E.Piano | 013–020 | 8 | SoundFont |
| Organ | 021–040 | 20 | SoundFont |
| Strings | 041–062 | 22 | SoundFont |
| Choir | 063–066 | 4 | SoundFont |
| Brass | 067–078 | 12 | SoundFont |
| Woodwind | 079–099 | 21 | SoundFont |
| Guitar | 100–117 | 18 | SoundFont |
| Bass | 118–131 | 14 | SoundFont |
| Synth | 132–148 | 17 | SoundFont |
| Lead | 149–165 | 17 | SoundFont |
| Pad | 166–178 | 13 | SoundFont |
| Mallet | 179–192 | 14 | SoundFont |
| Percussion | 193–207 | 15 | SoundFont |
| Drum kits | 208–220 | 13 | SoundFont |
| World | 221–227 | 7 | SoundFont |
| Indian | 228–243 | 16 | 2 SoundFont, 12 models, 2 unavailable |
| SFX | 244–289 | 46 | SoundFont |

287 playable, 2 unavailable. `TASKS.md` §12 speaks of about 800 tone slots:
the numbering, banks and categories have room for them, but this build lists
only what it can actually sound. Reaching 800 means adding further sample
libraries (see "Adding tones" below), not relabelling these.

## Three tone engines

Whatever the source, a tone hands the voice engine the same thing for a note:
one or more *layers* (`audio/voiceTypes.ts`) — a buffer, a pitch ratio, level,
pan, loop, volume envelope, optional filter, LFO and pitch envelope.

### 1. `grand` — the sampled concert grand

Salamander Grand Piano V3, described in the second half of this file.

### 2. `sf2` — SoundFont presets (real recordings)

`audio/sf2/SoundFont.ts` reads `public/soundfonts/GeneralUser-GS.sf2` (920
samples, 31 MB) and `audio/sf2/SoundFontInstrument.ts` plays its presets:

- key and velocity zones, layered and stereo zones, global zones, preset and
  instrument generators combined as the SF2 specification prescribes
- root key, tuning, scale tuning, sample offsets, loops (continuous and
  loop-until-release)
- volume envelope (delay, attack, hold, decay, sustain, release, key scaling)
- low-pass filter with resonance, modulation envelope to filter and to pitch
- vibrato / modulation LFO to pitch, filter and volume
- exclusive classes (a closed hi-hat cuts the open one)
- modulators that depend on the strike — velocity to level and brightness, key
  number — evaluated at note-on

Not implemented: modulators driven by MIDI controllers during a note (the
modulation wheel is handled by the part instead: vibrato, or rotor speed with
a rotary DSP), the second LFO when a zone uses both, per-zone reverb / chorus
sends (sends are set per tone, by category), and 24-bit sample data.

The preset list is known before the file is loaded:
`src/data/sf2Presets.generated.ts` is produced by `npm run tones`. Samples are
converted to audio buffers the first time a tone needs them.

MIDI bank 120 duplicates of the drum kits in the file are not listed twice.

### 3. `model` — tones computed from synthesis models

`audio/models/indianModels.ts`. Each model renders the notes of one instrument
into buffers when the tone is selected (0.1–0.4 s); after that it plays through
the same voice engine as a sample. **These are approximations.** They are
tuned and levelled by measurement — every model is within a few cents at the
keys tested — but their *character* has to be judged by ear, and good
recordings would beat them.

| Tone | Model |
| --- | --- |
| Harmonium | Free reeds: additive loop with a bass reed an octave below the male reed, slight detuning between the reeds, bellows attack |
| Shruti Box | The same reeds without the bass coupling, slower bellows — a drone |
| Pungi | Narrow, nasal double reed with a strong formant |
| Bansuri | Flute partials plus breath noise shaped around the note; a small scoop into the pitch and vibrato that arrives late |
| Tanpura | Plucked string on a wide curved bridge: the *jawari* buzz is modelled inside the string loop, so the upper partials keep regenerating as the note rings |
| Veena, Sarod | Plucked strings with different pluck position, damping, brightness and amount of jawari |
| Santoor | Hammered string pairs, slightly detuned, bright and short |
| Swarmandal | Light plucked harp-like strings with a long ring |
| Jal Tarang | Struck water bowls: a few inharmonic modes that decay at different rates |
| Tabla | Twelve strokes, one per pitch class, repeated on every octave: Ge, Ge↑, Ke, Ge↓, Na, Tin, Te, Tun, Ti, Dha, Dhin, Tak. Dayan tuned to C#4, bayan with its pitch bend. A kit: transpose and octave do not move it. |
| Tabla Tarang | Tuned dayans played melodically |
| **Sitar**, **Shehnai** | Not models: recordings from the SoundFont |
| *Sarangi*, *Esraj* | **Unavailable.** A bowed instrument cannot be modelled convincingly with these methods; they need recordings. |

Rendered model tones take 2–40 MB each. The instrument keeps the ones in use
and the most recent others within about 90 MB and renders older ones again
when they are selected.

## `ToneDef` — one entry of the tone table

| Field | Meaning |
| --- | --- |
| `id`, `number`, `name`, `category` | Identity and place in the browser |
| `bank`, `program` | MIDI bank select (CC 0) + program change that select the tone |
| `available`, `unavailableReason` | `false` marks a tone without a sound, with the text shown to the player |
| `engine` | `grand`, `sf2` or `model` |
| `sf2` | Preset address in the SoundFont (bank, program) |
| `model` | Key of the model in `MODELS` |
| `range` | Sounding range (MIDI notes) |
| `gainDb` | Level trim |
| `reverbSend`, `chorusSend` | Sends the part gets when the tone is selected |
| `modulation` | What the modulation wheel does (vibrato rate and depth) |
| `fixedPitch` | Drum kits and effects: keys keep their sounds when the keyboard is transposed |
| `tags` | Extra words for the search box |

### Levels

Every tone was measured at velocity 100, effects off (100 ms RMS and peak) and
trimmed so the tones sit beside the concert grand: the SoundFont's presets,
which its author balanced against each other, share one trim (−1 dB, drum kits
−3 dB), five presets that measured much hotter than the rest get an extra cut,
and each model has its own. Leaving the sound effects aside, about four out of
five tones measure within ±5 dB of the grand; the rest are mostly quiet by
nature (slow pads, harpsichords, soft percussion).

## Effect and performance presets

| File | Content |
| --- | --- |
| `data/reverbPresets.ts` | 6 reverbs: Room, Studio, Stage, Hall, Concert Hall, Cathedral |
| `data/effectPresets.ts` | 4 choruses (Light, Classic, Wide, Ensemble); 4 delays (Slapback, Stereo, Tempo Delay, Ping Pong); the 4 EQ bands and 10 curves; 54 DSP presets over 8 algorithms |
| `data/arpPatterns.ts` | Arpeggiator modes, rates and 8 patterns (Alberti, Broken Octave, Pulse, Off-beat, Gate 16, Waltz, Tihai 3+3+2, Climb) |
| `music/Harmonizer.ts` | The six harmony types |

Adding a preset is adding a line to the table; numbering and menus follow.

Each DSP preset carries a loudness trim (`DSP_TRIM_DB`), measured against the
bypassed part with a held organ chord, so switching an insert on changes the
sound and not the volume (all 54 land between −3 and +4 dB RMS). The
compressor presets also cancel the make-up gain the browser's compressor node
adds on its own (5–13 dB with these settings, see
`audio/dsp/compressorMakeup.ts`); a preset's `makeup` value is what a quiet
signal really gets.

## Adding tones

**Another SoundFont preset** is already in the list if it is in the file. To
use a different SoundFont, replace the file, run `npm run tones` and adjust the
category mapping and trims at the top of `data/tones.ts`. Check the licence of
anything you ship.

**A model tone:** add a `ModelDef` to `MODELS` in
`audio/models/indianModels.ts` and a line to `INDIAN_MODELS` in
`data/tones.ts`. The unit tests check every model for finite output, level and
pitch.

**A multi-sampled instrument like the grand:** see below.

---

## The concert grand in detail

`src/data/instruments.ts` describes the sample set and the instrument.

### `SampleSetDef` — a set of recordings

| Field | Meaning |
| --- | --- |
| `id`, `name` | Identifier and display name |
| `baseUrl` | Folder under `public/`, e.g. `samples/salamander-grand/` |
| `pattern` | File name pattern, `{layer}/{note}.mp3` — `{note}` is the 3-digit MIDI number |
| `roots` | MIDI notes that have a recording. Other notes are pitched from the nearest one. |
| `layers` | Velocity layers, softest first: `id` (folder) and `levelDb`, the layer's measured loudness relative to the loudest |
| `release` | Optional key-release samples: `pattern`, note range, playback level |
| `stereoBalance` | Optional: correct every recording's left/right balance to a smooth image |
| `attribution` | Title, author, licence, URL — required by CC BY |

### Salamander Grand Piano as shipped

- 30 recordings per layer, every minor third from A0 (21) to C8 (108)
- 6 of the original 16 velocity layers: `v01 v04 v07 v10 v13 v16`
- 88 key-release samples (`rel/021.mp3` … `rel/108.mp3`)
- 44.1 kHz stereo MP3, 33 MB on disk

Measured layer loudness (mean RMS of the first 400 ms, relative to `v16`):

| Layer | v01 | v04 | v07 | v10 | v13 | v16 |
| --- | --- | --- | --- | --- | --- | --- |
| dB | −22.0 | −13.1 | −9.8 | −7.2 | −4.1 | 0 |

These numbers decide which layer a velocity selects. The exact gain of each
note is calibrated at load time from the decoded audio (see
`docs/ARCHITECTURE.md` §3), so they do not need to be precise.

To import other layers from the original packages:

```bash
npm install --no-save @audio-samples/piano-mp3-velocity5   # any of 1…16
# add the layer number to LAYERS in scripts/import-salamander.mjs, then
node scripts/import-salamander.mjs node_modules/@audio-samples
```

and add the layer with its measured `levelDb` to the set and to a quality tier.

### Quality tiers

| Tier | Layers | Tail | Decoded size, 61 keys at 48 kHz |
| --- | --- | --- | --- |
| `light` | v04 v10 v16 | cut at −34 dB or 6 s | ≈ 130 MB |
| `standard` | v01 v07 v13 v16 | cut at −40 dB or 10 s | ≈ 260 MB |
| `full` | all six | as recorded | ≈ 660 MB |

### `InstrumentDef` of the grand

`velocityDb` (loudness law, 36·log₁₀(velocity/127)), `velocityFloorDb`,
`release` (damper release time constants, and `undampedFrom`: the first note
without a damper, F#6), `decay` (natural decay times, used to rank voices for
stealing), `modulation`, `effects.reverbSend`.

## Other metadata

- `src/data/metronomeSounds.ts` — the four metronome voices
- `src/data/keyboardLayout.ts` — geometry of the 61 keys (drawing and hit-testing)
- `src/data/keymap.ts` — computer keyboard map

Rhythm metadata (`TASKS.md` §55) does not exist yet: rhythms are Phase 3.
