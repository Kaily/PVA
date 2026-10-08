import { AudioEngine } from './audio/AudioEngine';
import { Clock } from './audio/Clock';
import { EffectsEngine } from './audio/EffectsEngine';
import { InstrumentManager } from './audio/InstrumentManager';
import { Metronome } from './audio/Metronome';
import { MixerEngine, type Part } from './audio/MixerEngine';
import { SampleManager } from './audio/SampleManager';
import { SustainManager } from './audio/SustainManager';
import { VoiceManager } from './audio/VoiceManager';
import { createStore, type Store } from './core/store';
import { KeyboardController } from './input/KeyboardController';
import { MidiManager } from './midi/MidiManager';
import { TapTempo } from './music/TapTempo';
import {
  defaultPreferences,
  initialState,
  PREFERENCE_KEYS,
  type AppState,
  type PartId,
  type Preferences,
} from './state/appState';
import { StorageManager } from './storage/StorageManager';

/**
 * Composition root — the one place where the engine modules are created and
 * wired together. UI components reach the engines only through `services()`
 * and the functions in state/actions.ts.
 */
export interface Services {
  store: Store<AppState>;
  storage: StorageManager;
  engine: AudioEngine;
  samples: SampleManager;
  instruments: InstrumentManager;
  mixer: MixerEngine;
  effects: EffectsEngine;
  voices: VoiceManager;
  sustain: SustainManager;
  clock: Clock;
  metronome: Metronome;
  midi: MidiManager;
  controller: KeyboardController;
  tapTempo: TapTempo;
  /** The three keyboard parts: Upper 1, Upper 2 (layer) and Lower (split). */
  parts: Record<PartId, Part>;
  /** Shortcut for parts.upper1. */
  upper: Part;
}

/** Id of the main keyboard part. */
export const UPPER_PART: PartId = 'upper1';

let instance: Services | null = null;

function loadPreferences(storage: StorageManager): Preferences {
  const defaults = defaultPreferences();
  const saved = storage.load<Partial<Preferences>>('preferences', {});
  const prefs = { ...defaults } as Preferences;
  // Copy only known keys whose type matches the default — ignores stale or damaged entries.
  for (const key of PREFERENCE_KEYS) {
    const value = saved[key];
    if (value === undefined || value === null || typeof value !== typeof defaults[key]) continue;
    if (Array.isArray(defaults[key]) !== Array.isArray(value)) continue;
    (prefs as unknown as Record<string, unknown>)[key] = value;
  }
  if (prefs.eqUser.length !== defaults.eqUser.length) prefs.eqUser = defaults.eqUser;
  return prefs;
}

export function createServices(): Services {
  if (instance) return instance;

  const storage = new StorageManager();
  const prefs = loadPreferences(storage);
  const store = createStore<AppState>(initialState(prefs));

  const engine = new AudioEngine(prefs.latencyMode);
  const ctx = engine.ctx;
  const effects = new EffectsEngine(ctx, engine.masterIn);
  const mixer = new MixerEngine(
    ctx,
    engine.masterIn,
    { reverb: effects.reverbIn, chorus: effects.chorusIn, delay: effects.delayIn },
    engine.tune,
  );
  const parts: Record<PartId, Part> = {
    upper1: mixer.createPart('upper1'),
    upper2: mixer.createPart('upper2'),
    lower: mixer.createPart('lower'),
  };

  const base = import.meta.env.BASE_URL;
  const samples = new SampleManager(ctx, base);
  const instruments = new InstrumentManager(ctx, samples, `${base}soundfonts/GeneralUser-GS.sf2`);
  const voices = new VoiceManager(ctx);
  const sustain = new SustainManager(voices);
  const clock = new Clock(ctx);
  const metronome = new Metronome(ctx, clock, mixer.metronomeBus);
  const midi = new MidiManager();
  const controller = new KeyboardController(engine, voices, sustain, instruments, parts, clock, midi);

  instance = {
    store,
    storage,
    engine,
    samples,
    instruments,
    mixer,
    effects,
    voices,
    sustain,
    clock,
    metronome,
    midi,
    controller,
    tapTempo: new TapTempo(),
    parts,
    upper: parts.upper1,
  };
  return instance;
}

export function services(): Services {
  if (!instance) throw new Error('Services have not been created yet.');
  return instance;
}

export const workletUrl = (): string => `${import.meta.env.BASE_URL}worklets/master-processor.js`;
