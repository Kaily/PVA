import { TEMPO_MAX, TEMPO_MIN } from '../audio/Clock';
import type { LatencyMode } from '../audio/AudioEngine';
import { signed } from '../core/math';
import { ARP_MODES, ARP_PATTERNS, ARP_RATES, arpPatternById, type ArpMode } from '../data/arpPatterns';
import {
  CHORUS_PRESETS,
  chorusById,
  DELAY_PRESETS,
  delayById,
  DSP_PRESETS,
  DSP_TYPE_LABEL,
  dspById,
  EQ_BANDS,
  EQ_GAIN_RANGE,
  EQ_PRESETS,
  eqById,
  USER_EQ_ID,
} from '../data/effectPresets';
import { QUALITY_TIERS, type SampleQuality } from '../data/instruments';
import { FIRST_KEY, LAST_KEY } from '../data/keyboardLayout';
import { METRONOME_SOUNDS, metronomeSoundById } from '../data/metronomeSounds';
import { REVERB_PRESETS, reverbById } from '../data/reverbPresets';
import { CATEGORY_ORDER, toneById } from '../data/tones';
import { TOUCH_MODES, type TouchMode } from '../input/velocity';
import { HARMONY_MODES, type HarmonyMode } from '../music/Harmonizer';
import { noteName, type NoteLabelMode } from '../music/notes';
import { services } from '../services';
import * as act from './actions';
import { PART_IDS, PART_LABEL, type AppState, type LcdPage, type PartId, type PointerVelocityMode } from './appState';

/**
 * Parameter registry — one description per editable value. The display, the
 * data wheel, the −/+ buttons and the cursor keys all work from these
 * definitions, so adding a setting means adding one entry here.
 */

interface Base {
  id: string;
  label: string;
  /** Short label for the small tiles of the main screen. */
  short?: string;
  format(s: AppState): string;
}

export interface NumberParam extends Base {
  kind: 'number';
  min: number;
  max: number;
  step: number;
  get(s: AppState): number;
  set(v: number): void;
}

export interface EnumParam extends Base {
  kind: 'enum';
  options(s: AppState): { value: string; label: string }[];
  get(s: AppState): string;
  set(v: string): void;
}

export interface ToggleParam extends Base {
  kind: 'toggle';
  get(s: AppState): boolean;
  set(v: boolean): void;
}

export interface LinkParam extends Base {
  kind: 'link';
  open(): void;
}

/** A read-only line (no cursor stop). */
export interface InfoParam extends Base {
  kind: 'info';
}

export type Param = NumberParam | EnumParam | ToggleParam | LinkParam | InfoParam;

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');

const LATENCY_OPTIONS: { value: LatencyMode; label: string }[] = [
  { value: 'interactive', label: 'Lowest' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'playback', label: 'Safe' },
];

const LABEL_OPTIONS: { value: NoteLabelMode; label: string }[] = [
  { value: 'off', label: 'OFF' },
  { value: 'note', label: 'Note name' },
  { value: 'solfege', label: 'Solfege' },
];

const POINTER_OPTIONS: { value: PointerVelocityMode; label: string }[] = [
  { value: 'position', label: 'Key position' },
  { value: 'fixed', label: 'Fixed' },
];

const EQ_OPTIONS = [...EQ_PRESETS.map((p) => ({ value: p.id, label: p.name })), { value: USER_EQ_ID, label: 'User' }];

/** The part that is being edited. */
const sel = (s: AppState): PartId => s.selectedPart;
const selPart = (s: AppState) => s.parts[s.selectedPart];
const panText = (v: number): string => (v === 0 ? 'Centre' : v < 0 ? `L ${-v}` : `R ${v}`);

function partNumber(
  id: string,
  label: string,
  key: 'volume' | 'pan' | 'octave' | 'transpose' | 'reverb' | 'chorus' | 'delay',
  min: number,
  max: number,
  format: (v: number) => string,
): NumberParam {
  return {
    kind: 'number',
    id,
    label,
    min,
    max,
    step: 1,
    get: (s) => selPart(s)[key],
    set: (v) => act.setPartValue(sel(services().store.get()), key, v),
    format: (s) => format(selPart(s)[key]),
  };
}

function eqGain(index: number): NumberParam {
  const band = EQ_BANDS[index];
  return {
    kind: 'number',
    id: `eq${index}`,
    label: `${band.label} gain`,
    min: -EQ_GAIN_RANGE,
    max: EQ_GAIN_RANGE,
    step: 0.5,
    get: (s) => act.currentEq(s)[index].gain,
    set: (v) => act.setEqBand(index, { gain: v }),
    format: (s) => {
      const b = act.currentEq(s)[index];
      const f = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(b.freq % 1000 ? 1 : 0)} kHz` : `${b.freq} Hz`;
      return `${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)} dB @ ${f}`;
    },
  };
}

const list: Param[] = [
  /* ---------------- tempo / metronome ---------------- */
  {
    kind: 'number',
    id: 'tempo',
    label: 'Tempo',
    min: TEMPO_MIN,
    max: TEMPO_MAX,
    step: 1,
    get: (s) => s.tempo,
    set: (v) => act.setTempo(v, false),
    format: (s) => `${s.tempo}`,
  },
  {
    kind: 'number',
    id: 'beats',
    label: 'Metronome beats',
    short: 'Beat',
    min: 0,
    max: 16,
    step: 1,
    get: (s) => s.metronomeBeats,
    set: act.setMetronomeBeats,
    format: (s) => (s.metronomeBeats === 0 ? 'No accent' : `${s.metronomeBeats}/4`),
  },
  {
    kind: 'toggle',
    id: 'metronome',
    label: 'Metronome',
    get: (s) => s.metronomeOn,
    set: act.setMetronome,
    format: (s) => onOff(s.metronomeOn),
  },
  {
    kind: 'number',
    id: 'metVolume',
    label: 'Metronome volume',
    min: 0,
    max: 100,
    step: 1,
    get: (s) => s.metronomeVolume,
    set: act.setMetronomeVolume,
    format: (s) => `${s.metronomeVolume}`,
  },
  {
    kind: 'enum',
    id: 'metSound',
    label: 'Metronome sound',
    options: () => METRONOME_SOUNDS.map((m) => ({ value: m.id, label: m.name })),
    get: (s) => s.metronomeSound,
    set: act.setMetronomeSound,
    format: (s) => metronomeSoundById(s.metronomeSound).name,
  },

  /* ---------------- pitch ---------------- */
  {
    kind: 'number',
    id: 'transpose',
    label: 'Transpose',
    min: -12,
    max: 12,
    step: 1,
    get: (s) => s.transpose,
    set: (v) => act.setTranspose(v, false),
    format: (s) => signed(s.transpose),
  },
  {
    kind: 'number',
    id: 'octave',
    label: 'Octave shift',
    short: 'Octave',
    min: -3,
    max: 3,
    step: 1,
    get: (s) => s.octave,
    set: (v) => act.setOctave(v, false),
    format: (s) => signed(s.octave),
  },
  {
    kind: 'number',
    id: 'tune',
    label: 'Tuning (A4)',
    short: 'Tune',
    min: 415.5,
    max: 465.9,
    step: 0.1,
    get: (s) => s.tuneHz,
    set: act.setTune,
    format: (s) => `${s.tuneHz.toFixed(1)} Hz`,
  },
  {
    kind: 'number',
    id: 'bendRange',
    label: 'Pitch bend range',
    short: 'Bend',
    min: 0,
    max: 12,
    step: 1,
    get: (s) => s.bendRange,
    set: act.setBendRange,
    format: (s) => `±${s.bendRange}`,
  },

  /* ---------------- keyboard ---------------- */
  {
    kind: 'enum',
    id: 'touch',
    label: 'Touch response',
    short: 'Touch',
    options: () => TOUCH_MODES.map((m) => ({ value: m.id, label: m.label })),
    get: (s) => s.touchMode,
    set: (v) => act.setTouchMode(v as TouchMode, false),
    format: (s) => TOUCH_MODES.find((m) => m.id === s.touchMode)?.label ?? '',
  },
  {
    kind: 'number',
    id: 'fixedVelocity',
    label: 'Fixed velocity (touch OFF)',
    min: 1,
    max: 127,
    step: 1,
    get: (s) => s.fixedVelocity,
    set: act.setFixedVelocity,
    format: (s) => `${s.fixedVelocity}`,
  },
  {
    kind: 'enum',
    id: 'pointerVelocity',
    label: 'Mouse / touch velocity',
    options: () => POINTER_OPTIONS,
    get: (s) => s.pointerVelocity,
    set: (v) => act.setPointerVelocity(v as PointerVelocityMode),
    format: (s) => POINTER_OPTIONS.find((o) => o.value === s.pointerVelocity)?.label ?? '',
  },
  {
    kind: 'number',
    id: 'pcKeyVelocity',
    label: 'Computer keyboard velocity',
    min: 1,
    max: 127,
    step: 1,
    get: (s) => s.pcKeyVelocity,
    set: act.setPcKeyVelocity,
    format: (s) => `${s.pcKeyVelocity}`,
  },
  {
    kind: 'toggle',
    id: 'sustain',
    label: 'Sustain',
    get: (s) => s.sustainLatch,
    set: act.setSustainLatch,
    format: (s) => onOff(s.sustainDown),
  },
  {
    kind: 'enum',
    id: 'noteLabels',
    label: 'Note labels',
    options: () => LABEL_OPTIONS,
    get: (s) => s.noteLabels,
    set: (v) => act.setNoteLabels(v as NoteLabelMode, false),
    format: (s) => LABEL_OPTIONS.find((o) => o.value === s.noteLabels)?.label ?? '',
  },

  /* ---------------- split / layer ---------------- */
  {
    kind: 'toggle',
    id: 'layer',
    label: 'Layer (Upper 2)',
    short: 'Layer',
    get: (s) => s.layerOn,
    set: act.setLayer,
    format: (s) => onOff(s.layerOn),
  },
  {
    kind: 'toggle',
    id: 'split',
    label: 'Split (Lower)',
    short: 'Split',
    get: (s) => s.splitOn,
    set: act.setSplit,
    format: (s) => (s.splitOn ? `ON ${noteName(s.splitPoint)}` : 'OFF'),
  },
  {
    kind: 'number',
    id: 'splitPoint',
    label: 'Split point',
    min: FIRST_KEY + 1,
    max: LAST_KEY,
    step: 1,
    get: (s) => s.splitPoint,
    set: (v) => act.setSplitPoint(v, false),
    format: (s) => noteName(s.splitPoint),
  },

  /* ---------------- the part being edited ---------------- */
  {
    kind: 'enum',
    id: 'selectedPart',
    label: 'Part',
    options: () => PART_IDS.map((id) => ({ value: id, label: PART_LABEL[id] })),
    get: (s) => s.selectedPart,
    set: (v) => act.selectPart(v as PartId),
    format: (s) => PART_LABEL[s.selectedPart],
  },
  {
    kind: 'link',
    id: 'partTone',
    label: 'Tone',
    format: (s) => {
      const t = toneById(selPart(s).toneId);
      return t ? `${String(t.number).padStart(3, '0')} ${t.name} ▸` : '▸';
    },
    open: () => act.openToneBrowser(),
  },
  partNumber('partVolume', 'Volume', 'volume', 0, 100, (v) => `${v}`),
  partNumber('partPan', 'Pan', 'pan', -50, 50, panText),
  partNumber('partOctave', 'Octave', 'octave', -2, 2, signed),
  partNumber('partTranspose', 'Transpose', 'transpose', -12, 12, signed),
  partNumber('partReverb', 'Reverb send', 'reverb', 0, 100, (v) => `${v}`),
  partNumber('partChorus', 'Chorus send', 'chorus', 0, 100, (v) => `${v}`),
  partNumber('partDelay', 'Delay send', 'delay', 0, 100, (v) => `${v}`),
  {
    kind: 'toggle',
    id: 'partDsp',
    label: 'DSP',
    get: (s) => selPart(s).dspOn,
    set: (v) => act.setPartDsp(sel(services().store.get()), v),
    format: (s) => onOff(selPart(s).dspOn),
  },
  {
    kind: 'enum',
    id: 'partDspType',
    label: 'DSP type',
    options: () => DSP_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    get: (s) => selPart(s).dspId,
    set: (v) => act.setPartDspPreset(sel(services().store.get()), v),
    format: (s) => {
      const p = dspById(selPart(s).dspId);
      return p ? `${String(p.number).padStart(2, '0')} ${p.name}` : '';
    },
  },
  {
    kind: 'info',
    id: 'dspKind',
    label: 'Algorithm',
    format: (s) => {
      const p = dspById(selPart(s).dspId);
      return p ? DSP_TYPE_LABEL[p.type] : '';
    },
  },
  {
    kind: 'info',
    id: 'dspWheel',
    label: 'Modulation wheel',
    format: (s) => (dspById(selPart(s).dspId)?.type === 'rotary' ? 'Rotor slow / fast' : 'Vibrato'),
  },

  /* ---------------- effects ---------------- */
  {
    kind: 'toggle',
    id: 'reverbOn',
    label: 'Reverb',
    get: (s) => s.reverbOn,
    set: act.setReverbOn,
    format: (s) => onOff(s.reverbOn),
  },
  {
    kind: 'enum',
    id: 'reverbType',
    label: 'Reverb type',
    short: 'Reverb',
    options: () => REVERB_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    get: (s) => s.reverbType,
    set: act.setReverbType,
    format: (s) => (s.reverbOn ? reverbById(s.reverbType).name : 'OFF'),
  },
  {
    kind: 'number',
    id: 'reverbLevel',
    label: 'Reverb level',
    short: 'Rev level',
    min: 0,
    max: 100,
    step: 1,
    get: (s) => s.reverbLevel,
    set: act.setReverbLevel,
    format: (s) => `${s.reverbLevel}`,
  },
  {
    kind: 'toggle',
    id: 'chorusOn',
    label: 'Chorus',
    get: (s) => s.chorusOn,
    set: act.setChorusOn,
    format: (s) => onOff(s.chorusOn),
  },
  {
    kind: 'enum',
    id: 'chorusType',
    label: 'Chorus type',
    options: () => CHORUS_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    get: (s) => s.chorusType,
    set: act.setChorusType,
    format: (s) => chorusById(s.chorusType).name,
  },
  {
    kind: 'number',
    id: 'chorusLevel',
    label: 'Chorus level',
    min: 0,
    max: 100,
    step: 1,
    get: (s) => s.chorusLevel,
    set: act.setChorusLevel,
    format: (s) => `${s.chorusLevel}`,
  },
  {
    kind: 'toggle',
    id: 'delayOn',
    label: 'Delay',
    get: (s) => s.delayOn,
    set: act.setDelayOn,
    format: (s) => onOff(s.delayOn),
  },
  {
    kind: 'enum',
    id: 'delayType',
    label: 'Delay type',
    options: () => DELAY_PRESETS.map((p) => ({ value: p.id, label: p.name })),
    get: (s) => s.delayType,
    set: act.setDelayType,
    format: (s) => delayById(s.delayType).name,
  },
  {
    kind: 'number',
    id: 'delayLevel',
    label: 'Delay level',
    min: 0,
    max: 100,
    step: 1,
    get: (s) => s.delayLevel,
    set: act.setDelayLevel,
    format: (s) => `${s.delayLevel}`,
  },
  {
    kind: 'enum',
    id: 'eqPreset',
    label: 'EQ curve',
    options: () => EQ_OPTIONS,
    get: (s) => s.eqPreset,
    set: act.setEqPreset,
    format: (s) => eqById(s.eqPreset)?.name ?? 'User',
  },
  eqGain(0),
  eqGain(1),
  eqGain(2),
  eqGain(3),

  /* ---------------- arpeggiator / harmony ---------------- */
  {
    kind: 'toggle',
    id: 'arpOn',
    label: 'Arpeggiator',
    get: (s) => s.arp.on,
    set: (v) => act.setArp({ on: v }),
    format: (s) => onOff(s.arp.on),
  },
  {
    kind: 'enum',
    id: 'arpMode',
    label: 'Mode',
    options: () => ARP_MODES.map((m) => ({ value: m.id, label: m.label })),
    get: (s) => s.arp.mode,
    set: (v) => act.setArp({ mode: v as ArpMode }),
    format: (s) => ARP_MODES.find((m) => m.id === s.arp.mode)?.label ?? '',
  },
  {
    kind: 'enum',
    id: 'arpPattern',
    label: 'Pattern (Pattern mode)',
    options: () => ARP_PATTERNS.map((p) => ({ value: p.id, label: p.name })),
    get: (s) => s.arp.pattern,
    set: (v) => act.setArp({ pattern: v }),
    format: (s) => arpPatternById(s.arp.pattern).name,
  },
  {
    kind: 'enum',
    id: 'arpRate',
    label: 'Rate',
    options: () => ARP_RATES.map((r) => ({ value: r.id, label: r.label })),
    get: (s) => s.arp.rate,
    set: (v) => act.setArp({ rate: v }),
    format: (s) => ARP_RATES.find((r) => r.id === s.arp.rate)?.label ?? '',
  },
  {
    kind: 'number',
    id: 'arpOctaves',
    label: 'Octaves',
    min: 1,
    max: 4,
    step: 1,
    get: (s) => s.arp.octaves,
    set: (v) => act.setArp({ octaves: v }),
    format: (s) => `${s.arp.octaves}`,
  },
  {
    kind: 'number',
    id: 'arpGate',
    label: 'Gate',
    min: 10,
    max: 100,
    step: 5,
    get: (s) => s.arp.gate,
    set: (v) => act.setArp({ gate: v }),
    format: (s) => `${s.arp.gate} %`,
  },
  {
    kind: 'number',
    id: 'arpSwing',
    label: 'Swing',
    min: 0,
    max: 60,
    step: 5,
    get: (s) => s.arp.swing,
    set: (v) => act.setArp({ swing: v }),
    format: (s) => `${s.arp.swing} %`,
  },
  {
    kind: 'toggle',
    id: 'arpLatch',
    label: 'Latch',
    get: (s) => s.arp.latch,
    set: (v) => act.setArp({ latch: v }),
    format: (s) => onOff(s.arp.latch),
  },
  {
    kind: 'toggle',
    id: 'harmonyOn',
    label: 'Auto harmonize',
    get: (s) => s.harmonyOn,
    set: act.setHarmonyOn,
    format: (s) => onOff(s.harmonyOn),
  },
  {
    kind: 'enum',
    id: 'harmonyMode',
    label: 'Harmony type',
    options: () => HARMONY_MODES.map((m) => ({ value: m.id, label: m.label })),
    get: (s) => s.harmonyMode,
    set: (v) => act.setHarmonyMode(v as HarmonyMode),
    format: (s) => HARMONY_MODES.find((m) => m.id === s.harmonyMode)?.label ?? '',
  },

  {
    kind: 'info',
    id: 'harmonySource',
    label: 'Chord taken from',
    format: (s) => (s.splitOn ? `Lower zone (below ${noteName(s.splitPoint)})` : 'Split is off: Octave only'),
  },

  /* ---------------- sound / system ---------------- */
  {
    kind: 'number',
    id: 'volume',
    label: 'Master volume',
    min: 0,
    max: 100,
    step: 1,
    get: (s) => s.masterVolume,
    set: (v) => act.setMasterVolume(v, false),
    format: (s) => `${s.masterVolume}`,
  },
  {
    kind: 'toggle',
    id: 'keyOffNoise',
    label: 'Piano key-off noise',
    get: (s) => s.keyOffNoise,
    set: act.setKeyOffNoise,
    format: (s) => onOff(s.keyOffNoise),
  },
  {
    kind: 'enum',
    id: 'quality',
    label: 'Grand piano quality',
    options: () =>
      (Object.keys(QUALITY_TIERS) as SampleQuality[]).map((q) => ({
        value: q,
        label: `${QUALITY_TIERS[q].label} ~${QUALITY_TIERS[q].approxMb} MB`,
      })),
    get: (s) => s.quality,
    set: (v) => act.setQuality(v as SampleQuality),
    format: (s) => `${QUALITY_TIERS[s.quality].label} ~${QUALITY_TIERS[s.quality].approxMb} MB`,
  },
  {
    kind: 'enum',
    id: 'latencyMode',
    label: 'Audio latency mode',
    options: () => LATENCY_OPTIONS,
    get: (s) => s.latencyMode,
    set: (v) => act.setLatencyMode(v as LatencyMode),
    format: (s) => LATENCY_OPTIONS.find((o) => o.value === s.latencyMode)?.label ?? '',
  },
  {
    kind: 'enum',
    id: 'midiInput',
    label: 'MIDI input',
    options: (s) => [
      { value: 'all', label: 'All devices' },
      ...s.midiInputs.filter((i) => i.connected).map((i) => ({ value: i.id, label: i.name })),
    ],
    get: (s) => s.midiInput,
    set: act.selectMidiInput,
    format: (s) =>
      s.midiInput === 'all' ? 'All devices' : (s.midiInputs.find((i) => i.id === s.midiInput)?.name ?? 'All devices'),
  },

  /* ---------------- page links ---------------- */
  { kind: 'link', id: 'openTones', label: 'Tone browser', format: () => '▸', open: () => act.openToneBrowser() },
  { kind: 'link', id: 'openPart', label: 'Part settings', format: () => '▸', open: () => act.showPage('part', 'selectedPart') },
  { kind: 'link', id: 'openReverb', label: 'Reverb', format: (s) => `${s.reverbOn ? reverbById(s.reverbType).name : 'OFF'} ▸`, open: () => act.showPage('reverb', 'reverbType') },
  { kind: 'link', id: 'openChorus', label: 'Chorus', format: (s) => `${s.chorusOn ? chorusById(s.chorusType).name : 'OFF'} ▸`, open: () => act.showPage('chorus', 'chorusType') },
  { kind: 'link', id: 'openDelay', label: 'Delay', format: (s) => `${s.delayOn ? delayById(s.delayType).name : 'OFF'} ▸`, open: () => act.showPage('delay', 'delayType') },
  { kind: 'link', id: 'openDsp', label: 'DSP (insert effect)', format: () => '▸', open: () => act.showPage('dsp', 'partDspType') },
  { kind: 'link', id: 'openEq', label: 'Equaliser', format: (s) => `${eqById(s.eqPreset)?.name ?? 'User'} ▸`, open: () => act.showPage('eq', 'eqPreset') },
  { kind: 'link', id: 'openArp', label: 'Arpeggiator', format: (s) => `${onOff(s.arp.on)} ▸`, open: () => act.showPage('arp', 'arpMode') },
  { kind: 'link', id: 'openHarmony', label: 'Auto harmonize', format: (s) => `${onOff(s.harmonyOn)} ▸`, open: () => act.showPage('harmony', 'harmonyMode') },
  { kind: 'link', id: 'openMidi', label: 'MIDI devices and monitor', format: () => '▸', open: () => act.showPage('midi', 'midiInput') },
  { kind: 'link', id: 'openMonitor', label: 'System monitor', format: () => '▸', open: () => act.showPage('monitor') },
  { kind: 'link', id: 'openHelp', label: 'Computer keyboard map', format: () => '▸', open: () => act.toggleHelp(true) },
];

export const PARAMS: Record<string, Param> = Object.fromEntries(list.map((p) => [p.id, p]));

/** Tiles of the main screen, as a grid (rows × 5 columns). */
export const MAIN_GRID: string[][] = [
  ['tempo', 'beats', 'transpose', 'octave', 'tune'],
  ['layer', 'split', 'sustain', 'touch', 'reverbType'],
];

export interface ParamGroup {
  title: string;
  params: string[];
}

/** Parameter lists of the pages that are plain lists. */
export const PAGE_GROUPS: Partial<Record<LcdPage, ParamGroup[]>> = {
  menu: [
    { title: 'Tones', params: ['openTones', 'openPart', 'layer', 'split', 'splitPoint'] },
    { title: 'Effects', params: ['openReverb', 'openChorus', 'openDelay', 'openDsp', 'openEq'] },
    { title: 'Performance', params: ['openArp', 'openHarmony'] },
    { title: 'Keyboard', params: ['touch', 'fixedVelocity', 'pointerVelocity', 'pcKeyVelocity', 'noteLabels'] },
    { title: 'Pitch', params: ['transpose', 'octave', 'tune', 'bendRange'] },
    { title: 'Metronome', params: ['metronome', 'tempo', 'beats', 'metVolume', 'metSound'] },
    { title: 'Sound', params: ['volume', 'keyOffNoise', 'quality'] },
    { title: 'System', params: ['latencyMode', 'openMidi', 'openMonitor', 'openHelp'] },
  ],
  part: [
    { title: 'Part', params: ['selectedPart', 'partTone', 'partVolume', 'partPan', 'partOctave', 'partTranspose'] },
    { title: 'Effect sends', params: ['partReverb', 'partChorus', 'partDelay'] },
    { title: 'Insert effect', params: ['partDsp', 'partDspType'] },
    { title: 'Zones', params: ['layer', 'split', 'splitPoint'] },
  ],
  reverb: [{ title: 'Reverb', params: ['reverbOn', 'reverbType', 'reverbLevel'] }, { title: 'Send of the selected part', params: ['selectedPart', 'partReverb'] }],
  chorus: [{ title: 'Chorus', params: ['chorusOn', 'chorusType', 'chorusLevel'] }, { title: 'Send of the selected part', params: ['selectedPart', 'partChorus'] }],
  delay: [{ title: 'Delay', params: ['delayOn', 'delayType', 'delayLevel'] }, { title: 'Send of the selected part', params: ['selectedPart', 'partDelay'] }],
  dsp: [{ title: 'Insert effect', params: ['selectedPart', 'partDsp', 'partDspType', 'dspKind', 'dspWheel'] }],
  eq: [{ title: 'Master equaliser', params: ['eqPreset', 'eq0', 'eq1', 'eq2', 'eq3'] }],
  arp: [{ title: 'Arpeggiator', params: ['arpOn', 'arpMode', 'arpPattern', 'arpRate', 'arpOctaves', 'arpGate', 'arpSwing', 'arpLatch'] }],
  harmony: [{ title: 'Auto harmonize', params: ['harmonyOn', 'harmonyMode', 'harmonySource', 'split', 'splitPoint'] }],
  midi: [{ title: 'MIDI', params: ['midiInput'] }],
};

export const PAGE_TITLE: Record<LcdPage, string> = {
  main: 'Professional Arranger',
  menu: 'Function',
  midi: 'MIDI',
  monitor: 'System monitor',
  tones: 'Tone',
  part: 'Part',
  reverb: 'Reverb',
  chorus: 'Chorus',
  delay: 'Delay',
  dsp: 'DSP',
  eq: 'Equaliser',
  arp: 'Arpeggiator',
  harmony: 'Harmony',
};

/** Cursor stops on each display page. */
export function pageParams(page: LcdPage): string[] {
  if (page === 'main') return MAIN_GRID.flat();
  return (PAGE_GROUPS[page]?.flatMap((g) => g.params) ?? []).filter((id) => PARAMS[id]?.kind !== 'info');
}

/* ------------------------------------------------------------------ */
/* editing                                                              */
/* ------------------------------------------------------------------ */

const state = (): AppState => services().store.get();

/** Turn the data wheel / press − or +: change the selected value by `steps` detents. */
export function adjustParam(id: string, steps: number): void {
  const p = PARAMS[id];
  if (!p || steps === 0) return;
  const s = state();
  switch (p.kind) {
    case 'number': {
      const next = Math.min(p.max, Math.max(p.min, p.get(s) + steps * p.step));
      // Avoid floating point dust on fractional steps.
      p.set(Math.round(next / p.step) * p.step);
      break;
    }
    case 'enum': {
      const options = p.options(s);
      const i = Math.max(0, options.findIndex((o) => o.value === p.get(s)));
      const next = Math.min(options.length - 1, Math.max(0, i + steps));
      if (next !== i) p.set(options[next].value);
      break;
    }
    case 'toggle':
      p.set(steps > 0);
      break;
    case 'link':
      if (steps > 0) p.open();
      break;
    case 'info':
      break;
  }
}

/** ENTER on a parameter. */
export function activateParam(id: string): void {
  const p = PARAMS[id];
  if (!p) return;
  const s = state();
  switch (p.kind) {
    case 'toggle':
      p.set(!p.get(s));
      break;
    case 'enum': {
      const options = p.options(s);
      const i = options.findIndex((o) => o.value === p.get(s));
      p.set(options[(i + 1) % options.length].value);
      break;
    }
    case 'link':
      p.open();
      break;
    case 'number':
    case 'info':
      break;
  }
}

export function adjustSelected(steps: number): void {
  const s = state();
  if (!s.power || s.booting) return;
  if (s.lcdPage === 'tones') return act.stepTone(steps);
  if (pageParams(s.lcdPage).includes(s.cursor)) adjustParam(s.cursor, steps);
}

export function activateSelected(): void {
  const s = state();
  if (!s.power || s.booting) return;
  if (s.lcdPage === 'tones') return act.showPage('main', 'tempo'); // ENTER confirms the tone and returns
  if (pageParams(s.lcdPage).includes(s.cursor)) activateParam(s.cursor);
}

export type CursorMove = 'up' | 'down' | 'left' | 'right';

/** Columns of the tone list on the display. */
export const BROWSER_COLUMNS = 2;

/** Previous / next category in the tone browser. */
export function stepCategory(delta: number): void {
  const s = state();
  const n = CATEGORY_ORDER.length;
  const i = Math.max(0, CATEGORY_ORDER.indexOf(s.browserCategory));
  act.setBrowserCategory(CATEGORY_ORDER[(i + delta + n) % n]);
}

/** Cursor keys. On the main screen they move over the tile grid; in lists ◀ ▶ change the value. */
export function moveCursor(move: CursorMove): void {
  const s = state();
  if (!s.power || s.booting) return;
  const page = s.lcdPage;
  if (page === 'tones') {
    // the list has two columns: ◀ ▶ step by one tone, ▲ ▼ by one row
    return act.stepTone(move === 'left' ? -1 : move === 'right' ? 1 : move === 'up' ? -BROWSER_COLUMNS : BROWSER_COLUMNS);
  }
  if (page === 'main') {
    const cols = MAIN_GRID[0].length;
    const flat = MAIN_GRID.flat();
    let i = flat.indexOf(s.cursor);
    if (i < 0) i = 0;
    const row = Math.floor(i / cols);
    const col = i % cols;
    let r = row;
    let c = col;
    if (move === 'left') c = (col + cols - 1) % cols;
    if (move === 'right') c = (col + 1) % cols;
    if (move === 'up') r = (row + MAIN_GRID.length - 1) % MAIN_GRID.length;
    if (move === 'down') r = (row + 1) % MAIN_GRID.length;
    act.setCursor(MAIN_GRID[r][c]);
    return;
  }
  const order = pageParams(page);
  if (order.length === 0) return;
  if (move === 'left') return adjustParam(s.cursor, -1);
  if (move === 'right') return adjustParam(s.cursor, +1);
  let i = order.indexOf(s.cursor);
  if (i < 0) i = 0;
  else i = move === 'up' ? Math.max(0, i - 1) : Math.min(order.length - 1, i + 1);
  act.setCursor(order[i]);
}

/** EXIT: back to the main screen. */
export function exitPage(): void {
  const s = state();
  if (s.helpOpen) return act.toggleHelp(false);
  if (s.lcdPage !== 'main') act.showPage('main', 'tempo');
}

/** FUNCTION: open the menu (or return from it). */
export function toggleMenu(): void {
  const s = state();
  if (s.lcdPage === 'menu') act.showPage('main', 'tempo');
  else act.showPage('menu', pageParams('menu')[0]);
}
