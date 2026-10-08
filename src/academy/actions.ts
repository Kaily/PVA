/**
 * Academy actions that touch the instrument's panel state. Kept apart from
 * LessonEngine so the engine depends only on the audio/input engines, never
 * on the panel's actions layer.
 */
import { KEYBOARD_ROWS } from '../data/keymap';
import { services } from '../services';
import * as act from '../state/actions';
import type { AppState } from '../state/appState';
import type { UiKey } from './i18n';

let restoreMetronome = false;

/** Open the Academy in place of the control panel. The panel metronome is paused meanwhile (the lesson has its own clicks). */
export function openAcademy(): void {
  const { academy, store } = services();
  if (academy.store.get().open) return;
  const s = store.get();
  restoreMetronome = s.metronomeOn;
  if (s.metronomeOn) act.setMetronome(false);
  if (s.helpOpen) act.toggleHelp(false);
  act.unlockAudio();
  academy.open();
}

/** Back to the instrument: its own tempo and metronome come back as they were. */
export function closeAcademy(): void {
  const { academy, clock, store } = services();
  academy.close();
  clock.setTempo(store.get().tempo);
  if (restoreMetronome) act.setMetronome(true);
  restoreMetronome = false;
}

/** Settings of the instrument that would make a lesson sound or behave differently from what it teaches (label keys). */
export function lessonWarnings(s: AppState): UiKey[] {
  const w: UiKey[] = [];
  const shift = s.transpose !== 0 || s.octave !== 0 || s.parts.upper1.octave !== 0 || s.parts.upper1.transpose !== 0;
  if (shift) w.push('warnShift');
  if (s.arp.on) w.push('warnArp');
  if (s.harmonyOn) w.push('warnHarmony');
  if (s.layerOn) w.push('warnLayer');
  if (s.splitOn && s.splitPoint > 55) w.push('warnSplit');
  return w;
}

/** One click: put the instrument into the plain set-up the lessons assume. */
export function prepareInstrumentForLesson(): void {
  const s = services().store.get();
  if (s.transpose !== 0) act.setTranspose(0, false);
  if (s.octave !== 0) act.setOctave(0, false);
  if (s.parts.upper1.octave !== 0) act.setPartValue('upper1', 'octave', 0);
  if (s.parts.upper1.transpose !== 0) act.setPartValue('upper1', 'transpose', 0);
  if (s.arp.on) act.setArp({ on: false });
  if (s.harmonyOn) act.setHarmonyOn(false);
  if (s.layerOn) act.setLayer(false);
  if (s.splitOn) act.setSplit(false);
}

/** Computer key that plays a piano key with the current key map (e.g. "T" for G4), or null. */
export function computerKeyFor(keyMap: Record<string, number>, midi: number): string | null {
  const code = Object.keys(keyMap).find((c) => keyMap[c] === midi);
  if (!code) return null;
  for (const row of KEYBOARD_ROWS) {
    const k = row.find((x) => x.code === code);
    if (k) return k.cap;
  }
  return code.replace(/^Key|^Digit/, '');
}
