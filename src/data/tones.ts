import { SF2_PRESETS } from './sf2Presets.generated';
import type { ToneCategory } from './instruments';

/**
 * The tone list — every sound the instrument can select.
 *
 * Three engines stand behind it:
 *   grand  the multi-layer Salamander concert grand (data/instruments.ts)
 *   sf2    a preset of the GeneralUser GS SoundFont (real recordings)
 *   model  a tone computed from a synthesis model at run time (audio/models)
 *
 * Only tones that really have a sound are playable. A tone the instrument
 * cannot produce yet is listed with `available: false` and a reason, so the
 * browser can show it as unavailable instead of quietly borrowing another
 * tone's sound (TASKS.md §12, §79).
 */

export type ToneEngine = 'grand' | 'sf2' | 'model';

export interface ToneDef {
  id: string;
  /** Number shown on the display, 1-based, in browser order. */
  number: number;
  name: string;
  category: ToneCategory;
  /** MIDI bank / program that select this tone. */
  bank: number;
  program: number;
  available: boolean;
  /** Shown in the browser when the tone is not available. */
  unavailableReason?: string;
  engine: ToneEngine;
  /** engine "sf2": preset address inside the SoundFont. */
  sf2?: { bank: number; program: number };
  /** engine "model": which synthesis model renders it. */
  model?: string;
  /** Sounding range (MIDI notes). */
  range: [number, number];
  /** Output trim of the tone, dB. */
  gainDb: number;
  /** Default effect sends when the tone is selected, 0–1. */
  reverbSend: number;
  chorusSend: number;
  /** What the modulation wheel does. */
  modulation: { rateHz: number; depthCents: number };
  /** Drum kits and effects are not transposed by the keyboard's transpose / octave settings. */
  fixedPitch: boolean;
  /** Extra words for the search box. */
  tags: string[];
}

export const CATEGORY_ORDER: ToneCategory[] = [
  'PIANO',
  'E.PIANO',
  'ORGAN',
  'STRINGS',
  'CHOIR',
  'BRASS',
  'WOODWIND',
  'GUITAR',
  'BASS',
  'SYNTH',
  'LEAD',
  'PAD',
  'MALLET',
  'PERCUSSION',
  'DRUM KIT',
  'WORLD',
  'INDIAN',
  'SFX',
];

/** Short legends for the category buttons on the panel. */
export const CATEGORY_LABEL: Record<ToneCategory, string> = {
  PIANO: 'Piano',
  'E.PIANO': 'E.Piano',
  ORGAN: 'Organ',
  STRINGS: 'Strings',
  CHOIR: 'Choir',
  BRASS: 'Brass',
  WOODWIND: 'Woodwind',
  GUITAR: 'Guitar',
  BASS: 'Bass',
  SYNTH: 'Synth',
  LEAD: 'Lead',
  PAD: 'Pad',
  MALLET: 'Mallet',
  PERCUSSION: 'Perc',
  'DRUM KIT': 'Drums',
  WORLD: 'World',
  INDIAN: 'Indian',
  SFX: 'SFX',
};

/* ------------------------------------------------------------------ */
/* SoundFont presets → categories                                       */
/* ------------------------------------------------------------------ */

const DRUM_BANK = 128;
/** MIDI bank select value (CC 0) that reaches the drum kits. */
export const MIDI_DRUM_BANK = 120;

function sf2Category(bank: number, program: number, name: string): ToneCategory {
  if (bank === DRUM_BANK) return 'DRUM KIT';
  if (/woodwind/i.test(name)) return 'WOODWIND';
  const p = program;
  if (p <= 3 || p === 6) return 'PIANO';
  if (p <= 7) return 'E.PIANO';
  if (p <= 15) return 'MALLET';
  if (p <= 23) return 'ORGAN';
  if (p <= 31) return 'GUITAR';
  if (p <= 39) return 'BASS';
  if (p === 47) return 'PERCUSSION';
  if (p <= 51) return 'STRINGS';
  if (p <= 54) return 'CHOIR';
  if (p === 55) return 'STRINGS';
  if (p <= 61) return 'BRASS';
  if (p <= 63) return 'SYNTH';
  if (p <= 79) return 'WOODWIND';
  if (p <= 87) return 'LEAD';
  if (p <= 95) return 'PAD';
  if (p <= 103) return 'SYNTH';
  if (p === 104 || p === 111) return 'INDIAN';
  if (p <= 111) return 'WORLD';
  if (p <= 119) return 'PERCUSSION';
  return 'SFX';
}

/** Display names that differ from the name stored in the SoundFont. */
const RENAME: Record<string, string> = {
  '0:0': 'Studio Grand',
  '0:1': 'Bright Grand',
  '0:2': 'Electric Grand',
  '0:3': 'Honky-Tonk',
  '0:111': 'Shehnai',
  '8:16': 'Detuned Tonewheel',
  '8:17': 'Detuned Perc. Organ',
  '11:16': 'Tonewheel (no vel.)',
  '11:17': 'Perc. Organ (no vel.)',
  '11:18': 'Rock Organ (no vel.)',
  '11:19': 'Pipe Organ (no vel.)',
  '11:20': 'Reed Organ (no vel.)',
  '11:6': 'Harpsichord (no vel.)',
  '12:6': 'Coupled Harpsi (no vel.)',
  '12:16': 'Detuned Tonewheel (no vel.)',
  '12:17': 'Detuned Perc. (no vel.)',
  '12:19': 'Pipe Organ 2 (no vel.)',
  '11:29': 'Wah Guitar',
};

/**
 * Level trims. The SoundFont's presets are balanced against each other by its
 * author; one trim puts all of them next to the concert grand, and a few
 * presets that measure much hotter than the rest get an extra cut.
 * (Measured: 100 ms RMS and peak of a note at velocity 100, effects off.)
 */
const SF2_GAIN_DB = -1;
const SF2_DRUM_GAIN_DB = -3;
const SF2_EXTRA_DB: Record<string, number> = {
  '8:38': -10, // Acid Bass
  '1:38': -3, // Synth Bass 101
  '0:87': -3, // Bass & Lead
  '12:127': -8, // Shooting Star
  '128:16': -2, // Power Kit
};

/** Reverb / chorus a tone gets by default, by category. */
const SENDS: Record<ToneCategory, [reverb: number, chorus: number]> = {
  PIANO: [0.36, 0],
  'E.PIANO': [0.3, 0.25],
  ORGAN: [0.28, 0.1],
  STRINGS: [0.45, 0.1],
  CHOIR: [0.5, 0.1],
  BRASS: [0.38, 0],
  WOODWIND: [0.4, 0],
  GUITAR: [0.3, 0.12],
  BASS: [0.1, 0],
  SYNTH: [0.35, 0.2],
  LEAD: [0.3, 0.15],
  PAD: [0.5, 0.3],
  MALLET: [0.4, 0],
  PERCUSSION: [0.3, 0],
  'DRUM KIT': [0.18, 0],
  WORLD: [0.35, 0],
  INDIAN: [0.38, 0],
  SFX: [0.25, 0],
};

/* ------------------------------------------------------------------ */
/* model tones (Indian bank)                                            */
/* ------------------------------------------------------------------ */

interface ModelToneSeed {
  id: string;
  name: string;
  model?: string;
  range?: [number, number];
  gainDb?: number;
  fixedPitch?: boolean;
  tags: string[];
  unavailableReason?: string;
}

/** MIDI bank used for the model tones. */
export const MODEL_BANK = 50;

const INDIAN_MODELS: ModelToneSeed[] = [
  { id: 'harmonium', name: 'Harmonium', model: 'harmonium', range: [36, 96], tags: ['reed', 'bhajan', 'peti'] },
  { id: 'shruti-box', name: 'Shruti Box', model: 'shrutibox', range: [36, 84], gainDb: -6, tags: ['drone', 'reed', 'sur peti'] },
  { id: 'tanpura', name: 'Tanpura', model: 'tanpura', range: [33, 72], tags: ['drone', 'tambura', 'string'] },
  { id: 'veena', name: 'Veena', model: 'veena', range: [36, 84], tags: ['saraswati veena', 'plucked', 'carnatic'] },
  { id: 'sarod', name: 'Sarod', model: 'sarod', range: [36, 84], tags: ['plucked', 'hindustani'] },
  { id: 'santoor', name: 'Santoor', model: 'santoor', range: [48, 96], tags: ['hammered', 'dulcimer', 'kashmir'] },
  { id: 'swarmandal', name: 'Swarmandal', model: 'swarmandal', range: [48, 96], tags: ['harp', 'zither', 'plucked'] },
  { id: 'bansuri', name: 'Bansuri', model: 'bansuri', range: [55, 96], gainDb: -6, tags: ['flute', 'bamboo', 'venu'] },
  { id: 'pungi', name: 'Pungi', model: 'pungi', range: [55, 91], gainDb: -5, tags: ['been', 'reed', 'snake charmer'] },
  { id: 'jal-tarang', name: 'Jal Tarang', model: 'jaltarang', range: [55, 96], gainDb: -5, tags: ['bowls', 'water', 'mallet'] },
  { id: 'tabla', name: 'Tabla', model: 'tabla', range: [36, 96], gainDb: -5, fixedPitch: true, tags: ['percussion', 'dayan', 'bayan', 'kit'] },
  { id: 'tabla-tarang', name: 'Tabla Tarang', model: 'tablatarang', range: [48, 91], tags: ['tuned tabla', 'percussion'] },
  {
    id: 'sarangi',
    name: 'Sarangi',
    tags: ['bowed'],
    unavailableReason: 'Needs recordings: a bowed instrument cannot be modelled convincingly here.',
  },
  {
    id: 'esraj',
    name: 'Esraj',
    tags: ['bowed', 'dilruba'],
    unavailableReason: 'Needs recordings: a bowed instrument cannot be modelled convincingly here.',
  },
];

/* ------------------------------------------------------------------ */
/* build                                                                */
/* ------------------------------------------------------------------ */

type Seed = Omit<ToneDef, 'number'>;

function build(): ToneDef[] {
  const seeds: Seed[] = [];

  seeds.push({
    id: 'concert-grand',
    name: 'Concert Grand',
    category: 'PIANO',
    bank: 0,
    program: 0,
    available: true,
    engine: 'grand',
    range: [21, 108],
    gainDb: -5,
    reverbSend: 0.36,
    chorusSend: 0,
    modulation: { rateHz: 5.3, depthCents: 28 },
    fixedPitch: false,
    tags: ['grand', 'acoustic', 'piano', 'concert', 'salamander'],
  });

  for (const [bank, program, rawName] of SF2_PRESETS) {
    if (bank === 120) continue; // the same drum kits as bank 128
    const category = sf2Category(bank, program, rawName);
    const drums = bank === DRUM_BANK;
    const [reverbSend, chorusSend] = SENDS[category];
    seeds.push({
      id: `sf2-${bank}-${program}`,
      name: RENAME[`${bank}:${program}`] ?? (drums ? `${rawName} Kit` : rawName),
      category,
      // MIDI: the SoundFont's "Grand Piano" would collide with the Concert Grand on 0/0;
      // drum kits answer on bank 120 (the GM2 drum bank — a bank select byte cannot say 128).
      bank: drums ? MIDI_DRUM_BANK : bank === 0 && program === 0 ? 2 : bank,
      program,
      available: true,
      engine: 'sf2',
      sf2: { bank, program },
      range: [0, 127],
      gainDb: (drums ? SF2_DRUM_GAIN_DB : SF2_GAIN_DB) + (SF2_EXTRA_DB[`${bank}:${program}`] ?? 0),
      reverbSend,
      chorusSend,
      modulation: { rateHz: 5.5, depthCents: 30 },
      fixedPitch: drums || category === 'SFX',
      tags: [rawName.toLowerCase(), category.toLowerCase()],
    });
  }

  INDIAN_MODELS.forEach((m, i) => {
    const [reverbSend, chorusSend] = SENDS.INDIAN;
    seeds.push({
      id: m.id,
      name: m.name,
      category: 'INDIAN',
      bank: MODEL_BANK,
      program: i,
      available: Boolean(m.model),
      unavailableReason: m.unavailableReason,
      engine: 'model',
      model: m.model,
      range: m.range ?? [36, 96],
      gainDb: m.gainDb ?? -4,
      reverbSend,
      chorusSend,
      modulation: { rateHz: 5.2, depthCents: 25 },
      fixedPitch: m.fixedPitch ?? false,
      tags: m.tags,
    });
  });

  // Browser order: by category; inside a category the grand first, then the
  // SoundFont presets by program and bank, then the models as listed.
  const order = (s: Seed): number => {
    const cat = CATEGORY_ORDER.indexOf(s.category) * 1e7;
    if (s.engine === 'grand') return cat;
    if (s.engine === 'sf2') return cat + 1e5 + (s.sf2!.program + 1) * 300 + s.sf2!.bank;
    return cat + 5e6 + s.program;
  };
  seeds.sort((a, b) => order(a) - order(b));
  return seeds.map((s, i) => ({ ...s, number: i + 1 }));
}

export const TONES: readonly ToneDef[] = build();

const BY_ID = new Map(TONES.map((t) => [t.id, t]));

export const toneById = (id: string): ToneDef | undefined => BY_ID.get(id);

export const DEFAULT_TONE_ID = 'concert-grand';
/** Factory tones of the second layer and the lower split zone. */
export const DEFAULT_LAYER_TONE_ID = 'sf2-0-49'; // Slow Strings
export const DEFAULT_LOWER_TONE_ID = 'sf2-0-32'; // Acoustic Bass

export function tonesInCategory(category: ToneCategory): ToneDef[] {
  return TONES.filter((t) => t.category === category);
}

/** Tone selected by a MIDI bank + program pair, falling back to bank 0. */
export function toneByProgram(bank: number, program: number): ToneDef | undefined {
  return (
    TONES.find((t) => t.available && t.bank === bank && t.program === program) ??
    TONES.find((t) => t.available && t.bank === 0 && t.program === program && t.engine !== 'model')
  );
}

/**
 * Instant search over number, name, category and tags.
 * Every word of the query must match somewhere. A number matches tone
 * numbers, the exact one first — typing "42" and pressing Enter selects tone 042.
 */
export function searchTones(query: string): ToneDef[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits = TONES.filter((t) => {
    const number = String(t.number).padStart(3, '0');
    const hay = `${number} ${t.name.toLowerCase()} ${t.category.toLowerCase()} ${t.tags.join(' ')}`;
    return words.every((w) => (/^\d+$/.test(w) ? number.includes(w) || t.number === Number(w) : hay.includes(w)));
  });
  if (words.length === 1 && /^\d+$/.test(words[0])) {
    const exact = Number(words[0]);
    hits.sort((x, y) => Number(y.number === exact) - Number(x.number === exact) || x.number - y.number);
  }
  return hits;
}
