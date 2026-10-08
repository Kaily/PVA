import { Emitter } from '../core/Emitter';
import { clamp } from '../core/math';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Clock } from '../audio/Clock';
import type { InstrumentManager } from '../audio/InstrumentManager';
import type { Part } from '../audio/MixerEngine';
import type { SustainManager, PedalKind } from '../audio/SustainManager';
import type { VoiceManager } from '../audio/VoiceManager';
import type { ArpSettings } from '../data/arpPatterns';
import { toneById } from '../data/tones';
import { Arpeggiator } from '../music/Arpeggiator';
import { detectChord, type Chord } from '../music/ChordDetector';
import { HARMONY_VELOCITY, harmonize, type HarmonyMode } from '../music/Harmonizer';
import type { MidiManager } from '../midi/MidiManager';
import type { PartId } from '../state/appState';
import { applyTouch, type TouchMode } from './velocity';

/**
 * KeyboardController — the performance router.
 *
 * Every way of playing (mouse, touch, computer keyboard, MIDI) ends up in
 * keyDown()/keyUp() with a *physical key number* (MIDI numbering, 36–96 on
 * the on-screen keybed). From there the controller
 *
 *   1. tracks which sources hold which key, so a key shared by two sources
 *      only stops when the last one lets go and nothing can get stuck,
 *   2. applies touch response and the soft pedal,
 *   3. decides which parts the key plays: the lower part below the split
 *      point, otherwise Upper 1 and — when layer is on — Upper 2,
 *   4. applies octave and transpose (keyboard-wide and per part), remembering
 *      the notes each key actually started so they are released correctly
 *      even if settings change while the key is down,
 *   5. passes upper-zone keys through the arpeggiator or adds harmony notes
 *      when those are switched on,
 *   6. talks to the voice engine, and
 *   7. emits lightweight events for the visuals (no React involved).
 */

export type ControllerEvents = {
  /** Visual key state (physical key number). */
  key: { key: number; down: boolean; velocity: number };
  /** Velocity of the latest strike after touch response (for the meter). */
  velocity: number;
  /** Pitch bend position −1…+1 (for the wheel). */
  bend: number;
  /** Modulation amount 0…1 (for the wheel). */
  modulation: number;
  /** Detected chord name, or null. */
  chord: string | null;
  /** A note arrived (MIDI) while the browser still blocks audio. */
  blocked: null;
};

export interface ControllerHooks {
  /** MIDI CC7. */
  masterVolume(value: number): void;
  /** MIDI program change (with the bank selected by CC0 / CC32). */
  program(bank: number, program: number): void;
  notify(message: string): void;
}

interface PartRuntime {
  part: Part;
  toneId: string;
  octave: number;
  transpose: number;
}

interface Sounding {
  partId: PartId;
  note: number;
}

const CHORD_SETTLE_MS = 35;
const CHORD_HOLD_MS = 1600;
const UPPER: PartId[] = ['upper1', 'upper2'];
const ALL: PartId[] = ['upper1', 'upper2', 'lower'];

export class KeyboardController {
  readonly events = new Emitter<ControllerEvents>();
  hooks: ControllerHooks = { masterVolume: () => undefined, program: () => undefined, notify: () => undefined };

  /* performance settings, written by the actions layer */
  enabled = true;
  transpose = 0;
  octave = 0;
  touchMode: TouchMode = 'normal';
  fixedVelocity = 100;
  bendRange = 2;
  harmonyOn = false;
  harmonyMode: HarmonyMode = 'duet';

  readonly arp: Arpeggiator;

  private readonly parts: Record<PartId, PartRuntime>;
  private layerOn = false;
  private splitOn = false;
  private splitPoint = 54;

  /** key → sources holding it */
  private readonly held = new Map<number, Set<string>>();
  /** key → notes it started, per part */
  private readonly sounding = new Map<number, Sounding[]>();
  /** keys currently feeding the arpeggiator */
  private readonly arpKeys = new Set<number>();
  private wheelMod = 0;
  private aftertouch = 0;
  private bankMsb = 0;
  private chordTimer = 0;
  private chordClearTimer = 0;
  private lastChordName: string | null = null;
  /** Chord used for harmony: the last one recognised (kept after the hand lifts). */
  private chord: Chord | null = null;

  constructor(
    private readonly engine: AudioEngine,
    private readonly voices: VoiceManager,
    private readonly sustain: SustainManager,
    private readonly instruments: InstrumentManager,
    parts: Record<PartId, Part>,
    clock: Clock,
    midi: MidiManager,
  ) {
    this.parts = {
      upper1: { part: parts.upper1, toneId: '', octave: 0, transpose: 0 },
      upper2: { part: parts.upper2, toneId: '', octave: 0, transpose: 0 },
      lower: { part: parts.lower, toneId: '', octave: 0, transpose: 0 },
    };
    this.arp = new Arpeggiator(clock, (key, velocity, when, until) => this.playArpNote(key, velocity, when, until));

    midi.events.on('noteOn', (e) => this.keyDown(`midi:${e.channel}`, e.note, e.velocity));
    midi.events.on('noteOff', (e) => this.keyUp(`midi:${e.channel}`, e.note));
    midi.events.on('cc', (e) => this.controlChange(e.controller, e.value));
    midi.events.on('pitchBend', (e) => this.setBend(e.value, true));
    midi.events.on('program', (e) => this.hooks.program(this.bankMsb, e.program));
    midi.events.on('aftertouch', (e) => {
      this.aftertouch = e.value;
      this.applyModulation();
    });
    midi.events.on('disconnected', (e) => {
      // A vanished controller can never send its Note Offs — clean up for it.
      this.releaseSources('midi');
      this.sustain.releaseSource('midi');
      this.setBend(0, true);
      this.aftertouch = 0;
      this.applyModulation();
      this.hooks.notify(`MIDI device disconnected: ${e.name}`);
    });
  }

  /* ---------------------------------------------------------------- */
  /* set-up                                                            */
  /* ---------------------------------------------------------------- */

  partTone(id: PartId): string {
    return this.parts[id].toneId;
  }

  /** Change a part's tone. Notes of that part that are still sounding are released. */
  setPartTone(id: PartId, toneId: string): void {
    const p = this.parts[id];
    if (p.toneId === toneId) return;
    this.silencePart(id);
    p.toneId = toneId;
    this.applyModulation();
  }

  setPartShift(id: PartId, octave: number, transpose: number): void {
    this.parts[id].octave = octave;
    this.parts[id].transpose = transpose;
  }

  /** Layer and split decide which parts a key plays; changing them lets the current notes go. */
  setRouting(layerOn: boolean, splitOn: boolean, splitPoint: number): void {
    if (layerOn === this.layerOn && splitOn === this.splitOn && splitPoint === this.splitPoint) return;
    if (this.layerOn && !layerOn) this.silencePart('upper2');
    if (this.splitOn !== splitOn || this.splitPoint !== splitPoint) {
      for (const key of [...this.sounding.keys()]) this.stopKey(key);
      this.arp.reset();
      this.arpKeys.clear();
      if (!splitOn) this.chord = null;
    }
    this.layerOn = layerOn;
    this.splitOn = splitOn;
    this.splitPoint = splitPoint;
    this.scheduleChord();
  }

  configureArp(settings: ArpSettings): void {
    const wasOn = this.arp.isOn;
    this.arp.configure(settings);
    if (wasOn !== settings.on) {
      // Hand the keys that are down over cleanly between direct playing and the arpeggiator.
      for (const key of [...this.sounding.keys()]) if (this.zoneOf(key) === 'upper') this.stopKey(key);
      this.arpKeys.clear();
    }
  }

  private silencePart(id: PartId): void {
    this.voices.allNotesOff(id);
    for (const [key, list] of this.sounding) {
      const rest = list.filter((s) => s.partId !== id);
      if (rest.length) this.sounding.set(key, rest);
      else this.sounding.delete(key);
    }
  }

  /* ---------------------------------------------------------------- */
  /* routing helpers                                                   */
  /* ---------------------------------------------------------------- */

  private zoneOf(key: number): 'upper' | 'lower' {
    return this.splitOn && key < this.splitPoint ? 'lower' : 'upper';
  }

  private targets(zone: 'upper' | 'lower'): PartId[] {
    if (zone === 'lower') return ['lower'];
    return this.layerOn ? UPPER : ['upper1'];
  }

  /** The note a key sounds on a part. Drum kits and effects ignore every pitch shift. */
  private noteFor(id: PartId, key: number): number {
    const p = this.parts[id];
    if (toneById(p.toneId)?.fixedPitch) return key;
    return key + this.transpose + this.octave * 12 + p.transpose + p.octave * 12;
  }

  private start(id: PartId, key: number, velocity: number, list: Sounding[]): void {
    const p = this.parts[id];
    const inst = this.instruments.get(p.toneId);
    if (!inst) return; // tone still loading
    const note = this.noteFor(id, key);
    if (this.voices.noteOn(p.part, inst, note, velocity)) list.push({ partId: id, note });
  }

  private stopKey(key: number): void {
    const list = this.sounding.get(key);
    if (!list) return;
    this.sounding.delete(key);
    for (const s of list) this.voices.noteOff(this.parts[s.partId].part, s.note);
  }

  private playArpNote(key: number, velocity: number, when: number, until: number): void {
    if (!this.enabled) return;
    for (const id of this.targets('upper')) {
      const p = this.parts[id];
      const inst = this.instruments.get(p.toneId);
      if (!inst) continue;
      const voice = this.voices.noteOn(p.part, inst, this.noteFor(id, key), velocity, { when });
      if (voice) this.voices.releaseVoice(voice, until);
    }
  }

  /* ---------------------------------------------------------------- */
  /* keys                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * @param source   "pointer:<id>", "qwerty" or "midi:<channel>"
   * @param key      physical key (MIDI number)
   * @param velocity raw velocity 1–127, before touch response
   */
  keyDown(source: string, key: number, velocity: number): void {
    if (key < 0 || key > 127) return;
    let holders = this.held.get(key);
    if (!holders) {
      holders = new Set();
      this.held.set(key, holders);
    }
    holders.add(source);

    let v = applyTouch(velocity, this.touchMode, this.fixedVelocity);
    v = this.sustain.applySoft('upper1', v);
    this.events.emit('key', { key, down: true, velocity: v });

    if (!this.enabled) return;
    if (!this.engine.isRunning) {
      if (source.startsWith('midi')) {
        // MIDI input is not a "user gesture": the browser will not start audio for it.
        this.events.emit('blocked', null);
        return;
      }
      void this.engine.resume();
    }

    const zone = this.zoneOf(key);
    this.events.emit('velocity', v);

    if (zone === 'upper' && this.arp.isOn) {
      this.stopKey(key);
      this.arpKeys.add(key);
      this.arp.keyDown(key, v);
      this.scheduleChord();
      return;
    }

    // Re-striking a key whose earlier notes are still mapped: let those go first.
    this.stopKey(key);
    const list: Sounding[] = [];
    const targets = this.targets(zone);
    for (const id of targets) this.start(id, key, v, list);

    if (zone === 'upper' && this.harmonyOn) {
      const soft = Math.max(1, Math.round(v * HARMONY_VELOCITY));
      // Harmony is worked out at sounding pitch, then mapped back to keys.
      for (const note of harmonize(this.harmonyMode, key + this.transpose, this.chord)) {
        const harmonyKey = note - this.transpose;
        if (harmonyKey < 0 || harmonyKey > 127) continue;
        for (const id of targets) this.start(id, harmonyKey, soft, list);
      }
    }
    if (list.length) this.sounding.set(key, list);
    this.scheduleChord();
  }

  keyUp(source: string, key: number): void {
    const holders = this.held.get(key);
    if (!holders || !holders.delete(source)) return;
    if (holders.size > 0) return; // another source still holds the key
    this.held.delete(key);
    this.events.emit('key', { key, down: false, velocity: 0 });

    if (this.arpKeys.delete(key)) this.arp.keyUp(key);
    this.stopKey(key);
    this.scheduleChord();
  }

  /** Release every key held by sources whose id starts with `prefix`. */
  releaseSources(prefix: string): void {
    for (const [key, holders] of [...this.held]) {
      for (const source of [...holders]) {
        if (source.startsWith(prefix)) this.keyUp(source, key);
      }
    }
  }

  isKeyDown(key: number): boolean {
    return this.held.has(key);
  }

  heldKeys(): number[] {
    return [...this.held.keys()];
  }

  /* ---------------------------------------------------------------- */
  /* pedals and controllers                                            */
  /* ---------------------------------------------------------------- */

  /** Pedals act on the upper parts; the lower (split) part is left dry, as on an arranger. */
  pedal(kind: PedalKind, source: string, down: boolean): void {
    for (const id of UPPER) this.sustain.set(id, kind, source, down);
  }

  /** @param value −1…+1 */
  setBend(value: number, fromMidi = false): void {
    const v = clamp(value, -1, 1);
    for (const id of ALL) this.parts[id].part.setBendCents(v * this.bendRange * 100);
    if (fromMidi) this.events.emit('bend', v);
  }

  /** @param value 0…1 */
  setModulation(value: number, fromMidi = false): void {
    this.wheelMod = clamp(value, 0, 1);
    this.applyModulation();
    if (fromMidi) this.events.emit('modulation', this.wheelMod);
  }

  private applyModulation(): void {
    const amount = Math.max(this.wheelMod, this.aftertouch);
    for (const id of ALL) {
      const p = this.parts[id];
      const mod = toneById(p.toneId)?.modulation;
      // With a rotary speaker inserted, the wheel changes the rotor speed instead of adding vibrato.
      if (p.part.insertTakesModulation) {
        p.part.setInsertModulation(amount);
        p.part.setVibrato(0);
      } else {
        p.part.setVibrato(amount * (mod?.depthCents ?? 25), mod?.rateHz);
      }
    }
  }

  /** Call after a part's insert effect changed, so the wheel is routed correctly. */
  refreshModulation(): void {
    this.applyModulation();
  }

  setBendRange(semitones: number): void {
    this.bendRange = clamp(Math.round(semitones), 0, 12);
  }

  private controlChange(controller: number, value: number): void {
    switch (controller) {
      case 0:
        this.bankMsb = value;
        break;
      case 1:
        this.setModulation(value / 127, true);
        break;
      case 7:
        this.hooks.masterVolume(Math.round((value / 127) * 100));
        break;
      case 11:
        for (const id of ALL) this.parts[id].part.setExpression(value / 127);
        break;
      case 64:
        this.pedal('sustain', 'midi', value >= 64);
        break;
      case 66:
        this.pedal('sostenuto', 'midi', value >= 64);
        break;
      case 67:
        this.pedal('soft', 'midi', value >= 64);
        break;
      case 120: // All Sound Off
        this.panic();
        break;
      case 121: // Reset All Controllers
        this.setBend(0, true);
        this.setModulation(0, true);
        this.aftertouch = 0;
        for (const id of ALL) this.parts[id].part.setExpression(1);
        this.sustain.releaseSource('midi');
        break;
      case 123: // All Notes Off
        this.releaseSources('midi');
        break;
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- */
  /* panic                                                             */
  /* ---------------------------------------------------------------- */

  /** ALL NOTES OFF: silence everything, lift every pedal, centre the controllers. */
  panic(): void {
    for (const key of [...this.held.keys()]) {
      this.events.emit('key', { key, down: false, velocity: 0 });
    }
    this.held.clear();
    this.sounding.clear();
    this.arpKeys.clear();
    this.arp.reset();
    this.voices.allSoundOff();
    this.sustain.reset();
    this.aftertouch = 0;
    this.chord = null;
    this.setBend(0, true);
    this.setModulation(0, true);
    for (const id of ALL) this.parts[id].part.setExpression(1);
    this.scheduleChord();
  }

  /* ---------------------------------------------------------------- */
  /* chord recognition                                                 */
  /* ---------------------------------------------------------------- */

  private scheduleChord(): void {
    if (this.chordTimer) return;
    // Let the notes of a chord arrive before analysing (they are never perfectly together).
    this.chordTimer = window.setTimeout(() => {
      this.chordTimer = 0;
      // With a split keyboard the chord is read from the lower zone only,
      // so a melody on top never disturbs it.
      const notes: number[] = [];
      for (const key of this.held.keys()) {
        if (this.splitOn && key >= this.splitPoint) continue;
        notes.push(key + this.transpose);
      }
      const chord = detectChord(notes);
      if (chord) {
        this.chord = chord;
        window.clearTimeout(this.chordClearTimer);
        this.chordClearTimer = 0;
        this.publishChord(chord.name);
      } else if (notes.length === 0 && this.lastChordName && !this.chordClearTimer && !this.splitOn) {
        // Keep the last chord readable for a moment after the hands lift.
        // (With split on it stays: the accompaniment chord is remembered.)
        this.chordClearTimer = window.setTimeout(() => {
          this.chordClearTimer = 0;
          if (this.held.size === 0) {
            this.chord = null;
            this.publishChord(null);
          }
        }, CHORD_HOLD_MS);
      }
    }, CHORD_SETTLE_MS);
  }

  private publishChord(name: string | null): void {
    if (name === this.lastChordName) return;
    this.lastChordName = name;
    this.events.emit('chord', name);
  }
}
