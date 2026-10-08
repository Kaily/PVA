# PROJECT: PROFESSIONAL VIRTUAL ARRANGER KEYBOARD / PIANO

Build a production-quality, highly realistic virtual musical keyboard application inspired by the workflow and capabilities of a professional 61-key arranger keyboard.

The application must NOT look like a toy piano, demo project, or basic HTML keyboard.

The final experience should feel like operating a real premium arranger keyboard sitting on a desk in front of the user.

Do not copy any manufacturer's logo, trademark, proprietary sound samples, firmware UI, or exact product casing. Create an original premium instrument design.

---

# 1. PRIMARY OBJECTIVE

Create a professional 61-key virtual arranger keyboard with:

- realistic piano keyboard
- extremely low-latency audio
- velocity-sensitive playing
- sustain
- pitch bend
- modulation
- hundreds of instrument presets
- Indian instrument bank
- rhythms
- arranger/accompaniment engine
- split keyboard
- layered instruments
- DSP effects
- mixer
- metronome
- phrase pads
- registration memory
- multitrack MIDI recording
- MIDI keyboard support
- computer keyboard support
- mouse/touch support
- professional visual feedback

The priority order is:

1. Playing realism
2. Audio quality
3. Low latency
4. Correct musical behaviour
5. Professional instrument UI
6. Arranger functionality
7. Recording/production tools

Do not sacrifice musical behaviour merely to make the UI visually attractive.

---

# 2. TECHNOLOGY

Preferred web architecture:

Frontend:
- React
- TypeScript
- Vite
- modular component architecture

Audio:
- Web Audio API
- AudioContext
- AudioWorklet where appropriate
- high-quality sampled instruments / SoundFont / legally licensed or open-source samples

MIDI:
- Web MIDI API

State Management:
Use a lightweight predictable state architecture suitable for real-time musical interaction.

Audio state and React rendering state must be separated.

DO NOT route every Note On/Note Off event through expensive React rerenders.

Keyboard performance must remain smooth even when many notes, accompaniment tracks and effects are running simultaneously.

---

# 3. CRITICAL AUDIO REQUIREMENT

Do NOT create the main piano using simple oscillators.

A professional acoustic piano sound requires sampled audio.

Use:

- high-quality stereo piano samples
- multiple velocity layers where available
- proper attack
- natural decay
- sustain behaviour
- release samples if available
- velocity-dependent timbre
- smooth gain envelope
- note stealing
- voice management
- optional sympathetic resonance simulation

Other instruments may use:

- samples
- SoundFonts
- synthesis
- hybrid synthesis

depending on the instrument.

Only use sound libraries whose licensing permits their use.

Never package proprietary commercial keyboard samples without authorization.

---

# 4. 61-KEY KEYBOARD

Create exactly:

61 full-size-style virtual piano keys.

The keyboard must visually reproduce realistic proportions between white and black keys.

White keys:
- slightly warm/off-white rather than flat #FFFFFF
- subtle surface texture
- realistic highlights
- bottom edge
- key separation lines
- shadows

Black keys:
- raised above white keys
- slightly rounded/bevelled front
- realistic reflections
- dark charcoal/black
- clear pressed state

The keyboard must occupy most of the lower portion of the application.

---

# 5. REAL KEY MOVEMENT

Pressing a key must visually make the key travel downward.

Do not simply change its background colour.

Simulate:

- downward key travel
- slight perspective change
- reduced front-face visibility
- moving shadow
- subtle highlight change

Attack animation should be extremely quick.

Release animation should feel slightly softer.

Avoid exaggerated animation.

The objective is:

"physical key movement"

rather than

"button animation".

---

# 6. PLAYING INPUTS

Support all of the following simultaneously:

## Mouse

Mouse down = Note On

Mouse up = Note Off

Mouse leaving a held key must correctly stop or transition the note depending on pointer behaviour.

Support mouse glissando across multiple keys.

---

## Touchscreen

Support:

- multiple fingers
- chords
- slides
- simultaneous notes

Do not limit touchscreen input to one note.

---

## Computer Keyboard

Provide a sensible QWERTY-to-piano mapping.

Example:

Lower octave:
Z S X D C V G B H N J M

Upper octave:
Q 2 W 3 E R 5 T 6 Y 7 U

Allow mapping configuration.

Computer keyboard presses must visually depress their corresponding piano keys.

---

## MIDI Keyboard

Use Web MIDI API.

Support:

- MIDI Note On
- MIDI Note Off
- velocity
- sustain pedal CC64
- modulation CC1
- expression CC11
- volume CC7
- pitch bend
- optional aftertouch if supported

Allow users to select MIDI input devices.

Show:

MIDI CONNECTED

when a controller is detected.

---

# 7. TOUCH RESPONSE / VELOCITY

Implement realistic velocity handling.

Modes:

OFF
SOFT
NORMAL
HARD

MIDI velocity range:

1–127.

Velocity must affect both:

- volume
- timbre/sample layer

A softly played piano key should sound genuinely softer and warmer than a strongly struck key.

Mouse/touch velocity can be estimated using interaction parameters or a configurable default velocity.

Include a visible velocity meter when useful.

---

# 8. AUDIO ENGINE

Implement a real polyphonic voice engine.

Target:

64 simultaneous voices minimum.

Voice state should contain:

- note
- velocity
- start time
- source
- gain
- envelope
- instrument
- channel
- sustain state

When maximum polyphony is exceeded, use intelligent voice stealing.

Prefer releasing:

1. oldest released/sustained notes
2. lowest-energy voices
3. oldest active voices

Avoid obvious note chopping.

---

# 9. DEFAULT GRAND PIANO

On application startup:

Tone:
Concert Grand Piano

Rhythm:
Off

Tempo:
120 BPM

Transpose:
0

Octave:
0

Sustain:
Off

Split:
Off

Layer:
Off

Reverb:
Concert Hall / moderate amount

Master Volume:
approximately 75%

The user should be able to start playing immediately.

Do NOT require navigating menus before sound works.

---

# 10. MASTER CONTROL PANEL

Create a professional upper control panel.

Suggested physical arrangement:

LEFT SECTION
- Power
- Master Volume
- Pitch Bend
- Modulation

CENTER LEFT
- Tone controls
- Rhythm controls
- category buttons

CENTER
- main LCD display
- data wheel
- navigation controls

CENTER RIGHT
- arranger controls
- tempo
- metronome
- transpose
- octave

RIGHT
- registration buttons
- phrase pads
- transport controls

The interface should visually resemble professional stage equipment without copying an existing manufacturer's exact panel.

---

# 11. DISPLAY

Create a premium LCD/TFT-style centre display.

Main performance screen should display:

Tone:
Grand Piano

Tone number

Rhythm:
Pop / Ballad / Indian etc.

Tempo:
120

Beat:
4/4

Transpose:
0

Octave:
0

Split:
OFF

Layer:
OFF

Sustain:
OFF

Chord:
Cmaj7

Registration:
Bank 01 / Slot 1

Also display relevant modal screens for:

- tone browser
- rhythm browser
- mixer
- effects
- recorder
- MIDI
- settings
- registration
- accompaniment

Display transitions must feel like instrument firmware, not a generic website.

---

# 12. TONE ENGINE

Architecture must support approximately:

800 preset tone slots.

Create categories such as:

PIANO
E.PIANO
ORGAN
STRINGS
CHOIR
BRASS
WOODWIND
GUITAR
BASS
SYNTH
LEAD
PAD
MALLET
PERCUSSION
DRUM KIT
WORLD
INDIAN
SFX

Important:

Do NOT claim that all 800 instruments exist if audio assets have not actually been provided.

Tone entries without valid sounds should be marked as unavailable rather than secretly mapped to the same sample.

---

# 13. INDIAN INSTRUMENT BANK

The architecture must support a dedicated Indian bank.

Examples:

Sitar
Harmonium
Veena
Tanpura
Santoor
Sarod
Sarangi
Esraj
Swarmandal
Shehnai
Bansuri
Pungi
Shruti Box
Jal Tarang
Tabla
Tabla Tarang

These instruments should not simply be the piano sample with another name.

Use appropriate legally licensed/open instrument samples or synthesis models.

---

# 14. TONE BROWSER

Pressing TONE should open a tone browser.

Include:

Search
Category
Favorites
Recent
User tones

Example:

001 Concert Grand
002 Studio Grand
003 Bright Grand
004 Mellow Piano

Selection methods:

- click/touch
- arrows
- rotary data wheel
- numeric entry
- MIDI program selection where appropriate

Changing tones should happen immediately without page reload.

---

# 15. LAYER MODE

Allow two upper instruments to play together.

Example:

Upper 1:
Grand Piano

Upper 2:
Warm Strings

Provide independent:

volume
pan
octave
transpose
reverb send
chorus send

Example configuration:

Piano = 100
Strings = 42

Playing one key should trigger both tone layers.

---

# 16. SPLIT MODE

Support configurable split keyboard.

Example:

LEFT:
Acoustic Bass

RIGHT:
Grand Piano

Allow draggable or selectable split point.

Show split marker visually above the keyboard.

Each side must have independent:

tone
volume
octave
transpose
effects sends

Support advanced zones such as:

Lower
Upper 1
Upper 2

if practical.

---

# 17. TRANSPOSE

Range:

-12 to +12 semitones.

Controls:

TRANSPOSE -
TRANSPOSE +

Display current amount.

Example:

TRANSPOSE +2

Do not redraw note labels incorrectly; musical transposition must happen inside the note engine.

---

# 18. OCTAVE SHIFT

Support approximately:

-3 to +3 octaves

where musically valid.

Allow independent octave shifting for keyboard zones/layers.

---

# 19. TUNING

Default:

A4 = 440 Hz

Provide fine tuning approximately:

415.5 Hz to 465.9 Hz.

Allow cents-based fine tuning if supported.

---

# 20. SUSTAIN

Add physical-looking:

SUSTAIN

control.

Support:

- software sustain button
- Spacebar optional mapping
- MIDI CC64 pedal

Correct sustain behaviour is mandatory.

When sustain is ON:

Note Off should not immediately terminate a note.

When sustain is released:

all released-but-sustained notes should enter their natural release envelope.

Do not stop them abruptly.

---

# 21. PEDALS

Architecture should support:

Sustain
Sostenuto
Soft pedal
Expression

Expose MIDI mappings where compatible.

---

# 22. PITCH BEND

Create a spring-loaded pitch-bend wheel.

Behaviour:

center = pitch 0

up = increase pitch

down = decrease pitch

wheel returns visually to centre after release.

Default range:

±2 semitones

but make configurable.

Support physical MIDI pitch bend input.

---

# 23. MODULATION

Create modulation control/button/wheel.

Depending on tone, modulation may control:

- vibrato
- tremolo
- filter
- Leslie speed
- assigned DSP parameter

---

# 24. RHYTHM ENGINE

Architecture should support approximately:

250 rhythm slots.

Categories:

Pop
Rock
Ballad
Jazz
Dance
EDM
Latin
World
Indian
Bhajan
Folk
Traditional
User

Provide real rhythm sequencing rather than playing one long audio file.

A rhythm may contain:

Drums
Percussion
Bass
Chord accompaniment
Pad
Phrase 1
Phrase 2

---

# 25. INDIAN RHYTHMS

Support dedicated Indian rhythm categories such as:

Bhangra
Dadra
Garba
Keharwa
Dandiya
Teen Taal
Bhajan
Jhap Taal
Rupak
Deepchandi
Indian Pop
Ektal
Chautal
Dhamar
Rajasthani
Qawwali
Kerala
Karnataka
Telugu-style rhythms
Tanpura + Tabla patterns

Use legally distributable samples and patterns.

---

# 26. ARRANGER CONTROLS

Provide physical-style buttons:

INTRO
VARIATION 1
VARIATION 2
VARIATION 3
VARIATION 4
FILL
BREAK
ENDING
SYNC START
START / STOP

Changing sections should be musically synchronized.

Do not immediately cut rhythm audio.

Transitions should normally occur on beat/bar boundaries.

---

# 27. AUTOMATIC ACCOMPANIMENT

Detect chords played in the configured chord zone.

Initially support:

Major
Minor
Dominant 7
Major 7
Minor 7
Sus2
Sus4
Diminished
Augmented

Then expand chord recognition.

Display detected chord prominently.

Example:

Cmaj7

Accompaniment bass/harmony parts must transpose correctly to the detected chord.

---

# 28. TEMPO

Tempo range:

20–255 BPM.

Controls:

TEMPO -
TEMPO +

and rotary/data input.

Display:

♩ = 120

Changes should remain musically synchronized with the sequencer.

---

# 29. TAP TEMPO

Add:

TAP TEMPO

Calculate tempo from recent taps.

Smooth unusual tap variance.

---

# 30. METRONOME

Provide:

ON/OFF

Tempo:
20–255

Beats:
0–16

Accent first beat when applicable.

Provide:

volume control

and optional selectable metronome sounds.

---

# 31. DSP / EFFECTS

Effects system should contain:

REVERB
CHORUS
DELAY
EQ
DSP

Provide multiple presets.

Reverb examples:

Room
Studio
Hall
Concert Hall
Stage
Cathedral

Chorus:

Light
Classic
Wide
Ensemble

Delay:

Slapback
Stereo
Tempo Delay
Ping Pong

DSP examples:

Compressor
Overdrive
Rotary Speaker
Phaser
Flanger
Tremolo
Auto Wah
Amp Simulation

Where feasible, architecture should support around 100 DSP preset definitions.

---

# 32. EQUALIZER

Provide:

10 useful factory EQ presets

plus

4-band user EQ.

User controls:

Low
Low Mid
High Mid
High

Make the EQ graph interactive but professional.

---

# 33. MIXER

Create a proper multichannel mixer.

The architecture should support up to approximately 42 logical channels/parts as the system grows.

Each strip should support:

Mute
Solo
Volume
Pan
Reverb Send
Chorus Send
Delay Send

Channels may include:

Upper 1
Upper 2
Lower
Drums
Percussion
Bass
Chord 1
Chord 2
Pad
Phrase
Song tracks
Microphone
etc.

Use horizontal scrolling or banks rather than squeezing all channels into the screen.

---

# 34. REGISTRATION MEMORY

Implement:

16 banks

x

8 registration slots

=

128 setup memories.

A registration should save relevant performance state including:

tones
split
layer
rhythm
tempo
transpose
octave
effects
mixer levels
accompaniment state
controller assignments

Switch registrations instantly.

Provide optional registration sequence mode for live performance.

---

# 35. PHRASE PADS

Provide four large physical-style pads:

PAD 1
PAD 2
PAD 3
PAD 4

Architecture should support:

25 banks × 4 pads = 100 user phrases.

Functions:

Record
Play
Stop
Loop
Overdub
Clear
Copy
Rename

A pad can contain a musical phrase triggered live.

Pads must have clear active/recording indicators.

---

# 36. MIDI RECORDER

Implement a serious multitrack MIDI sequencer.

Target architecture:

1 system track
+
16 musical tracks

=

17 tracks.

Support:

Record
Play
Stop
Pause
Rewind
Forward
Loop
Overdub
Punch In
Punch Out

Record MIDI events including:

note
velocity
duration
channel
program
sustain
pitch bend
modulation
tempo where appropriate

Support approximately:

10 user songs.

Persist projects locally.

---

# 37. PIANO ROLL

For advanced editing, provide:

Piano Roll editor

with:

note blocks
velocity
drag
resize
delete
quantize
copy
paste
loop
zoom

Grid examples:

1/4
1/8
1/16
1/32

Do not allow editing UI to interfere with real-time performance.

---

# 38. MIDI IMPORT / EXPORT

Support:

Standard MIDI File import.

Support:

MIDI export where technically feasible.

Imported MIDI should be routed through available instrument channels.

---

# 39. AUDIO RECORDING

Provide:

RECORD AUDIO

to capture final master output.

Where browser APIs allow, export:

WAV

and optionally other supported formats.

Use a sensible sample rate such as 44.1 kHz or 48 kHz.

Do not call compressed output WAV.

---

# 40. MASTER RECORDER

When audio recording is active:

show a clear professional red recording indicator:

● REC

Also show:

elapsed time
peak meter
recording filename

---

# 41. VOLUME

Create a professional master volume knob/slider.

Include:

0–100 display

and stereo peak meters.

Avoid clipping.

Use master gain staging and limiter protection where needed.

---

# 42. VISUAL AUDIO METERS

Provide stereo output meter:

L
R

The meter must react smoothly to actual audio output.

Use appropriate ballistics/decay rather than random animation.

---

# 43. SPEAKER VISUALIZATION

The keyboard panel may visually include two integrated speaker grille areas.

If subtle animation is used during playback, it must remain restrained.

Do not create cartoon-like speaker movement.

---

# 44. PERFORMANCE MODE

Provide a dedicated mode:

PERFORMANCE

In this mode hide nonessential editing controls and show:

keyboard
tone
rhythm
tempo
chord
registration
pads
transport

This should be optimized for live playing.

---

# 45. STUDIO MODE

Provide:

STUDIO

mode exposing:

mixer
recorder
piano roll
effects
track routing
audio recorder

---

# 46. FULLSCREEN MODE

Provide a distraction-free fullscreen mode.

In fullscreen, the instrument should nearly fill the display and feel like a physical keyboard workstation.

---

# 47. REALISTIC VISUAL DESIGN

Design language:

professional
industrial
premium
modern
slightly dark
stage-ready

Main casing:

graphite/charcoal.

Use restrained:

metal/plastic texture
bevels
shadows
indicator LEDs
physical buttons
rotary controls

Avoid:

neon gaming UI
glassmorphism everywhere
cartoon appearance
huge rounded mobile cards
generic SaaS dashboard design

This is a musical instrument, not an admin dashboard.

---

# 48. BUTTON BEHAVIOUR

Buttons should visibly have:

normal
hover
pressed
latched
disabled

states.

For toggle buttons, use subtle illuminated indicators.

Physical control feedback should be immediate.

---

# 49. ROTARY DATA WHEEL

Add a central rotary encoder/data dial.

Support:

mouse drag
mouse wheel
touch drag

Use it to navigate:

tones
rhythms
parameters
effects
registrations

The dial should have inertia-free precise operation similar to musical hardware.

---

# 50. RESPONSIVENESS

Desktop is the primary platform.

Target especially:

1920×1080
2560×1440

Also support laptop screens.

Tablet mode should remain usable.

Do not destroy piano proportions merely to make the UI fit on a phone.

For narrow screens, allow keyboard horizontal scrolling.

---

# 51. LOW LATENCY

This is a mission-critical requirement.

Target perceived latency:

as low as practical, preferably below approximately 20 ms on supported setups.

Use:

preloading
decoded AudioBuffers
efficient voice allocation
AudioWorklet where required
minimal event-loop blocking

Do not fetch a piano sample from the network after every key press.

---

# 52. AUDIO PRELOADING

On startup:

load the default Grand Piano first.

The application should become playable as soon as that instrument is ready.

Additional instrument assets may load progressively.

Show unobtrusive status:

Loading instrument library...

Do not block the whole app until hundreds of sounds are loaded.

---

# 53. SAMPLE MANAGEMENT

Build reusable:

SampleManager

responsible for:

loading
decoding
caching
velocity mapping
note mapping
fallback mapping
memory cleanup

Avoid duplicating sample loading code across instruments.

---

# 54. INSTRUMENT DEFINITIONS

Use structured instrument metadata.

Example concept:

id
name
category
bank
program
sampleSet
velocityLayers
attack
release
gain
pan
effects
icon
tags

Instrument data should be separate from UI code.

---

# 55. RHYTHM DEFINITIONS

Rhythm definitions should be data-driven.

Include:

name
category
tempo
time signature
sections
tracks
patterns
instrument mappings

Do not hard-code every rhythm into React components.

---

# 56. STORAGE

Persist:

user settings
favorite tones
registrations
user tones
user rhythms
recorded MIDI songs
phrase pads

using suitable browser persistence such as IndexedDB.

Use localStorage only for small settings.

---

# 57. AUTOSAVE

Automatically save the current performance setup periodically and after meaningful changes.

On reopening the application, offer:

Restore Previous Session.

---

# 58. SETTINGS

Provide professional settings pages for:

Audio
MIDI
Keyboard Mapping
Appearance
Performance
Storage
Latency
Sample Library

Audio settings may contain:

output
latency mode
master gain
sample quality

where supported.

---

# 59. COMPUTER KEYBOARD HELP

Provide a keyboard mapping overlay.

Example:

Keyboard Controls

Z–M = lower musical notes
Q–U = upper musical notes
Space = sustain
Arrow Left/Right = octave
+/- = transpose

Mappings should be editable.

---

# 60. NOTE LABELS

Provide optional note labels:

C
C#
D
D#
etc.

Modes:

OFF
NOTE NAME
SOLFEGE

Beginners can enable labels.

Professional/default mode should keep them off.

---

# 61. CHORD DISPLAY

When several notes are played, analyze the chord and show something like:

C
Cm
C7
Cmaj7
Am
Dsus4

Chord detection must not prevent normal piano playing.

---

# 62. ARPEGGIATOR

Implement an arpeggiator engine.

Modes:

Up
Down
Up/Down
Random
Order
Chord
Pattern

Parameters:

rate
octaves
gate
swing
latch

The architecture should allow a larger preset library.

---

# 63. AUTO HARMONIZE

Support useful harmony modes such as:

Duet
Trio
Octave
Country
Block
4-Way

Harmony should be generated according to the active chord/accompaniment context.

---

# 64. MUSIC PRESETS

Support reusable performance presets containing combinations of:

tone
rhythm
tempo
effects
split/layer
accompaniment

The architecture should support hundreds of presets without bloating component code.

---

# 65. SEARCH

Tone and rhythm selection must support instant search.

Examples:

"grand"
"sitar"
"bansuri"
"bhangra"
"tabla"

Use debounced UI filtering where appropriate.

Do not add noticeable input delay.

---

# 66. ACCESSIBILITY

Support:

keyboard navigation
tooltips
visible focus
ARIA labels for controls

without compromising the professional appearance.

---

# 67. ERROR HANDLING

Handle:

AudioContext blocked by browser
missing sample
MIDI permission denied
MIDI device disconnected
unsupported browser feature
recording failure
corrupt project

Gracefully.

Never allow one missing sound to crash the entire keyboard.

---

# 68. PERFORMANCE MONITOR

Provide an optional developer/performance panel showing:

audio latency
active voices
CPU estimate where available
loaded samples
memory usage
MIDI status
audio context state

Hide this during normal performance.

---

# 69. ARCHITECTURE

Use clear modules such as:

AudioEngine
VoiceManager
InstrumentManager
SampleManager
MidiManager
KeyboardController
SustainManager
RhythmEngine
ArrangerEngine
ChordDetector
Sequencer
Recorder
MixerEngine
EffectsEngine
RegistrationManager
PhraseManager
StorageManager

UI components should call these services through clean interfaces.

Do not place the complete music engine inside one React component.

---

# 70. AUDIO GRAPH

Design a proper routing graph.

Conceptually:

Instrument Voice
↓
Part Gain
↓
Part Pan
↓
Effect Sends
↓
Part Bus
↓
Master EQ
↓
Master Compressor/Limiter
↓
Master Gain
↓
Audio Output

Rhythm and song channels should use equivalent routing.

---

# 71. IMPORTANT MUSICAL RULES

The software must correctly handle:

simultaneous notes
repeated same notes
fast trills
legato
sustain
pedal release
rapid retriggering
chords
glissando
high polyphony
tone changes
split boundaries

Do not leave stuck notes.

Provide:

ALL NOTES OFF

panic control.

Also trigger panic safely after MIDI device disconnect where necessary.

---

# 72. VISUAL DETAIL

Add subtle details:

POWER LED
MIDI indicator
tempo indicator
record LED
speaker grille
button labels
panel section names
small screws/seams if tasteful
LCD contrast
key shadows

The product should look believable at first glance.

Avoid excessive decorative elements that would not exist on a real musical instrument.

---

# 73. OPTIONAL 3D FEEL

CSS perspective and lighting may be used to create depth.

However:

Do NOT turn the interface into a heavy WebGL scene unless necessary.

Interaction speed and audio reliability are more important.

---

# 74. FIRST START EXPERIENCE

On first startup:

display instrument boot screen for only a brief moment.

Then show:

PROFESSIONAL ARRANGER
Concert Grand
Ready

The default piano should already be loaded.

User should immediately be able to press a key and hear sound.

---

# 75. DEMONSTRATION SONG

Include several royalty-free/public-domain demo MIDI pieces if available.

Do not embed copyrighted commercial recordings.

---

# 76. QUALITY BAR

Before considering the project complete, test:

- single notes
- repeated notes
- 10-note chords
- rapid playing
- sustain
- 64 voices
- pitch bend
- MIDI input
- computer keyboard
- touch
- split
- layer
- rhythm sync
- chord recognition
- accompaniment
- tempo changes
- recording
- playback
- tone switching
- resize
- fullscreen

There must be:

NO stuck notes.
NO large audio delay.
NO accidental double-triggering.
NO obvious sample gaps.
NO console errors during normal operation.

---

# 77. PHASED DEVELOPMENT

Do not attempt to fake the complete instrument in one step.

## PHASE 1 — REAL PIANO

First build:

61 keys
professional keyboard chassis
Grand Piano sound
mouse input
computer keyboard
MIDI
velocity
64-note polyphony
sustain
pitch bend
master volume
transpose
octave
metronome

PHASE 1 must already feel excellent before proceeding.

---

## PHASE 2 — PERFORMANCE

Add:

tone browser
instrument categories
split
layer
Indian instruments
effects
EQ
arpeggiator
auto harmonize

---

## PHASE 3 — ARRANGER

Add:

rhythm engine
Indian rhythms
chord recognition
auto accompaniment
intro
variations
fills
break
ending
sync start

---

## PHASE 4 — PRODUCTION

Add:

multitrack recorder
17-track architecture
mixer
piano roll
MIDI import/export
audio recording

---

## PHASE 5 — LIVE PERFORMANCE

Add:

128 registrations
phrase pads
performance mode
studio mode
advanced MIDI mapping
user tones/rhythms
session restore

---

# 78. DEFINITION OF "REAL FEEL"

The project should pass this test:

When the application is opened fullscreen on a 24–27 inch monitor and a MIDI keyboard is connected, the user should psychologically feel that they are operating a real arranger workstation rather than interacting with a website.

That means:

pressing harder must matter

sustain must behave naturally

notes must respond immediately

chords must sound clean

keys must visually move

controls must have physical feedback

the display must behave like instrument firmware

the sound must have depth

the UI must remain stable during fast playing

and there must be no toy-like visual or audio behaviour.

---

# 79. CRITICAL RESTRICTIONS

Do NOT:

- build a basic 12-key demo
- use only sine waves for piano
- use fake inactive controls
- put hundreds of tone names pointing to the same sound
- use excessive UI animations
- create a generic admin dashboard
- add random visual equalizer animation
- reload the page to change instruments
- introduce high note latency
- clone manufacturer branding
- distribute proprietary commercial samples

Every visible primary control must either work or clearly be marked unavailable.

---

# 80. DELIVERY REQUIREMENT

Deliver a production-structured project, not merely a visual prototype.

Include:

complete source code
organized assets
README
audio architecture documentation
keyboard mappings
MIDI mappings
instrument metadata
rhythm metadata
configuration
build instructions
development instructions

Also provide a concise architecture document explaining:

1. Audio engine
2. Voice management
3. Sample loading
4. MIDI routing
5. Sustain logic
6. Effects routing
7. Rhythm engine
8. Arranger engine
9. Sequencer
10. Storage

Before coding later phases, get Phase 1's piano feel and audio engine technically correct.

The final system must be extensible enough that additional tones, rhythms, samples and MIDI devices can be added without rewriting the core application.