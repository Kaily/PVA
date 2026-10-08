import { createStore } from '../core/store';
import type { LibraryState, LoadStatus } from '../audio/InstrumentManager';
import type { EngineState, LatencyMode } from '../audio/AudioEngine';
import { DEFAULT_ARP, type ArpSettings } from '../data/arpPatterns';
import {
  DEFAULT_CHORUS_ID,
  DEFAULT_DELAY_ID,
  DEFAULT_DSP_ID,
  DEFAULT_EQ_ID,
  EQ_BANDS,
} from '../data/effectPresets';
import type { SampleQuality, ToneCategory } from '../data/instruments';
import { DEFAULT_REVERB_ID } from '../data/reverbPresets';
import { defaultKeyMap, type KeyMap } from '../data/keymap';
import { DEFAULT_LAYER_TONE_ID, DEFAULT_LOWER_TONE_ID, DEFAULT_TONE_ID } from '../data/tones';
import type { TouchMode } from '../input/velocity';
import type { MidiInputInfo, MidiStatus } from '../midi/MidiManager';
import type { HarmonyMode } from '../music/Harmonizer';
import type { NoteLabelMode } from '../music/notes';

/**
 * Everything the panel shows. Changing it re-renders only the components that
 * read the changed slice. Real-time data (keys, meters, wheels, beat LED)
 * is NOT in here on purpose.
 */

export type LcdPage =
  | 'main'
  | 'menu'
  | 'midi'
  | 'monitor'
  | 'tones'
  | 'part'
  | 'reverb'
  | 'chorus'
  | 'delay'
  | 'dsp'
  | 'eq'
  | 'arp'
  | 'harmony';

export type PointerVelocityMode = 'position' | 'fixed';

/** The three keyboard parts. */
export type PartId = 'upper1' | 'upper2' | 'lower';
export const PART_IDS: PartId[] = ['upper1', 'upper2', 'lower'];
export const PART_LABEL: Record<PartId, string> = { upper1: 'Upper 1', upper2: 'Upper 2', lower: 'Lower' };

export interface PartState {
  toneId: string;
  /** 0–100 */
  volume: number;
  /** −50 (left) … +50 (right) */
  pan: number;
  /** −2 … +2 octaves, on top of the keyboard's octave shift. */
  octave: number;
  /** −12 … +12 semitones, on top of the keyboard's transpose. */
  transpose: number;
  /** Effect sends, 0–100. */
  reverb: number;
  chorus: number;
  delay: number;
  /** Insert DSP. */
  dspOn: boolean;
  dspId: string;
}

export type BrowserTab = 'category' | 'favorites' | 'recent' | 'search';

export interface EqBandState {
  gain: number;
  freq: number;
}

export interface LcdPopup {
  label: string;
  value: string;
  /** Unique per popup so repeated values still restart the timer. */
  key: number;
}

export interface AppState {
  /* power / boot */
  power: boolean;
  booting: boolean;
  engine: EngineState;
  /** True once the browser has let audio start (after the first gesture). */
  audioUnlocked: boolean;
  load: LoadStatus;
  /** State of the SoundFont tone library. */
  library: LibraryState;
  /** Tone being prepared right now (shown in the browser). */
  toneLoading: string | null;
  /** One-line message for the display's status line. */
  message: string | null;

  /* performance set-up (factory defaults on every start) */
  parts: Record<PartId, PartState>;
  layerOn: boolean;
  splitOn: boolean;
  /** Lowest key of the upper zone (MIDI number). */
  splitPoint: number;
  /** Part that the tone browser and the part page edit. */
  selectedPart: PartId;
  masterVolume: number;
  tempo: number;
  transpose: number;
  octave: number;
  sustainLatch: boolean;
  /** Effective pedal state (latch, space bar or MIDI pedal). */
  sustainDown: boolean;
  sostenutoDown: boolean;
  softDown: boolean;
  modulation: number; // 0..127
  chord: string | null;
  arp: ArpSettings;
  harmonyOn: boolean;
  harmonyMode: HarmonyMode;

  /* metronome */
  metronomeOn: boolean;
  metronomeBeats: number;
  metronomeVolume: number;
  metronomeSound: string;

  /* effects */
  reverbOn: boolean;
  reverbType: string;
  reverbLevel: number;
  chorusOn: boolean;
  chorusType: string;
  chorusLevel: number;
  delayOn: boolean;
  delayType: string;
  delayLevel: number;
  /** Selected EQ curve: a factory preset id or "user". */
  eqPreset: string;
  /** The editable curve. */
  eqUser: EqBandState[];

  /* tone browser */
  browserTab: BrowserTab;
  browserCategory: ToneCategory;
  browserQuery: string;
  favorites: string[];
  recent: string[];

  /* preferences (persisted) */
  touchMode: TouchMode;
  fixedVelocity: number;
  pointerVelocity: PointerVelocityMode;
  pcKeyVelocity: number;
  bendRange: number;
  tuneHz: number;
  keyOffNoise: boolean;
  quality: SampleQuality;
  latencyMode: LatencyMode;
  noteLabels: NoteLabelMode;
  keyMap: KeyMap;
  midiInput: string;

  /* MIDI */
  midiStatus: MidiStatus;
  midiInputs: MidiInputInfo[];
  midiError: string | null;
  midiLast: string | null;

  /* display */
  lcdPage: LcdPage;
  /** Selected parameter id on the current page. */
  cursor: string;
  popup: LcdPopup | null;
  helpOpen: boolean;
  fullscreen: boolean;
}

/** Preferences that survive a restart. */
export interface Preferences {
  touchMode: TouchMode;
  fixedVelocity: number;
  pointerVelocity: PointerVelocityMode;
  pcKeyVelocity: number;
  bendRange: number;
  tuneHz: number;
  keyOffNoise: boolean;
  quality: SampleQuality;
  latencyMode: LatencyMode;
  noteLabels: NoteLabelMode;
  keyMap: KeyMap;
  midiInput: string;
  metronomeBeats: number;
  metronomeVolume: number;
  metronomeSound: string;
  favorites: string[];
  recent: string[];
  eqUser: EqBandState[];
}

export const PREFERENCE_KEYS: (keyof Preferences)[] = [
  'touchMode',
  'fixedVelocity',
  'pointerVelocity',
  'pcKeyVelocity',
  'bendRange',
  'tuneHz',
  'keyOffNoise',
  'quality',
  'latencyMode',
  'noteLabels',
  'keyMap',
  'midiInput',
  'metronomeBeats',
  'metronomeVolume',
  'metronomeSound',
  'favorites',
  'recent',
  'eqUser',
];

function defaultQuality(): SampleQuality {
  // Decoded samples are held in RAM; be gentle with small devices.
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return typeof memory === 'number' && memory <= 4 ? 'light' : 'standard';
}

export const flatEq = (): EqBandState[] => EQ_BANDS.map((b) => ({ gain: 0, freq: b.freq }));

export function defaultPreferences(): Preferences {
  return {
    touchMode: 'normal',
    fixedVelocity: 100,
    pointerVelocity: 'position',
    pcKeyVelocity: 96,
    bendRange: 2,
    tuneHz: 440,
    keyOffNoise: true,
    quality: defaultQuality(),
    latencyMode: 'interactive',
    noteLabels: 'off',
    keyMap: defaultKeyMap(),
    midiInput: 'all',
    metronomeBeats: 4,
    metronomeVolume: 70,
    metronomeSound: 'click',
    favorites: [],
    recent: [],
    eqUser: flatEq(),
  };
}

const part = (toneId: string, volume: number, octave = 0): PartState => ({
  toneId,
  volume,
  pan: 0,
  octave,
  transpose: 0,
  reverb: 36,
  chorus: 0,
  delay: 0,
  dspOn: false,
  dspId: DEFAULT_DSP_ID,
});

/** Split point at start-up: F#3 — everything below plays the lower part. */
export const DEFAULT_SPLIT_POINT = 54;

/** Factory start-up state (TASKS.md §9). */
export function initialState(prefs: Preferences): AppState {
  return {
    power: true,
    booting: true,
    engine: 'suspended',
    audioUnlocked: false,
    load: { phase: 'idle', loaded: 0, total: 0, failed: 0 },
    library: 'idle',
    toneLoading: null,
    message: null,

    parts: {
      upper1: part(DEFAULT_TONE_ID, 100),
      upper2: part(DEFAULT_LAYER_TONE_ID, 62),
      lower: part(DEFAULT_LOWER_TONE_ID, 88),
    },
    layerOn: false,
    splitOn: false,
    splitPoint: DEFAULT_SPLIT_POINT,
    selectedPart: 'upper1',
    masterVolume: 75,
    tempo: 120,
    transpose: 0,
    octave: 0,
    sustainLatch: false,
    sustainDown: false,
    sostenutoDown: false,
    softDown: false,
    modulation: 0,
    chord: null,
    arp: { ...DEFAULT_ARP },
    harmonyOn: false,
    harmonyMode: 'duet',

    metronomeOn: false,
    metronomeBeats: prefs.metronomeBeats,
    metronomeVolume: prefs.metronomeVolume,
    metronomeSound: prefs.metronomeSound,

    reverbOn: true,
    reverbType: DEFAULT_REVERB_ID,
    reverbLevel: 30,
    chorusOn: true,
    chorusType: DEFAULT_CHORUS_ID,
    chorusLevel: 50,
    delayOn: true,
    delayType: DEFAULT_DELAY_ID,
    delayLevel: 50,
    eqPreset: DEFAULT_EQ_ID,
    eqUser: prefs.eqUser,

    browserTab: 'category',
    browserCategory: 'PIANO',
    browserQuery: '',
    favorites: prefs.favorites,
    recent: prefs.recent,

    touchMode: prefs.touchMode,
    fixedVelocity: prefs.fixedVelocity,
    pointerVelocity: prefs.pointerVelocity,
    pcKeyVelocity: prefs.pcKeyVelocity,
    bendRange: prefs.bendRange,
    tuneHz: prefs.tuneHz,
    keyOffNoise: prefs.keyOffNoise,
    quality: prefs.quality,
    latencyMode: prefs.latencyMode,
    noteLabels: prefs.noteLabels,
    keyMap: prefs.keyMap,
    midiInput: prefs.midiInput,

    midiStatus: 'idle',
    midiInputs: [],
    midiError: null,
    midiLast: null,

    lcdPage: 'main',
    cursor: 'tempo',
    popup: null,
    helpOpen: false,
    fullscreen: false,
  };
}

export type AppStore = ReturnType<typeof createStore<AppState>>;
