import { TEMPO_MAX, TEMPO_MIN } from '../audio/Clock';
import { createInsert } from '../audio/dsp/inserts';
import type { LatencyMode } from '../audio/AudioEngine';
import { clamp, roundTo, signed } from '../core/math';
import type { ArpSettings } from '../data/arpPatterns';
import {
  chorusById,
  delayById,
  dspById,
  EQ_BANDS,
  EQ_GAIN_RANGE,
  eqById,
  USER_EQ_ID,
} from '../data/effectPresets';
import { QUALITY_TIERS, type SampleQuality, type ToneCategory } from '../data/instruments';
import { FIRST_KEY, LAST_KEY } from '../data/keyboardLayout';
import { ASSIGNABLE_CODES, defaultKeyMap } from '../data/keymap';
import { metronomeSoundById } from '../data/metronomeSounds';
import { reverbById } from '../data/reverbPresets';
import { DEFAULT_TONE_ID, toneById, toneByProgram, tonesInCategory, type ToneDef } from '../data/tones';
import { TOUCH_MODES, type TouchMode } from '../input/velocity';
import { describeMidi } from '../midi/MidiManager';
import { HARMONY_MODES, type HarmonyMode } from '../music/Harmonizer';
import { noteName, type NoteLabelMode } from '../music/notes';
import { services, workletUrl } from '../services';
import {
  PART_IDS,
  PART_LABEL,
  PREFERENCE_KEYS,
  type AppState,
  type BrowserTab,
  type EqBandState,
  type LcdPage,
  type PartId,
  type PartState,
  type PointerVelocityMode,
  type Preferences,
} from './appState';
import { browserList } from './browser';

/**
 * Actions — every change the panel can make. Each one validates the value,
 * updates the engines, updates the store (which re-renders the display) and
 * persists preferences where relevant. Components never touch the engines
 * for state changes; they call these.
 */

const state = (): AppState => services().store.get();
const set = (patch: Partial<AppState>): void => services().store.set(patch);

/* ------------------------------------------------------------------ */
/* display helpers                                                      */
/* ------------------------------------------------------------------ */

let popupKey = 0;
let popupTimer = 0;
let messageTimer = 0;
let persistTimer = 0;

/** Large transient read-out in the middle of the display, like hardware does on a value change. */
export function popup(label: string, value: string): void {
  set({ popup: { label, value, key: ++popupKey } });
  window.clearTimeout(popupTimer);
  popupTimer = window.setTimeout(() => set({ popup: null }), 1300);
}

/** One-line message in the display's status line. */
export function notify(message: string, holdMs = 4500): void {
  set({ message });
  window.clearTimeout(messageTimer);
  if (holdMs > 0) messageTimer = window.setTimeout(() => set({ message: null }), holdMs);
}

function persist(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    const s = state();
    const prefs = {} as Record<string, unknown>;
    for (const key of PREFERENCE_KEYS) prefs[key] = s[key];
    services().storage.save<Preferences>('preferences', prefs as unknown as Preferences);
  }, 250);
}

/* ------------------------------------------------------------------ */
/* power / audio                                                        */
/* ------------------------------------------------------------------ */

/** Call from any user gesture: lets the browser start the audio clock. */
export function unlockAudio(): void {
  const { engine } = services();
  if (!state().power || engine.isRunning) return;
  void engine.resume();
}

export function togglePower(): void {
  const { engine, controller, metronome } = services();
  if (state().power) {
    controller.panic();
    controller.enabled = false;
    metronome.setOn(false);
    set({ power: false, metronomeOn: false, sustainLatch: false, popup: null, helpOpen: false });
    // Let the 25 ms panic fade finish before the clock stops.
    window.setTimeout(() => {
      if (!state().power) void engine.suspend();
    }, 80);
  } else {
    controller.enabled = true;
    set({ power: true, booting: true, lcdPage: 'main', cursor: 'tempo' });
    void engine.resume();
    window.setTimeout(() => {
      set({ booting: false });
      notify('Ready');
    }, 900);
  }
}

export function panic(): void {
  const { controller } = services();
  controller.panic();
  controller.pedal('sustain', 'panel', false);
  set({ sustainLatch: false });
  popup('ALL NOTES OFF', 'OK');
}

/* ------------------------------------------------------------------ */
/* master                                                               */
/* ------------------------------------------------------------------ */

export function setMasterVolume(value: number, show = true): void {
  const v = clamp(Math.round(value), 0, 100);
  services().engine.setMasterVolume(v);
  set({ masterVolume: v });
  if (show) popup('MASTER VOLUME', String(v));
}

/* ------------------------------------------------------------------ */
/* tempo / metronome                                                    */
/* ------------------------------------------------------------------ */

export function setTempo(bpm: number, show = true): void {
  const v = clamp(Math.round(bpm), TEMPO_MIN, TEMPO_MAX);
  services().clock.setTempo(v);
  services().effects.setTempo(v);
  set({ tempo: v });
  if (show) popup('TEMPO', `♩ = ${v}`);
}

export const nudgeTempo = (delta: number): void => setTempo(state().tempo + delta);

export function tapTempo(): void {
  const { tapTempo: tap } = services();
  const bpm = tap.tap(performance.now());
  if (bpm === null) popup('TAP TEMPO', 'TAP…');
  else setTempo(bpm);
}

export function setMetronome(on: boolean): void {
  services().metronome.setOn(on);
  set({ metronomeOn: on });
  popup('METRONOME', on ? 'ON' : 'OFF');
}

export const toggleMetronome = (): void => setMetronome(!state().metronomeOn);

export function setMetronomeBeats(beats: number): void {
  const v = clamp(Math.round(beats), 0, 16);
  services().metronome.setBeats(v);
  set({ metronomeBeats: v });
  persist();
}

export function setMetronomeVolume(volume: number): void {
  const v = clamp(Math.round(volume), 0, 100);
  services().mixer.setMetronomeVolume(v);
  set({ metronomeVolume: v });
  persist();
}

export function setMetronomeSound(id: string): void {
  const sound = metronomeSoundById(id);
  services().metronome.setSound(sound.id);
  set({ metronomeSound: sound.id });
  persist();
}

/* ------------------------------------------------------------------ */
/* pitch                                                                */
/* ------------------------------------------------------------------ */

/** Sounding range of one part with the current shifts. */
function partRange(s: AppState, id: PartId): [number, number] {
  const p = s.parts[id];
  const shift = s.transpose + s.octave * 12 + p.transpose + p.octave * 12;
  return [FIRST_KEY + shift, LAST_KEY + shift];
}

/** Samples for keys that transpose / octave moved outside the loaded range are fetched on demand. */
function ensureSoundingRange(): void {
  const s = state();
  const { instruments } = services();
  for (const id of PART_IDS) {
    if (!instruments.get(s.parts[id].toneId)) continue;
    const [lo, hi] = partRange(s, id);
    void instruments.prepare(s.parts[id].toneId, lo, hi).catch(() => undefined);
  }
}

export function setTranspose(semitones: number, show = true): void {
  const v = clamp(Math.round(semitones), -12, 12);
  services().controller.transpose = v;
  set({ transpose: v });
  ensureSoundingRange();
  if (show) popup('TRANSPOSE', signed(v));
}

export const nudgeTranspose = (delta: number): void => setTranspose(state().transpose + delta);

export function setOctave(octave: number, show = true): void {
  const v = clamp(Math.round(octave), -3, 3);
  services().controller.octave = v;
  set({ octave: v });
  ensureSoundingRange();
  if (show) popup('OCTAVE', signed(v));
}

export const nudgeOctave = (delta: number): void => setOctave(state().octave + delta);

export function setTune(hz: number): void {
  const v = clamp(roundTo(hz, 0.1), 415.5, 465.9);
  const rounded = Math.round(v * 10) / 10;
  services().engine.setTuning(rounded);
  set({ tuneHz: rounded });
  persist();
}

export function setBendRange(semitones: number): void {
  const v = clamp(Math.round(semitones), 0, 12);
  services().controller.setBendRange(v);
  set({ bendRange: v });
  persist();
}

/* ------------------------------------------------------------------ */
/* pedals / touch                                                       */
/* ------------------------------------------------------------------ */

export function setSustainLatch(on: boolean): void {
  services().controller.pedal('sustain', 'panel', on);
  set({ sustainLatch: on });
  popup('SUSTAIN', on ? 'ON' : 'OFF');
}

export const toggleSustainLatch = (): void => setSustainLatch(!state().sustainLatch);

/** Momentary sustain from the space bar. */
export function holdSustain(down: boolean): void {
  services().controller.pedal('sustain', 'space', down);
}

export function setTouchMode(mode: TouchMode, show = true): void {
  services().controller.touchMode = mode;
  set({ touchMode: mode });
  persist();
  if (show) popup('TOUCH RESPONSE', TOUCH_MODES.find((m) => m.id === mode)?.label ?? mode);
}

export function cycleTouchMode(): void {
  const order = TOUCH_MODES.map((m) => m.id);
  setTouchMode(order[(order.indexOf(state().touchMode) + 1) % order.length]);
}

export function setFixedVelocity(v: number): void {
  const value = clamp(Math.round(v), 1, 127);
  services().controller.fixedVelocity = value;
  set({ fixedVelocity: value });
  persist();
}

export function setPointerVelocity(mode: PointerVelocityMode): void {
  set({ pointerVelocity: mode });
  persist();
}

export function setPcKeyVelocity(v: number): void {
  set({ pcKeyVelocity: clamp(Math.round(v), 1, 127) });
  persist();
}

/* ------------------------------------------------------------------ */
/* parts: tones, split, layer                                           */
/* ------------------------------------------------------------------ */

/** Push one part's mixer settings to the engines. */
function applyPart(id: PartId): void {
  const { parts, controller } = services();
  const p = state().parts[id];
  const part = parts[id];
  part.setVolume(p.volume / 100);
  part.setPan(p.pan / 50);
  part.setReverbSend(p.reverb / 100);
  part.setChorusSend(p.chorus / 100);
  part.setDelaySend(p.delay / 100);
  controller.setPartShift(id, p.octave, p.transpose);
}

function applyPartDsp(id: PartId): void {
  const { parts, controller, engine } = services();
  const p = state().parts[id];
  const preset = p.dspOn ? dspById(p.dspId) : undefined;
  parts[id].setInsert(preset ? createInsert(engine.ctx, preset) : null);
  // the insert is wired a few milliseconds later; route the wheel once it is in place
  window.setTimeout(() => controller.refreshModulation(), 40);
}

function patchPart(id: PartId, patch: Partial<PartState>): void {
  const s = state();
  set({ parts: { ...s.parts, [id]: { ...s.parts[id], ...patch } } });
}

function applyRouting(): void {
  const s = state();
  services().controller.setRouting(s.layerOn, s.splitOn, s.splitPoint);
}

/** Latest tone request per part — a slower, older request must not overwrite a newer one. */
const toneRequest: Record<PartId, number> = { upper1: 0, upper2: 0, lower: 0 };

/**
 * Select a tone for a part. The part keeps playing its current tone until the
 * new one is ready (instant for tones that are already loaded).
 */
export async function setPartTone(id: PartId, toneId: string, announce = true): Promise<boolean> {
  const tone = toneById(toneId);
  if (!tone) return false;
  if (!tone.available) {
    notify(`${tone.name} is not available. ${tone.unavailableReason ?? ''}`.trim(), 6000);
    return false;
  }
  const { instruments, controller } = services();
  const request = ++toneRequest[id];
  const [lo, hi] = partRange(state(), id);
  const needsWork = !instruments.get(toneId);
  if (needsWork) set({ toneLoading: toneId });
  try {
    await instruments.prepare(toneId, lo, hi);
  } catch (err) {
    if (state().toneLoading === toneId) set({ toneLoading: null });
    notify(err instanceof Error ? err.message : `${tone.name} could not be loaded.`, 6000);
    return false;
  }
  if (state().toneLoading === toneId) set({ toneLoading: null });
  if (request !== toneRequest[id]) return false; // superseded by a newer choice

  controller.setPartTone(id, toneId);
  const s = state();
  set({
    parts: {
      ...s.parts,
      // a tone brings its own effect sends
      [id]: { ...s.parts[id], toneId, reverb: Math.round(tone.reverbSend * 100), chorus: Math.round(tone.chorusSend * 100) },
    },
    recent: [toneId, ...s.recent.filter((t) => t !== toneId)].slice(0, 24),
  });
  applyPart(id);
  persist();
  // rendered model tones that no part uses any more are given back, oldest first
  instruments.trimModels(PART_IDS.map((p) => state().parts[p].toneId));
  if (announce && state().lcdPage !== 'tones') popup(PART_LABEL[id].toUpperCase(), tone.name);
  return true;
}

/** Select a tone for the part that is currently being edited. */
export const selectTone = (toneId: string): Promise<boolean> => setPartTone(state().selectedPart, toneId, false);

/** Step through the tones listed in the browser (data wheel, cursor keys). */
export function stepTone(delta: number): void {
  const s = state();
  const list = browserList(s).filter((t) => t.available);
  if (list.length === 0 || delta === 0) return;
  const current = list.findIndex((t) => t.id === s.parts[s.selectedPart].toneId);
  const next = current < 0 ? (delta > 0 ? 0 : list.length - 1) : clamp(current + delta, 0, list.length - 1);
  if (next !== current) void selectTone(list[next].id);
}

/**
 * Panel TONE − / + buttons. With the browser open they step through the list
 * that is shown; otherwise through the category of the tone that is playing,
 * whatever the browser was last used for.
 */
export function nudgeTone(delta: number): void {
  const s = state();
  if (s.lcdPage === 'tones') {
    stepTone(delta);
    return;
  }
  const tone = toneById(s.parts[s.selectedPart].toneId);
  if (!tone) return;
  const list = tonesInCategory(tone.category).filter((t) => t.available);
  const i = list.findIndex((t) => t.id === tone.id);
  const next = list[clamp(i + delta, 0, list.length - 1)];
  if (!next || next.id === tone.id) return;
  set({ browserCategory: next.category, browserTab: 'category', browserQuery: '' });
  void setPartTone(s.selectedPart, next.id);
}

export function selectPart(id: PartId): void {
  const s = state();
  const tone = toneById(s.parts[id].toneId);
  set({ selectedPart: id, browserCategory: tone?.category ?? s.browserCategory });
}

export function setLayer(on: boolean): void {
  set({ layerOn: on });
  applyRouting();
  popup('LAYER', on ? (toneById(state().parts.upper2.toneId)?.name ?? 'ON') : 'OFF');
  if (on) void ensurePartReady('upper2');
}

export const toggleLayer = (): void => setLayer(!state().layerOn);

export function setSplit(on: boolean): void {
  set({ splitOn: on });
  applyRouting();
  popup('SPLIT', on ? `${noteName(state().splitPoint)}  ${toneById(state().parts.lower.toneId)?.name ?? ''}` : 'OFF');
  if (on) void ensurePartReady('lower');
}

export const toggleSplit = (): void => setSplit(!state().splitOn);

/** @param key lowest key of the upper zone */
export function setSplitPoint(key: number, show = true): void {
  const v = clamp(Math.round(key), FIRST_KEY + 1, LAST_KEY);
  set({ splitPoint: v });
  applyRouting();
  if (show) popup('SPLIT POINT', noteName(v));
}

/** Make sure a part's tone is loaded (used when layer / split are switched on). */
async function ensurePartReady(id: PartId): Promise<void> {
  const s = state();
  const toneId = s.parts[id].toneId;
  const { instruments, controller } = services();
  const [lo, hi] = partRange(s, id);
  try {
    await instruments.prepare(toneId, lo, hi);
    controller.setPartTone(id, toneId);
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The tone could not be loaded.', 6000);
  }
}

type PartNumberKey = 'volume' | 'pan' | 'octave' | 'transpose' | 'reverb' | 'chorus' | 'delay';
const PART_LIMITS: Record<PartNumberKey, [number, number]> = {
  volume: [0, 100],
  pan: [-50, 50],
  octave: [-2, 2],
  transpose: [-12, 12],
  reverb: [0, 100],
  chorus: [0, 100],
  delay: [0, 100],
};

export function setPartValue(id: PartId, key: PartNumberKey, value: number): void {
  const [lo, hi] = PART_LIMITS[key];
  patchPart(id, { [key]: clamp(Math.round(value), lo, hi) });
  applyPart(id);
  if (key === 'octave' || key === 'transpose') ensureSoundingRange();
}

export function setPartDsp(id: PartId, on: boolean): void {
  patchPart(id, { dspOn: on });
  applyPartDsp(id);
  const preset = dspById(state().parts[id].dspId);
  popup(`DSP ${PART_LABEL[id].toUpperCase()}`, on ? (preset?.name ?? 'ON') : 'OFF');
}

export function setPartDspPreset(id: PartId, presetId: string): void {
  if (!dspById(presetId)) return;
  patchPart(id, { dspId: presetId });
  if (state().parts[id].dspOn) applyPartDsp(id);
}

/* ------------------------------------------------------------------ */
/* tone browser                                                         */
/* ------------------------------------------------------------------ */

export function setBrowserTab(tab: BrowserTab): void {
  // leaving the search result also empties the search box
  set(tab === 'search' ? { browserTab: tab } : { browserTab: tab, browserQuery: '' });
}

export function setBrowserCategory(category: ToneCategory): void {
  set({ browserCategory: category, browserTab: 'category', browserQuery: '' });
}

/** Open the browser on the favourites (panel button). */
export function openFavorites(): void {
  const s = state();
  if (s.lcdPage === 'tones' && s.browserTab === 'favorites') showPage('main', 'tempo');
  else set({ lcdPage: 'tones', browserTab: 'favorites', browserQuery: '', popup: null });
}

export function setBrowserQuery(query: string): void {
  set({ browserQuery: query, browserTab: query.trim() ? 'search' : state().browserTab === 'search' ? 'category' : state().browserTab });
}

export function toggleFavorite(toneId: string): void {
  const s = state();
  const on = s.favorites.includes(toneId);
  set({ favorites: on ? s.favorites.filter((t) => t !== toneId) : [...s.favorites, toneId] });
  persist();
  const tone = toneById(toneId);
  if (tone) notify(on ? `${tone.name} removed from favourites` : `${tone.name} added to favourites`, 2500);
}

/** Panel category button: open the browser on that category. */
export function openCategory(category: ToneCategory): void {
  set({ browserCategory: category, browserTab: 'category', browserQuery: '', lcdPage: 'tones', popup: null });
}

/** TONE button: open the browser on the category of the current tone. */
export function openToneBrowser(): void {
  const s = state();
  if (s.lcdPage === 'tones') {
    showPage('main', 'tempo');
    return;
  }
  const tone = toneById(s.parts[s.selectedPart].toneId);
  set({ lcdPage: 'tones', browserTab: 'category', browserCategory: tone?.category ?? 'PIANO', browserQuery: '', popup: null });
}

/* ------------------------------------------------------------------ */
/* effects                                                              */
/* ------------------------------------------------------------------ */

export function setReverbOn(on: boolean): void {
  services().effects.setReverbEnabled(on);
  set({ reverbOn: on });
  popup('REVERB', on ? reverbById(state().reverbType).name : 'OFF');
}

export const toggleReverb = (): void => setReverbOn(!state().reverbOn);
export const toggleChorus = (): void => setChorusOn(!state().chorusOn);
export const toggleDelay = (): void => setDelayOn(!state().delayOn);
export const toggleHarmony = (): void => setHarmonyOn(!state().harmonyOn);
/** DSP button: insert effect of the part that is being edited. */
export const toggleDsp = (): void => setPartDsp(state().selectedPart, !state().parts[state().selectedPart].dspOn);

export function setReverbType(id: string): void {
  const preset = reverbById(id);
  services().effects.setReverbPreset(preset.id);
  set({ reverbType: preset.id });
}

export function setReverbLevel(level: number): void {
  const v = clamp(Math.round(level), 0, 100);
  services().effects.setReverbLevel(v);
  set({ reverbLevel: v });
}

export function setChorusOn(on: boolean): void {
  services().effects.setChorusEnabled(on);
  set({ chorusOn: on });
  popup('CHORUS', on ? chorusById(state().chorusType).name : 'OFF');
}

export function setChorusType(id: string): void {
  const preset = chorusById(id);
  services().effects.setChorusPreset(preset.id);
  set({ chorusType: preset.id });
}

export function setChorusLevel(level: number): void {
  const v = clamp(Math.round(level), 0, 100);
  services().effects.setChorusLevel(v);
  set({ chorusLevel: v });
}

export function setDelayOn(on: boolean): void {
  services().effects.setDelayEnabled(on);
  set({ delayOn: on });
  popup('DELAY', on ? delayById(state().delayType).name : 'OFF');
}

export function setDelayType(id: string): void {
  const preset = delayById(id);
  services().effects.setDelayPreset(preset.id);
  set({ delayType: preset.id });
}

export function setDelayLevel(level: number): void {
  const v = clamp(Math.round(level), 0, 100);
  services().effects.setDelayLevel(v);
  set({ delayLevel: v });
}

/** The four band settings of the curve that is selected right now. */
export function currentEq(s: AppState = state()): EqBandState[] {
  const preset = eqById(s.eqPreset);
  if (!preset) return s.eqUser;
  return EQ_BANDS.map((b, i) => ({ gain: preset.gains[i], freq: b.freq }));
}

function applyEq(): void {
  const { engine } = services();
  currentEq().forEach((b, i) => engine.setEqBand(i, b.gain, b.freq));
}

export function setEqPreset(id: string): void {
  set({ eqPreset: id === USER_EQ_ID || eqById(id) ? id : 'flat' });
  applyEq();
}

/**
 * Change one band. Editing a factory curve copies it to the user curve first,
 * so the factory presets themselves never change.
 */
export function setEqBand(index: number, patch: Partial<EqBandState>): void {
  const s = state();
  const def = EQ_BANDS[index];
  if (!def) return;
  const bands = currentEq(s).map((b) => ({ ...b }));
  if (patch.gain !== undefined) bands[index].gain = clamp(Math.round(patch.gain * 2) / 2, -EQ_GAIN_RANGE, EQ_GAIN_RANGE);
  if (patch.freq !== undefined) bands[index].freq = Math.round(clamp(patch.freq, def.minFreq, def.maxFreq));
  set({ eqUser: bands, eqPreset: USER_EQ_ID });
  applyEq();
  persist();
}

export function setKeyOffNoise(on: boolean): void {
  services().voices.keyOffNoise = on;
  set({ keyOffNoise: on });
  persist();
}

export function setNoteLabels(mode: NoteLabelMode, show = true): void {
  set({ noteLabels: mode });
  persist();
  if (show) popup('NOTE LABELS', mode === 'off' ? 'OFF' : mode === 'note' ? 'NOTE NAME' : 'SOLFEGE');
}

export function cycleNoteLabels(): void {
  const order: NoteLabelMode[] = ['off', 'note', 'solfege'];
  setNoteLabels(order[(order.indexOf(state().noteLabels) + 1) % order.length]);
}

/** Changing the sample quality unloads the grand piano and decodes it again. */
export function setQuality(quality: SampleQuality): void {
  if (quality === state().quality) return;
  const { controller, instruments } = services();
  controller.panic();
  instruments.unload(DEFAULT_TONE_ID);
  set({ quality });
  persist();
  notify(`Reloading the grand piano — ${QUALITY_TIERS[quality].label}`);
  void (async () => {
    const s = state();
    try {
      await instruments.load(DEFAULT_TONE_ID, quality, ...partRange(s, 'upper1'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'The grand piano could not be loaded.', 0);
    }
  })();
}

export function setLatencyMode(mode: LatencyMode): void {
  if (mode === state().latencyMode) return;
  set({ latencyMode: mode });
  persist();
  notify('Latency mode is applied when the page is reloaded.', 6000);
}

/* ------------------------------------------------------------------ */
/* arpeggiator / harmony                                                */
/* ------------------------------------------------------------------ */

export function setArp(patch: Partial<ArpSettings>, show = false): void {
  const arp = { ...state().arp, ...patch };
  arp.octaves = clamp(Math.round(arp.octaves), 1, 4);
  arp.gate = clamp(Math.round(arp.gate), 10, 100);
  arp.swing = clamp(Math.round(arp.swing), 0, 60);
  set({ arp });
  services().controller.configureArp(arp);
  if (show) popup('ARPEGGIO', arp.on ? 'ON' : 'OFF');
}

export const toggleArp = (): void => setArp({ on: !state().arp.on }, true);

export function setHarmonyOn(on: boolean): void {
  services().controller.harmonyOn = on;
  set({ harmonyOn: on });
  popup('HARMONY', on ? (HARMONY_MODES.find((m) => m.id === state().harmonyMode)?.label ?? 'ON') : 'OFF');
  if (on && !state().splitOn && state().harmonyMode !== 'octave') {
    notify('Harmony follows the chord of the lower zone — switch SPLIT on and hold a chord.', 6500);
  }
}

export function setHarmonyMode(mode: HarmonyMode): void {
  services().controller.harmonyMode = mode;
  set({ harmonyMode: mode });
}

/* ------------------------------------------------------------------ */
/* computer keyboard map                                                */
/* ------------------------------------------------------------------ */

/** Assign a computer key to a piano key, or pass null to clear it. */
export function assignKey(code: string, key: number | null): void {
  if (!ASSIGNABLE_CODES.has(code)) return;
  const map = { ...state().keyMap };
  if (key === null) delete map[code];
  else map[code] = clamp(key, 0, 127);
  set({ keyMap: map });
  persist();
}

export function resetKeyMap(): void {
  set({ keyMap: defaultKeyMap() });
  persist();
}

/* ------------------------------------------------------------------ */
/* MIDI                                                                 */
/* ------------------------------------------------------------------ */

export function selectMidiInput(id: string): void {
  services().midi.selectInput(id);
  set({ midiInput: id });
  persist();
}

export function retryMidi(): void {
  void services().midi.init();
}

/* ------------------------------------------------------------------ */
/* display navigation                                                   */
/* ------------------------------------------------------------------ */

export function showPage(page: LcdPage, cursor?: string): void {
  const patch: Partial<AppState> = { lcdPage: page, popup: null };
  if (cursor) patch.cursor = cursor;
  set(patch);
}

/** A page button on the panel: open the page, or go back to the main screen if it is already open. */
export function togglePage(page: LcdPage, cursor: string): void {
  if (state().lcdPage === page) showPage('main', 'tempo');
  else showPage(page, cursor);
}

export const setCursor = (id: string): void => set({ cursor: id });

export function toggleHelp(open?: boolean): void {
  set({ helpOpen: open ?? !state().helpOpen });
}

export function toggleFullscreen(): void {
  const doc = document;
  if (doc.fullscreenElement) {
    void doc.exitFullscreen();
  } else {
    doc.documentElement.requestFullscreen?.().catch(() => notify('Fullscreen is not available in this browser.'));
  }
}

/* ------------------------------------------------------------------ */
/* boot                                                                 */
/* ------------------------------------------------------------------ */

/** Push the whole current state into the engines (start-up). */
function applyState(): void {
  const svc = services();
  const s = state();
  svc.engine.setMasterVolume(s.masterVolume);
  svc.engine.setTuning(s.tuneHz);
  svc.clock.setTempo(s.tempo);
  svc.metronome.setBeats(s.metronomeBeats);
  svc.metronome.setSound(s.metronomeSound);
  svc.mixer.setMetronomeVolume(s.metronomeVolume);
  svc.effects.setReverbPreset(s.reverbType);
  svc.effects.setReverbLevel(s.reverbLevel);
  svc.effects.setReverbEnabled(s.reverbOn);
  svc.effects.setChorusPreset(s.chorusType);
  svc.effects.setChorusLevel(s.chorusLevel);
  svc.effects.setChorusEnabled(s.chorusOn);
  svc.effects.setDelayPreset(s.delayType);
  svc.effects.setDelayLevel(s.delayLevel);
  svc.effects.setDelayEnabled(s.delayOn);
  svc.effects.setTempo(s.tempo);
  svc.voices.keyOffNoise = s.keyOffNoise;
  svc.controller.transpose = s.transpose;
  svc.controller.octave = s.octave;
  svc.controller.touchMode = s.touchMode;
  svc.controller.fixedVelocity = s.fixedVelocity;
  svc.controller.harmonyOn = s.harmonyOn;
  svc.controller.harmonyMode = s.harmonyMode;
  svc.controller.setBendRange(s.bendRange);
  svc.controller.configureArp(s.arp);
  svc.controller.setRouting(s.layerOn, s.splitOn, s.splitPoint);
  svc.midi.selectInput(s.midiInput);
  for (const id of PART_IDS) applyPart(id);
  applyEq();
}

/** Try the tone library again after a failed download. */
export function retryLibrary(): void {
  void loadLibraryInBackground();
}

/** After the grand is playable: fetch the tone library and get the layer / split tones ready. */
async function loadLibraryInBackground(): Promise<void> {
  const { instruments, controller } = services();
  try {
    await instruments.loadLibrary();
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The tone library could not be loaded.', 8000);
    return;
  }
  for (const id of ['upper2', 'lower'] as PartId[]) {
    const s = state();
    try {
      await instruments.prepare(s.parts[id].toneId, ...partRange(s, id));
      if (!controller.partTone(id)) controller.setPartTone(id, state().parts[id].toneId);
    } catch {
      /* reported when the part is switched on */
    }
  }
}

let booted = false;

/** Start the instrument. Idempotent (React strict mode calls effects twice). */
export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  const svc = services();
  const { store, engine, instruments, midi, sustain, controller, samples } = svc;

  /* engine → store wiring */
  engine.events.on('state', (engineState) => {
    const patch: Partial<AppState> = { engine: engineState };
    if (engineState === 'running') patch.audioUnlocked = true;
    store.set(patch);
  });
  instruments.events.on('status', (load) => store.set({ load }));
  instruments.events.on('library', ({ state: library }) => store.set({ library }));
  samples.events.on('missing', ({ file }) => notify(`Sample missing: ${file} — using the nearest one`));
  sustain.events.on('change', ({ partId, pedal, down }) => {
    if (partId !== 'upper1') return;
    if (pedal === 'sustain') store.set({ sustainDown: down });
    else if (pedal === 'sostenuto') store.set({ sostenutoDown: down });
    else store.set({ softDown: down });
  });
  controller.events.on('chord', (chord) => store.set({ chord }));
  controller.events.on('modulation', (value) => store.set({ modulation: Math.round(value * 127) }));
  controller.events.on('blocked', () => notify('Audio is waiting — click the keyboard or press a key once.', 6000));
  controller.hooks = {
    masterVolume: (v) => setMasterVolume(v, false),
    program: (bank, program) => {
      const tone: ToneDef | undefined = toneByProgram(bank, program);
      if (tone) void setPartTone('upper1', tone.id);
    },
    notify: (message) => notify(message),
  };

  let previousConnected = 0;
  midi.events.on('devices', ({ status, inputs, error }) => {
    store.set({ midiStatus: status, midiInputs: inputs, midiError: error ?? null });
    const connected = inputs.filter((i) => i.connected).length;
    if (connected > previousConnected) {
      const name = inputs.find((i) => i.connected)?.name ?? 'MIDI device';
      notify(`MIDI CONNECTED — ${name}`);
    }
    previousConnected = connected;
    // A remembered device that is gone: listen to everything instead of nothing.
    const selected = store.get().midiInput;
    if (status === 'ready' && selected !== 'all' && !inputs.some((i) => i.id === selected)) {
      midi.selectInput('all');
      store.set({ midiInput: 'all' });
    }
  });
  let lastMonitor = 0;
  midi.events.on('activity', ({ bytes }) => {
    if (store.get().lcdPage !== 'midi') return;
    const now = performance.now();
    if (now - lastMonitor < 120) return;
    lastMonitor = now;
    store.set({ midiLast: describeMidi(bytes) });
  });

  document.addEventListener('fullscreenchange', () => store.set({ fullscreen: Boolean(document.fullscreenElement) }));

  /* never leave notes hanging when the window loses the keyboard / pointer */
  const releaseLocal = (): void => {
    controller.releaseSources('qwerty');
    controller.releaseSources('pointer');
    holdSustain(false);
  };
  window.addEventListener('blur', releaseLocal);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseLocal();
  });

  applyState();
  store.set({ engine: engine.state, audioUnlocked: engine.isRunning });

  const started = performance.now();
  try {
    await engine.init(workletUrl());
  } catch (err) {
    notify(err instanceof Error ? err.message : 'Audio could not be initialised.', 0);
  }
  void midi.init();

  // The grand piano first: the instrument is playable as soon as it is ready.
  const s = state();
  try {
    await instruments.load(DEFAULT_TONE_ID, s.quality, ...partRange(s, 'upper1'));
    controller.setPartTone('upper1', DEFAULT_TONE_ID);
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The grand piano could not be loaded.', 0);
  }
  void loadLibraryInBackground();

  // The boot screen is shown briefly even when everything is cached.
  const elapsed = performance.now() - started;
  if (elapsed < 1100) await new Promise((resolve) => window.setTimeout(resolve, 1100 - elapsed));
  store.set({ booting: false });
  if (!store.get().message) notify('Ready');
}
