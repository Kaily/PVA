/**
 * Effect presets: chorus, delay, equaliser and insert DSP.
 * Pure data — the processing lives in audio/EffectsEngine.ts and audio/dsp.
 */

/* ------------------------------------------------------------------ */
/* chorus                                                               */
/* ------------------------------------------------------------------ */

export interface ChorusVoice {
  /** Centre delay, ms. */
  delayMs: number;
  /** Sweep depth, ms (peak). */
  depthMs: number;
  rateHz: number;
  /** Start phase of the sweep, 0–1 of a cycle. */
  phase: number;
  /** −1 (left) … +1 (right). */
  pan: number;
}

export interface ChorusPreset {
  id: string;
  name: string;
  voices: ChorusVoice[];
  /** Level trim of this preset. */
  gain: number;
}

export const CHORUS_PRESETS: ChorusPreset[] = [
  {
    id: 'light',
    name: 'Light',
    gain: 0.9,
    voices: [
      { delayMs: 14, depthMs: 1.4, rateHz: 0.45, phase: 0, pan: -0.6 },
      { delayMs: 17, depthMs: 1.4, rateHz: 0.45, phase: 0.5, pan: 0.6 },
    ],
  },
  {
    id: 'classic',
    name: 'Classic',
    gain: 1,
    voices: [
      { delayMs: 18, depthMs: 2.6, rateHz: 0.62, phase: 0, pan: -0.8 },
      { delayMs: 22, depthMs: 2.6, rateHz: 0.62, phase: 0.5, pan: 0.8 },
    ],
  },
  {
    id: 'wide',
    name: 'Wide',
    gain: 0.88,
    voices: [
      { delayMs: 16, depthMs: 3.2, rateHz: 0.38, phase: 0, pan: -1 },
      { delayMs: 24, depthMs: 3.2, rateHz: 0.38, phase: 0.5, pan: 1 },
      { delayMs: 30, depthMs: 2, rateHz: 0.21, phase: 0.25, pan: 0 },
    ],
  },
  {
    id: 'ensemble',
    name: 'Ensemble',
    gain: 0.72,
    voices: [
      { delayMs: 12, depthMs: 2.2, rateHz: 0.55, phase: 0, pan: -0.9 },
      { delayMs: 16, depthMs: 2.2, rateHz: 0.55, phase: 0.333, pan: 0 },
      { delayMs: 20, depthMs: 2.2, rateHz: 0.55, phase: 0.667, pan: 0.9 },
      { delayMs: 27, depthMs: 1.2, rateHz: 5.2, phase: 0.1, pan: 0.3 },
    ],
  },
];

export const DEFAULT_CHORUS_ID = 'classic';
export const chorusById = (id: string): ChorusPreset => CHORUS_PRESETS.find((p) => p.id === id) ?? CHORUS_PRESETS[1];

/* ------------------------------------------------------------------ */
/* delay                                                                */
/* ------------------------------------------------------------------ */

export interface DelayPreset {
  id: string;
  name: string;
  /** Follow the tempo: `left` / `right` are then in beats (1 = quarter note), else in seconds. */
  sync: boolean;
  left: number;
  right: number;
  /** Feedback of each side into itself, and across to the other side. */
  feedback: number;
  cross: number;
  /** How much of the input reaches each side. */
  inLeft: number;
  inRight: number;
  /** Low-pass in the feedback path, Hz — repeats get darker. */
  tone: number;
}

export const DELAY_PRESETS: DelayPreset[] = [
  { id: 'slapback', name: 'Slapback', sync: false, left: 0.085, right: 0.105, feedback: 0, cross: 0, inLeft: 1, inRight: 1, tone: 5200 },
  { id: 'stereo', name: 'Stereo', sync: false, left: 0.31, right: 0.43, feedback: 0.32, cross: 0, inLeft: 1, inRight: 1, tone: 4200 },
  { id: 'tempo', name: 'Tempo Delay', sync: true, left: 0.75, right: 0.75, feedback: 0.36, cross: 0, inLeft: 1, inRight: 1, tone: 3800 },
  { id: 'pingpong', name: 'Ping Pong', sync: true, left: 0.5, right: 0.5, feedback: 0, cross: 0.55, inLeft: 1, inRight: 0, tone: 4400 },
];

export const DEFAULT_DELAY_ID = 'tempo';
export const delayById = (id: string): DelayPreset => DELAY_PRESETS.find((p) => p.id === id) ?? DELAY_PRESETS[2];

/* ------------------------------------------------------------------ */
/* master equaliser                                                     */
/* ------------------------------------------------------------------ */

export interface EqBandDef {
  id: 'low' | 'lowMid' | 'highMid' | 'high';
  label: string;
  type: BiquadFilterType;
  /** Default frequency and the range the user may move it in, Hz. */
  freq: number;
  minFreq: number;
  maxFreq: number;
  q: number;
}

export const EQ_BANDS: EqBandDef[] = [
  { id: 'low', label: 'Low', type: 'lowshelf', freq: 110, minFreq: 40, maxFreq: 300, q: 0.7 },
  { id: 'lowMid', label: 'Low Mid', type: 'peaking', freq: 480, minFreq: 150, maxFreq: 1500, q: 0.9 },
  { id: 'highMid', label: 'High Mid', type: 'peaking', freq: 2400, minFreq: 800, maxFreq: 7000, q: 0.9 },
  { id: 'high', label: 'High', type: 'highshelf', freq: 8000, minFreq: 3000, maxFreq: 16000, q: 0.7 },
];

export const EQ_GAIN_RANGE = 12; // ± dB

export interface EqPreset {
  id: string;
  name: string;
  /** Gain per band in dB, in the order of EQ_BANDS. */
  gains: [number, number, number, number];
}

/** Ten factory curves; "user" is the eleventh, editable one. */
export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Flat', gains: [0, 0, 0, 0] },
  { id: 'bright', name: 'Bright', gains: [0, -1, 2, 4] },
  { id: 'warm', name: 'Warm', gains: [3, 1, -1, -3] },
  { id: 'bass', name: 'Bass Boost', gains: [6, 1, 0, 0] },
  { id: 'loudness', name: 'Loudness', gains: [5, -1, 0, 4] },
  { id: 'presence', name: 'Presence', gains: [-1, 0, 4, 2] },
  { id: 'mellow', name: 'Mellow', gains: [1, 2, -3, -5] },
  { id: 'stage', name: 'Stage', gains: [-3, -1, 2, 3] },
  { id: 'smallspk', name: 'Small Speakers', gains: [4, 3, 1, 2] },
  { id: 'midcut', name: 'Mid Scoop', gains: [3, -4, -2, 3] },
];

export const DEFAULT_EQ_ID = 'flat';
export const USER_EQ_ID = 'user';
export const eqById = (id: string): EqPreset | undefined => EQ_PRESETS.find((p) => p.id === id);

/* ------------------------------------------------------------------ */
/* insert DSP                                                           */
/* ------------------------------------------------------------------ */

export type DspType = 'compressor' | 'overdrive' | 'rotary' | 'phaser' | 'flanger' | 'tremolo' | 'autowah' | 'amp';

export const DSP_TYPE_LABEL: Record<DspType, string> = {
  compressor: 'Compressor',
  overdrive: 'Overdrive',
  rotary: 'Rotary Speaker',
  phaser: 'Phaser',
  flanger: 'Flanger',
  tremolo: 'Tremolo',
  autowah: 'Auto Wah',
  amp: 'Amp Simulation',
};

export interface DspPreset {
  id: string;
  /** Shown as a 1-based number on the display. */
  number: number;
  name: string;
  type: DspType;
  params: Record<string, number>;
  /** Output trim in dB that keeps the preset near the loudness of the unprocessed part. */
  trimDb: number;
}

type Seed = [name: string, params: Record<string, number>];

/**
 * The preset library. Each algorithm has a handful of parameters; a preset is
 * a named setting of them. Adding presets is just adding lines here — the
 * numbering and ids are generated.
 */
const LIBRARY: Record<DspType, Seed[]> = {
  compressor: [
    ['Gentle Glue', { threshold: -18, ratio: 2.5, attack: 0.012, release: 0.2, makeup: 3 }],
    ['Piano Even', { threshold: -22, ratio: 3, attack: 0.008, release: 0.25, makeup: 5 }],
    ['Punchy Keys', { threshold: -20, ratio: 4, attack: 0.03, release: 0.12, makeup: 5 }],
    ['Sustainer', { threshold: -30, ratio: 6, attack: 0.004, release: 0.4, makeup: 9 }],
    ['Bass Tight', { threshold: -24, ratio: 5, attack: 0.015, release: 0.15, makeup: 6 }],
    ['Limiter', { threshold: -12, ratio: 20, attack: 0.001, release: 0.08, makeup: 1 }],
    ['Soft Pad', { threshold: -26, ratio: 2, attack: 0.05, release: 0.5, makeup: 4 }],
  ],
  overdrive: [
    ['Warm Edge', { drive: 4, tone: 3600, level: 0.8 }],
    ['Crunch', { drive: 9, tone: 4200, level: 0.62 }],
    ['Tube Drive', { drive: 14, tone: 3400, level: 0.5 }],
    ['Hot Organ', { drive: 20, tone: 2900, level: 0.42 }],
    ['Fuzz Lead', { drive: 42, tone: 5200, level: 0.3 }],
    ['Dark Grind', { drive: 26, tone: 2000, level: 0.4 }],
    ['Bright Bite', { drive: 12, tone: 6500, level: 0.52 }],
  ],
  rotary: [
    ['Rotary Slow', { fast: 0, horn: 0.8, drum: 0.5, width: 0.7 }],
    ['Rotary Fast', { fast: 1, horn: 0.8, drum: 0.5, width: 0.7 }],
    ['Deep Rotary', { fast: 0, horn: 1, drum: 0.9, width: 1 }],
    ['Chorale', { fast: 0, horn: 0.55, drum: 0.3, width: 0.5 }],
    ['Tremolo Rotor', { fast: 1, horn: 1, drum: 0.8, width: 1 }],
    ['Narrow Cabinet', { fast: 0, horn: 0.7, drum: 0.4, width: 0.25 }],
  ],
  phaser: [
    ['Slow Phase', { rate: 0.25, depth: 0.8, feedback: 0.35, stages: 4, centre: 900 }],
    ['EP Phaser', { rate: 0.6, depth: 0.7, feedback: 0.5, stages: 4, centre: 1100 }],
    ['Jet Sweep', { rate: 0.12, depth: 1, feedback: 0.7, stages: 6, centre: 1400 }],
    ['Fast Swirl', { rate: 2.4, depth: 0.5, feedback: 0.4, stages: 4, centre: 1000 }],
    ['Deep Space', { rate: 0.08, depth: 1, feedback: 0.6, stages: 8, centre: 800 }],
    ['Soft Shimmer', { rate: 0.4, depth: 0.45, feedback: 0.2, stages: 6, centre: 1600 }],
    ['Vibe', { rate: 4.2, depth: 0.6, feedback: 0.25, stages: 4, centre: 700 }],
  ],
  flanger: [
    ['Light Flange', { rate: 0.3, depthMs: 1.2, delayMs: 2.5, feedback: 0.3 }],
    ['Jet Plane', { rate: 0.12, depthMs: 2.8, delayMs: 3.2, feedback: 0.75 }],
    ['Metallic', { rate: 0.5, depthMs: 0.9, delayMs: 1.4, feedback: 0.85 }],
    ['Slow Sweep', { rate: 0.07, depthMs: 3.2, delayMs: 4, feedback: 0.5 }],
    ['Fast Wobble', { rate: 3.2, depthMs: 0.7, delayMs: 2.2, feedback: 0.35 }],
    ['Through-Zero', { rate: 0.2, depthMs: 1.9, delayMs: 2, feedback: -0.6 }],
  ],
  tremolo: [
    ['Soft Tremolo', { rate: 4.2, depth: 0.35, pan: 0 }],
    ['Vintage EP', { rate: 5.6, depth: 0.6, pan: 0 }],
    ['Auto Pan', { rate: 0.8, depth: 0.85, pan: 1 }],
    ['Fast Pan', { rate: 3.4, depth: 0.7, pan: 1 }],
    ['Deep Throb', { rate: 3, depth: 0.9, pan: 0 }],
    ['Helicopter', { rate: 9.5, depth: 0.95, pan: 0 }],
    ['Slow Pulse', { rate: 1.6, depth: 0.5, pan: 0 }],
  ],
  autowah: [
    ['Funk Wah', { base: 350, range: 2600, q: 5, sensitivity: 3, attack: 0.012 }],
    ['Clavi Wah', { base: 500, range: 3200, q: 7, sensitivity: 4, attack: 0.006 }],
    ['Soft Wah', { base: 300, range: 1500, q: 3, sensitivity: 2, attack: 0.03 }],
    ['Quack', { base: 600, range: 3800, q: 9, sensitivity: 5, attack: 0.004 }],
    ['Bass Wah', { base: 160, range: 1200, q: 4, sensitivity: 3.5, attack: 0.015 }],
    ['Slow Opening', { base: 250, range: 2200, q: 4, sensitivity: 2.5, attack: 0.09 }],
  ],
  amp: [
    ['Clean Combo', { gain: 2, bass: 2, mid: 0, treble: 2, level: 0.8 }],
    ['Blues Amp', { gain: 8, bass: 3, mid: 2, treble: 1, level: 0.55 }],
    ['British Stack', { gain: 18, bass: 4, mid: 4, treble: 3, level: 0.4 }],
    ['Metal Stack', { gain: 40, bass: 6, mid: -4, treble: 5, level: 0.28 }],
    ['Jazz Amp', { gain: 1.5, bass: 4, mid: 1, treble: -4, level: 0.85 }],
    ['Small Practice', { gain: 6, bass: -3, mid: 4, treble: 0, level: 0.6 }],
    ['Bass Amp', { gain: 3, bass: 6, mid: 1, treble: -5, level: 0.75 }],
    ['EP Suitcase', { gain: 3.5, bass: 1, mid: 2, treble: 3, level: 0.72 }],
  ],
};

export const DSP_TYPES: DspType[] = ['compressor', 'overdrive', 'rotary', 'phaser', 'flanger', 'tremolo', 'autowah', 'amp'];

/**
 * Loudness trims. Switching an insert on should change the sound, not the
 * volume: every preset was measured against the bypassed part (a held organ
 * chord, RMS) and trimmed so that it lands within about 2 dB of it — the
 * drive and amp presets a little above, since distortion is expected to be
 * louder. Saturating effects depend on how hard they are driven, so this is a
 * balance for ordinary playing levels, not an exact match.
 */
const DSP_TRIM_DB: Record<string, number> = {
  'overdrive-1': -6, 'overdrive-2': -7, 'overdrive-3': -6.5, 'overdrive-4': -5.5, 'overdrive-5': -3.5, 'overdrive-6': -5.5, 'overdrive-7': -6.5,
  'amp-1': -3.5, 'amp-2': -8, 'amp-3': -8, 'amp-4': -5, 'amp-5': -3, 'amp-6': -7.5, 'amp-7': -6.5, 'amp-8': -6,
  'phaser-3': -6, 'phaser-5': -2, 'flanger-3': -7, 'flanger-4': -2,
  'autowah-1': 4.5, 'autowah-2': 4, 'autowah-3': 2, 'autowah-4': 4.5, 'autowah-5': 3, 'autowah-6': 4,
  'tremolo-6': 2,
};

export const DSP_PRESETS: DspPreset[] = DSP_TYPES.flatMap((type) =>
  LIBRARY[type].map(([name, params], i) => {
    const id = `${type}-${i + 1}`;
    return { id, number: 0, name, type, params, trimDb: DSP_TRIM_DB[id] ?? 0 };
  }),
).map((p, i) => ({ ...p, number: i + 1 }));

export const DEFAULT_DSP_ID = 'rotary-1';
export const dspById = (id: string): DspPreset | undefined => DSP_PRESETS.find((p) => p.id === id);
