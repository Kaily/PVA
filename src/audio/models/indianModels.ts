import { pitchScoop, type EnvelopeSpec, type LayerSpec } from '../voiceTypes';
import {
  additiveLoop,
  estimateF0,
  fadeEdges,
  midiToHz,
  mixInto,
  modal,
  noiseBurst,
  normalize,
  peaking,
  pluckString,
  type Partial,
} from './dsp';

/**
 * Synthesis models of the Indian instrument bank.
 *
 * These tones are *computed*, not recorded: each model below renders the
 * notes of one instrument from a description of how that instrument makes
 * sound (a reed, a string on a jawari bridge, a struck bowl, a tabla head).
 * They are honest approximations — tuned and levelled by measurement, but
 * they have to be judged by ear, and a good set of recordings would beat
 * them. Sitar and Shehnai are not here: those use real recordings from the
 * SoundFont.
 */

export const MODEL_RATE = 44100;

export interface RenderedNote {
  data: Float32Array;
  /** Rate at which `data` is at the requested pitch. */
  sampleRate: number;
  /** Loop the whole buffer (sustained tones). */
  loop: boolean;
}

export interface ModelDef {
  id: string;
  /** Render every n-th semitone; notes in between are pitched from the nearest. */
  rootStep: number;
  /** Lowest velocity of each timbre layer, ascending, starting with 1. */
  layers: number[];
  /** Loudness law: level = velocityDb · log10(velocity / 127). */
  velocityDb: number;
  /** Each key is its own sound (drum kit): no pitch tracking, `render` gets the key. */
  kit?: boolean;
  render(note: number, layer: number): RenderedNote;
  envelope(note: number): EnvelopeSpec;
  /** Natural decay while held, for voice stealing. Infinity = sustained. */
  decayTau(note: number): number;
  extras?(note: number, velocity: number): Partial_<LayerSpec>;
}

type Partial_<T> = { [K in keyof T]?: T[K] };

/* ------------------------------------------------------------------ */
/* reeds: harmonium, shruti box, pungi                                  */
/* ------------------------------------------------------------------ */

interface ReedVoicing {
  /** Spectral slope: amplitude of harmonic k ∝ k^(−slope). */
  slope: number;
  /** Above this frequency the harmonics fall away quickly, Hz. */
  cutoff: number;
  /** Resonances of the body / air column: [Hz, width in octaves, gain in dB]. */
  formants: [number, number, number][];
  /** Reed ranks: pitch ratio, level, beats per loop (detune) for each. */
  ranks: { ratio: number; level: number; beats: number }[];
}

function reedPartials(freq: number, v: ReedVoicing): Partial[] {
  const out: Partial[] = [];
  for (const rank of v.ranks) {
    const f0 = freq * rank.ratio;
    for (let k = 1; k * f0 < 15000; k++) {
      const f = k * f0;
      let amp = Math.pow(k, -v.slope) / Math.sqrt(1 + Math.pow(f / v.cutoff, 6));
      for (const [centre, width, gain] of v.formants) {
        const d = Math.log2(f / centre) / width;
        amp *= Math.pow(10, (gain * Math.exp(-d * d)) / 20);
      }
      // a free reed is a little stronger on its odd harmonics
      if (k % 2 === 0) amp *= 0.82;
      out.push({ ratio: rank.ratio * k, amplitude: amp * rank.level, beats: rank.beats * k });
    }
  }
  return out;
}

function reedModel(id: string, voicing: ReedVoicing, env: EnvelopeSpec, extras?: ModelDef['extras']): ModelDef {
  return {
    id,
    rootStep: 2,
    layers: [1],
    velocityDb: 10, // bellows pressure, not the key, sets the loudness
    render(note) {
      // the lowest rank is an octave down → the loop must hold whole cycles of it too
      const lowest = Math.min(...voicing.ranks.map((r) => r.ratio));
      const tone = additiveLoop(midiToHz(note), reedPartials(midiToHz(note), voicing), {
        seed: 100 + note,
        cycleMultiple: Math.round(1 / lowest),
      });
      normalize(tone.data, 0.6);
      return { data: tone.data, sampleRate: tone.sampleRate, loop: true };
    },
    envelope: () => env,
    decayTau: () => Infinity,
    extras,
  };
}

const sustained = (attack: number, releaseTau: number): EnvelopeSpec => ({
  delay: 0,
  attack,
  hold: Infinity,
  decay: 0,
  sustain: 1,
  releaseTau,
});

const harmonium = reedModel(
  'harmonium',
  {
    slope: 0.85,
    cutoff: 3400,
    formants: [
      [750, 0.9, 5],
      [2500, 0.7, 4],
    ],
    ranks: [
      { ratio: 1, level: 1, beats: 0 }, // male reed
      { ratio: 1, level: 0.8, beats: 1 }, // second reed, a hair sharp → gentle beating
      { ratio: 0.5, level: 0.5, beats: 0 }, // bass reed, an octave below
    ],
  },
  sustained(0.04, 0.07),
);

const shrutiBox = reedModel(
  'shrutibox',
  {
    slope: 1.15,
    cutoff: 2300,
    formants: [[600, 1.1, 4]],
    ranks: [
      { ratio: 1, level: 1, beats: 0 },
      { ratio: 1, level: 0.9, beats: 2 },
    ],
  },
  sustained(0.28, 0.3),
);

const pungi = reedModel(
  'pungi',
  {
    slope: 0.45,
    cutoff: 5200,
    formants: [
      [1500, 0.5, 11],
      [2900, 0.45, 8],
      [450, 0.8, -6],
    ],
    ranks: [{ ratio: 1, level: 1, beats: 0 }],
  },
  sustained(0.03, 0.05),
  // the pipe never sits still: a quick shallow waver from the first moment
  () => ({ lfo: { delay: 0, frequency: 6.3, pitchCents: 9, volumeDb: 1.5, filterCents: 0 } }),
);

/* ------------------------------------------------------------------ */
/* bansuri                                                              */
/* ------------------------------------------------------------------ */

const bansuri: ModelDef = {
  id: 'bansuri',
  rootStep: 2,
  layers: [1, 88],
  velocityDb: 22,
  render(note, layer) {
    const freq = midiToHz(note);
    // Soft blowing: nearly a pure tone. Harder: the octave and twelfth come up.
    const levels = layer === 0 ? [1, 0.2, 0.07, 0.03, 0.012, 0.006] : [1, 0.42, 0.2, 0.09, 0.04, 0.02];
    const partials: Partial[] = levels.map((amplitude, i) => ({ ratio: i + 1, amplitude }));
    for (let k = 7; k * freq < 9000; k++) partials.push({ ratio: k, amplitude: 0.012 / k });
    const breath = layer === 0 ? 0.0011 : 0.0017;
    const tone = additiveLoop(freq, partials, {
      seed: 300 + note * 2 + layer,
      // breath: air noise centred a little above the note, fading towards the top
      noise: (hz) => {
        const d = Math.log2(hz / (freq * 2.5)) / 1.6;
        return breath * Math.exp(-d * d) * (hz < 12000 ? 1 : 0);
      },
    });
    normalize(tone.data, 0.6);
    return { data: tone.data, sampleRate: tone.sampleRate, loop: true };
  },
  envelope: () => sustained(0.055, 0.06),
  decayTau: () => Infinity,
  extras: () => ({
    // a little scoop into the note, then a vibrato that arrives late, as a player would do
    pitchEnv: pitchScoop(-28, 0.075),
    lfo: { delay: 0.42, frequency: 4.9, pitchCents: 13, volumeDb: 1.2, filterCents: 0 },
  }),
};

/* ------------------------------------------------------------------ */
/* plucked and hammered strings                                         */
/* ------------------------------------------------------------------ */

interface StringVoicing {
  seconds: number;
  /** T60 of the fundamental at C4; scaled down towards the treble. */
  t60: number;
  damping: number;
  position: number;
  /** Pluck brightness for the soft and the hard layer. */
  brightness: [number, number];
  jawari: number;
  /** Extra strings sounding with the played one: [semitone offset, cents, level]. */
  courses?: [number, number, number][];
  /** Sympathetic strings: [semitone offset, level] — long, quiet shimmer. */
  sympathetic?: [number, number][];
  /** Body resonances: [Hz, Q, dB]. */
  body?: [number, number, number][];
}

function stringModel(id: string, v: StringVoicing, releaseTau: number): ModelDef {
  return {
    id,
    rootStep: 3,
    layers: [1, 84],
    velocityDb: 30,
    render(note, layer) {
      const freq = midiToHz(note);
      const register = Math.pow(2, (60 - note) / 24); // lower strings ring longer
      const one = (semis: number, cents: number, t60: number, seed: number, jawari: number): Float32Array =>
        pluckString({
          freq: freq * Math.pow(2, semis / 12 + cents / 1200),
          sampleRate: MODEL_RATE,
          seconds: v.seconds * Math.min(1.5, Math.max(0.6, register)),
          t60: t60 * register,
          damping: v.damping,
          position: v.position,
          brightness: v.brightness[layer],
          jawari,
          seed,
        });
      const main = one(0, 0, v.t60, 500 + note * 3 + layer, v.jawari);
      for (const [i, [semis, cents, level]] of (v.courses ?? []).entries()) {
        mixInto(main, one(semis, cents, v.t60, 900 + note * 7 + i, v.jawari), level);
      }
      for (const [i, [semis, level]] of (v.sympathetic ?? []).entries()) {
        mixInto(main, one(semis, 0, v.t60 * 1.8, 1300 + note * 5 + i, 0), level, Math.floor(0.012 * MODEL_RATE));
      }
      for (const [hz, q, db] of v.body ?? []) peaking(main, MODEL_RATE, hz, q, db);
      fadeEdges(main, MODEL_RATE, 0.0005, 0.25);
      normalize(main, 0.7);
      // Loop filters and the jawari shift the pitch slightly: measure and correct it.
      const measured = estimateF0(main, MODEL_RATE, freq);
      return { data: main, sampleRate: (MODEL_RATE * freq) / measured, loop: false };
    },
    envelope: () => ({ delay: 0, attack: 0, hold: Infinity, decay: 0, sustain: 1, releaseTau }),
    decayTau: (note) => (v.t60 / 6.9) * Math.pow(2, (60 - note) / 24),
  };
}

const tanpura = stringModel(
  'tanpura',
  { seconds: 7.5, t60: 9, damping: 0.22, position: 0.14, brightness: [0.3, 0.5], jawari: 0.9 },
  0.5, // a tanpura string is left to ring
);
const veena = stringModel(
  'veena',
  {
    seconds: 5.5,
    t60: 6.5,
    damping: 0.36,
    position: 0.2,
    brightness: [0.45, 0.75],
    jawari: 0.4,
    body: [
      [220, 1.2, 4],
      [640, 1.5, 3],
    ],
  },
  0.18,
);
const sarod = stringModel(
  'sarod',
  {
    seconds: 3.6,
    t60: 3.4,
    damping: 0.28,
    position: 0.09,
    brightness: [0.6, 0.95],
    jawari: 0.12,
    sympathetic: [
      [12, 0.07],
      [7, 0.05],
    ],
    body: [
      [260, 1.4, 5],
      [520, 2, 3],
    ],
  },
  0.12,
);
const santoor = stringModel(
  'santoor',
  {
    seconds: 4.2,
    t60: 4.4,
    damping: 0.13,
    position: 0.11,
    brightness: [0.5, 0.85],
    jawari: 0,
    // three strings per note, never perfectly in tune with each other
    courses: [
      [0, 2.6, 0.9],
      [0, -2.2, 0.85],
    ],
  },
  0.35,
);
const swarmandal = stringModel(
  'swarmandal',
  { seconds: 5.5, t60: 6.5, damping: 0.1, position: 0.24, brightness: [0.55, 0.9], jawari: 0 },
  0.45,
);

/* ------------------------------------------------------------------ */
/* jal tarang — porcelain bowls tuned with water                        */
/* ------------------------------------------------------------------ */

const jalTarang: ModelDef = {
  id: 'jaltarang',
  rootStep: 2,
  layers: [1, 90],
  velocityDb: 28,
  render(note, layer) {
    const freq = midiToHz(note);
    const register = Math.pow(2, (72 - note) / 30);
    const bright = layer === 0 ? 0.6 : 1;
    const seconds = 2.6 * Math.min(1.4, register);
    const tone = modal(
      [
        // the water makes the pitch dip a little right after the strike
        { freq, amplitude: 1, t60: 1.9 * register, startRatio: 1.006, glide: 0.09 },
        { freq: freq * 2.76, amplitude: 0.42 * bright, t60: 0.85 * register },
        { freq: freq * 5.4, amplitude: 0.2 * bright, t60: 0.4 * register },
        { freq: freq * 8.93, amplitude: 0.09 * bright, t60: 0.22 * register },
      ],
      MODEL_RATE,
      seconds,
    );
    mixInto(tone, noiseBurst(MODEL_RATE, 0.02, { lowHz: 1800, highHz: 9000, decay: 0.003, seed: 700 + note }), 0.25 * bright);
    fadeEdges(tone, MODEL_RATE, 0.0003, 0.2);
    normalize(tone, 0.7);
    return { data: tone, sampleRate: MODEL_RATE, loop: false };
  },
  envelope: () => ({ delay: 0, attack: 0, hold: Infinity, decay: 0, sustain: 1, releaseTau: 0.5 }),
  decayTau: (note) => 0.28 * Math.pow(2, (72 - note) / 30),
  // water moving in the bowl: a slow shallow shimmer
  extras: () => ({ lfo: { delay: 0.05, frequency: 5.5, pitchCents: 0, volumeDb: 1.6, filterCents: 0 } }),
};

/* ------------------------------------------------------------------ */
/* tabla                                                                */
/* ------------------------------------------------------------------ */

/** Dayan (treble drum) tuned to C#4, bayan (bass drum) around F#2. */
const DAYAN_HZ = 277.18;
const BAYAN_HZ = 92.5;

/** The loaded head of a tabla has (nearly) harmonic overtones: 1 : 2 : 3 : 4 : 5. */
function dayan(freq: number, amps: number[], t60: number[], seconds: number, seed: number, strike: number): Float32Array {
  const tone = modal(
    amps.map((amplitude, i) => ({
      freq: freq * (i + 1),
      amplitude,
      t60: t60[i],
      // the head is tighter for an instant after it is struck
      startRatio: 1.012,
      glide: 0.03,
    })),
    MODEL_RATE,
    seconds,
  );
  mixInto(tone, noiseBurst(MODEL_RATE, 0.02, { lowHz: freq * 2, highHz: 7000, decay: 0.0035, seed }), strike);
  return tone;
}

function bayan(seconds: number, startRatio: number, glide: number, seed: number): Float32Array {
  const tone = modal(
    [
      { freq: BAYAN_HZ, amplitude: 1, t60: 1.15, startRatio, glide },
      { freq: BAYAN_HZ * 2, amplitude: 0.42, t60: 0.6, startRatio, glide },
      { freq: BAYAN_HZ * 3, amplitude: 0.16, t60: 0.35, startRatio, glide },
    ],
    MODEL_RATE,
    seconds,
  );
  mixInto(tone, noiseBurst(MODEL_RATE, 0.03, { lowHz: 60, highHz: 900, decay: 0.006, seed }), 0.5);
  return tone;
}

/** A closed (damped) stroke: mostly the slap of the fingers. */
function closed(lowHz: number, highHz: number, decay: number, thudHz: number, seed: number): Float32Array {
  const tone = noiseBurst(MODEL_RATE, 0.12, { lowHz, highHz, decay, seed });
  mixInto(tone, modal([{ freq: thudHz, amplitude: 0.8, t60: 0.07 }], MODEL_RATE, 0.1), 1);
  return tone;
}

export interface TablaStroke {
  bol: string;
  drum: 'dayan' | 'bayan' | 'both';
  render(): Float32Array;
}

const NA = (): Float32Array => dayan(DAYAN_HZ, [0.07, 1, 0.5, 0.2, 0.1], [0.25, 0.5, 0.32, 0.22, 0.16], 0.8, 11, 0.45);
const TIN = (): Float32Array => dayan(DAYAN_HZ, [0.7, 1, 0.3, 0.14, 0.05], [0.95, 0.85, 0.42, 0.3, 0.2], 1.3, 12, 0.3);
const TUN = (): Float32Array => dayan(DAYAN_HZ, [1, 0.35, 0.12, 0.05, 0.02], [1.5, 0.85, 0.42, 0.3, 0.2], 1.8, 13, 0.22);
const GE = (): Float32Array => bayan(1.4, 0.93, 0.05, 21);

/** Strokes by pitch class — the same twelve on every octave of the keyboard. */
export const TABLA_STROKES: TablaStroke[] = [
  { bol: 'Ge', drum: 'bayan', render: GE },
  { bol: 'Ge ↑', drum: 'bayan', render: () => bayan(1.4, 0.72, 0.55, 22) }, // palm slides forward: pitch rises
  { bol: 'Ke', drum: 'bayan', render: () => closed(80, 1100, 0.012, 110, 23) },
  { bol: 'Ge ↓', drum: 'bayan', render: () => bayan(1.4, 1.38, 0.5, 24) },
  { bol: 'Na', drum: 'dayan', render: NA },
  { bol: 'Tin', drum: 'dayan', render: TIN },
  { bol: 'Te', drum: 'dayan', render: () => closed(300, 2600, 0.01, 210, 25) },
  { bol: 'Tun', drum: 'dayan', render: TUN },
  { bol: 'Ti', drum: 'dayan', render: () => closed(500, 4200, 0.007, 260, 26) },
  {
    bol: 'Dha',
    drum: 'both',
    render: () => {
      const a = GE();
      mixInto(a, NA(), 0.9);
      return a;
    },
  },
  {
    bol: 'Dhin',
    drum: 'both',
    render: () => {
      const a = GE();
      mixInto(a, TIN(), 0.9);
      return a;
    },
  },
  { bol: 'Tak', drum: 'dayan', render: () => closed(1200, 8000, 0.005, 420, 27) },
];

const tabla: ModelDef = {
  id: 'tabla',
  rootStep: 1,
  layers: [1],
  velocityDb: 32,
  kit: true,
  render(note) {
    const stroke = TABLA_STROKES[((note % 12) + 12) % 12];
    const data = stroke.render();
    fadeEdges(data, MODEL_RATE, 0.0002, 0.08);
    normalize(data, 0.75);
    return { data, sampleRate: MODEL_RATE, loop: false };
  },
  envelope: () => ({ delay: 0, attack: 0, hold: Infinity, decay: 0, sustain: 1, releaseTau: 0.6 }),
  decayTau: () => 0.2,
  extras: (note) => {
    const drum = TABLA_STROKES[((note % 12) + 12) % 12].drum;
    return { pan: drum === 'bayan' ? -0.28 : drum === 'dayan' ? 0.28 : 0 };
  },
};

const tablaTarang: ModelDef = {
  id: 'tablatarang',
  rootStep: 2,
  layers: [1, 92],
  velocityDb: 30,
  render(note, layer) {
    const freq = midiToHz(note);
    const register = Math.pow(2, (60 - note) / 30);
    const amps = layer === 0 ? [1, 0.4, 0.15, 0.06, 0.03] : [1, 0.62, 0.34, 0.18, 0.1];
    const data = dayan(freq, amps, [1.3 * register, 0.8 * register, 0.45, 0.32, 0.22], 1.7 * Math.min(1.3, register), 40 + note, layer === 0 ? 0.18 : 0.32);
    fadeEdges(data, MODEL_RATE, 0.0002, 0.1);
    normalize(data, 0.72);
    return { data, sampleRate: MODEL_RATE, loop: false };
  },
  envelope: () => ({ delay: 0, attack: 0, hold: Infinity, decay: 0, sustain: 1, releaseTau: 0.4 }),
  decayTau: (note) => 0.2 * Math.pow(2, (60 - note) / 30),
};

export const MODELS: Record<string, ModelDef> = Object.fromEntries(
  [harmonium, shrutiBox, pungi, bansuri, tanpura, veena, sarod, santoor, swarmandal, jalTarang, tabla, tablaTarang].map((m) => [m.id, m]),
);
