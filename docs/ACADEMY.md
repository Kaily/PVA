# Piano Academy — architecture and status

The Piano Academy is a teaching mode inside PVA-61. It is **not** a second
piano: it uses the instrument's own keybed, sound engine, input handling,
clock and storage, and replaces only the control panel while it is open.

This document covers **Phase 1 (analysis)** and **Phase 2 (the Happy Birthday
working demo)** of the Academy plan. Levels 0–5 are not built yet — on
purpose: the plan says not to start the full Academy until the demo works,
and not to add chapters without real teaching content.

User instructions in simple Hindi: [`ACADEMY-GUIDE-HI.md`](ACADEMY-GUIDE-HI.md).

## 1. What the existing instrument gave us (Phase 1)

| Need of the Academy | Existing part reused | Change made |
| --- | --- | --- |
| Large virtual keyboard | `ui/keyboard/Keybed.tsx` (61 keys, C2–C7) | Each key now carries `data-midi` and an empty `.key__mark` span for highlights |
| Sound | `KeyboardController` → `VoiceManager` → grand piano | New `controller.playNote()` (the arpeggiator's programmed-note path, made public) and `controller.cutNotes()` |
| Mouse / touch / computer keys / MIDI | `KeyboardController.keyDown/keyUp` — every input already ends here | The `key` event now also says which `source` pressed the key |
| MIDI details | `MidiManager`: note-on velocity 0 = note-off, hot-plug, `disconnected` event | none |
| Timing | `audio/Clock.ts` look-ahead scheduler, 24 ticks per beat on the audio clock | none |
| Metronome sound | `audio/Metronome.ts` | New `clickAt(time, accent)` so the lesson can click without switching the panel metronome on |
| Programmed note lengths | `VoiceManager.releaseVoice()` | A second call with an earlier time now moves the release forward (needed to cut notes on pause) |
| Storage | `storage/StorageManager.ts` (localStorage, versioned envelope) | none — the Academy stores under `pva61.academy` |
| Styling | panel sections, `PanelButton`, LCD screen look, Font Awesome | `styles/academy.css` |

No new dependency and no database were added. Existing behaviour is
unchanged: the full end-to-end suite (49 checks) and the 73 original unit
tests still pass.

## 2. Components

```
src/academy/
  content/happy-birthday.json   song data (phrases, notes, beats, fingers, lyrics, hand shifts, tips)
  content/index.ts              loads and validates the songs
  song.ts                       Curriculum data model + compiler to the clock grid (pure)
  validation.ts                 Note Validation Engine + Timing and Rhythm Validation (pure)
  scoring.ts                    results, accuracy, Hindi comments (pure)
  progress.ts                   Progress Tracking (pure functions over the stored data)
  LessonEngine.ts               Lesson Engine + Song Sequencer + Input Adapter + MIDI handling + storage I/O
  KeyHighlighter.ts             Keyboard Highlight Controller (class toggles on the keybed)
  actions.ts                    open / close, instrument checks, computer-key lookup
  ui/AcademyPanel.tsx           Learning Academy UI
  ui/HandDiagram.tsx            right hand with the finger to use
```

The mapping to the list in the prompt (§9):

| Prompt component | Where |
| --- | --- |
| Learning Academy UI | `ui/AcademyPanel.tsx`, `styles/academy.css` |
| Curriculum Management | `song.ts` + `content/` (JSON) |
| Lesson Engine | `LessonEngine.ts` |
| Song and Note Sequencer | `LessonEngine` timeline on `Clock` ticks |
| Input Adapter | `LessonEngine.onKey` (filters by source: all / computer / MIDI) |
| MIDI Event Handler | existing `MidiManager` + `KeyboardController`; the Academy listens to `disconnected` |
| Note Validation Engine | `validation.ts` (`judgeStep`, `GuidedMatcher`, `alignPerformance`) |
| Timing and Rhythm Validation | `validation.ts` (`timingVerdict`, `analyseRhythm`) |
| Audio / Playback Integration | `controller.playNote`, `metronome.clickAt` |
| Keyboard Highlight Controller | `KeyHighlighter.ts` |
| Progress Tracking | `progress.ts`, `scoring.ts` |
| Local Data Storage | `StorageManager` key `academy` |

Lesson logic is not in the UI: the panel only reads `academy.store` and calls
engine methods.

## 3. The song format

```jsonc
{
  "id": "happy-birthday",
  "timeSignature": { "beats": 3, "unit": 4 },
  "pickupBeats": 1,                    // the song starts on beat 3
  "tempo": { "default": 60, "min": 30, "max": 120 },
  "phrases": [
    { "title": "Phrase 1", "lyric": "Happy birthday to you", "tip": "…Hindi…",
      "notes": [
        { "note": "G4", "beats": 0.75, "finger": 1, "lyric": "Hap-" },
        { "note": "G4", "beats": 0.25, "finger": 1, "lyric": "py" },
        { "note": "G5", "beats": 1, "finger": 5, "lyric": "birth-", "shift": "…Hindi…" }
      ] }
  ]
}
```

`compileSong()` checks every value (note names, fingers 1–5, lengths on the
1/24-beat grid, pickup shorter than a bar) and lays the notes out in ticks.
A new song is a new JSON file plus one line in `content/index.ts`.

**Happy Birthday as written:** 3/4, pickup on beat 3, each "Hap-py" a dotted
eighth + sixteenth, "you" a half note (dotted half at the end). 25 notes,
9 bars. The melody is exactly the four phrases of the prompt. Fingering
starts with the thumb on G4; the octave leap in phrase 3 and the return in
phrase 4 are taught as explicit hand shifts.

## 4. Timing

- Playback, count-in and practice clicks run on the instrument's `Clock`
  (audio-clock time, 25 ms worker timer, 120 ms look-ahead). The lesson
  starts on a beat of the clock, so a running arpeggio stays in step.
- Tempo changes apply from the next tick — no jump, also in the middle of a
  note.
- Keys light when the note is **heard** (scheduled time + output latency),
  the same rule as the panel's beat lamps.
- **Pause** cuts every programmed note, including ones already scheduled but
  not yet sounding. Watch resumes at the beat of the note that was playing;
  Guided resumes with a count-in at the phrase that was being played.
- Guided Practice converts a key press to a song position from the last
  scheduled tick. A press belongs to the nearest due note within ±½ beat
  (never past the midpoint to a neighbour, so the short "Hap-py" notes are
  told apart). Within ±0.2 beat is "on time".

## 5. The four modes

| Mode | Keys | Judged | Stored |
| --- | --- | --- | --- |
| A Watch & Listen | green = sounding, blue = next two, gold when a phrase ends | — | "watched" once played through |
| B Step-by-Step | green = next key with finger and name, blue = next two | right key only; a wrong key pressed together with the right one is not counted | accuracy = right / all presses |
| C Guided Practice | green follows the music, count-in shown | key + timing; notes let go after less than half their length get a remark | accuracy, timing % |
| D Independent | nothing | alignment of what was played with the melody; rhythm at the player's own tempo | accuracy, rhythm %, detected BPM |

A mode is **passed** with a whole-song run at ≥ 70 % (Step), 75 % (Guided),
80 % (Independent). The lesson counts as complete after Watch + the three
passes. Single-phrase runs and loop passes are stored too, but do not pass a
mode.

## 6. Tests

| Command | What |
| --- | --- |
| `npm test` | 92 unit tests — 19 new ones for the Academy: note parsing, the exact melody and rhythm of the song, bar layout, invalid data, step / guided / performance validation, scoring, progress, damaged storage |
| `npm run build && npm run test:academy` | 12 browser checks of the demo (below) |
| `npm run test:e2e` | the instrument's 49 existing checks, unchanged, still passing |

Academy browser checks (all passing, Chromium):

1. The Academy replaces the panel; the keybed stays; panel metronome paused, lesson tempo 60.
2. Watch: all 25 notes with the right pitch; onsets exact to < 2 ms; "Hap-" exactly three times "py"; keys light 20 ms (median) after the note is heard.
3. Pause stops the notes (including scheduled ones), Resume continues at the paused note, slowing to 40 BPM mid-song changes the spacing exactly, Restart begins at G4.
4. Step: green G4 with "1" and "G4" on the key, blue A4; repeated G4 needs a new press; wrong key → red key + Hindi explanation; two keys at once not counted as a mistake.
5. Step: MIDI note-on (velocity-0 note-off), mouse click, computer keys — whole song to the result; issues at the right notes.
6. Guided: count-in with accents on beat 1, 6/6 notes, 100 % on time.
7. Guided: a wrong note and a skipped note are reported as such.
8. Independent: no highlights, no upcoming notes; played at 90 BPM → 6/6, 90 BPM detected, rhythm 100 %.
9. MIDI device unplugged mid-lesson: lesson pauses with a message, no hanging notes.
10. Results stored, survive a reload, damaged storage is ignored.
11. Leaving gives the instrument back: tempo 120 and metronome restored, no highlights left, keys play.
12. No stuck notes, silence, no console errors.

## 7. Not verified — please check

- **A real USB MIDI keyboard.** MIDI was tested with injected messages
  (including velocity-0 note-offs and an unplug event), not with hardware.
- **Listening.** Timing is measured, but nobody has *listened* to the lesson
  playback and count-in on your speakers.
- **Hindi wording** — written to be simple; please correct anything that reads oddly.
- **Firefox / Safari** — the tests ran in Chromium. (MIDI needs Chrome or Edge anyway.)
- Small windows: the Academy uses the instrument's fixed proportions, so on a
  narrow window the page scrolls sideways like the instrument does.

## 8. Next (Phase 3 of the Academy plan)

Level 0 and Level 1 with working lessons, built from the same pieces:
a chapter = explanation text + one or more exercises; an exercise = a short
note sequence in the JSON format above (e.g. "find Middle C" is a one-note
step exercise; "C D E F G" is a five-note one). Needs: a curriculum file
(levels → chapters → exercises), unlock rules (a chapter opens when the
previous one is passed), a dashboard page (current level, resume, practice
time per day, accuracy trend — the data is already being stored), and a
chapter screen for the explanations. The Lesson Engine, validation, storage
and highlighting are ready for it.
