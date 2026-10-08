/**
 * Instrument metadata. Pure data — no audio or UI code in here.
 *
 * Adding a tone later means adding a SampleSetDef (or a synthesis definition)
 * and an InstrumentDef; the engine and browser read everything from these
 * tables. A tone slot without real sound assets must use `available: false`
 * so the UI can mark it as unavailable instead of silently re-using another
 * sound (TASKS.md §12, §79).
 */

export type ToneCategory =
  | 'PIANO'
  | 'E.PIANO'
  | 'ORGAN'
  | 'STRINGS'
  | 'CHOIR'
  | 'BRASS'
  | 'WOODWIND'
  | 'GUITAR'
  | 'BASS'
  | 'SYNTH'
  | 'LEAD'
  | 'PAD'
  | 'MALLET'
  | 'PERCUSSION'
  | 'DRUM KIT'
  | 'WORLD'
  | 'INDIAN'
  | 'SFX';

export interface VelocityLayerDef {
  /** Folder / identifier of the layer, e.g. "v07". */
  id: string;
  /**
   * Measured loudness of this layer relative to the loudest one, in dB
   * (mean RMS of the first 400 ms across the keyboard). The voice engine uses
   * it to keep loudness continuous across layer switches.
   */
  levelDb: number;
}

export interface ReleaseSamplesDef {
  /** e.g. "rel/{note}.mp3" — {note} is the zero-padded MIDI number. */
  pattern: string;
  low: number;
  high: number;
  /** Playback level. These files are normalised, so this is a large cut. */
  gainDb: number;
}

export interface SampleSetDef {
  id: string;
  name: string;
  /** Relative to the app base URL. */
  baseUrl: string;
  /** e.g. "{layer}/{note}.mp3". */
  pattern: string;
  /** MIDI notes that have a recorded sample; other notes are pitched from the nearest. */
  roots: number[];
  /** Ordered from softest to loudest. */
  layers: VelocityLayerDef[];
  release?: ReleaseSamplesDef;
  /**
   * Even out the stereo image. Close-miked piano sets often jump from far
   * left to far right between neighbouring recordings; when this is set, each
   * recording's left/right balance is measured after decoding and corrected
   * to a smooth player's-seat image: `lowDb` at the bottom note, `highDb` at
   * the top (right minus left, in dB). Total loudness is preserved.
   */
  stereoBalance?: { lowDb: number; highDb: number };
  attribution: { title: string; author: string; license: string; url: string };
}

export interface InstrumentDef {
  id: string;
  /** Tone number shown on the display (1-based). */
  number: number;
  name: string;
  category: ToneCategory;
  bank: number;
  program: number;
  available: boolean;
  sampleSet: string;
  /** Playable range (sounding MIDI notes). */
  range: [low: number, high: number];
  /** Output trim for the whole instrument. */
  gainDb: number;
  pan: number;
  /** Loudness law: level(dB) = velocityDb * log10(velocity / 127). 40 = square law. */
  velocityDb: number;
  /** Quietest level a velocity can map to (dB). */
  velocityFloorDb: number;
  /** Damper release time constants (seconds), interpolated across the range. */
  release: { lowTau: number; highTau: number; undampedFrom: number };
  /** Rough natural decay time constants, used only to rank voices for stealing. */
  decay: { lowTau: number; highTau: number };
  modulation: { target: 'vibrato'; rateHz: number; depthCents: number };
  effects: { reverbSend: number };
  tags: string[];
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let n = from; n <= to; n += step) out.push(n);
  return out;
};

export const SAMPLE_SETS: Record<string, SampleSetDef> = {
  'salamander-grand': {
    id: 'salamander-grand',
    name: 'Salamander Grand Piano V3',
    baseUrl: 'samples/salamander-grand/',
    pattern: '{layer}/{note}.mp3',
    roots: range(21, 108, 3), // A0, C1, D#1, F#1 … C8
    layers: [
      { id: 'v01', levelDb: -22.0 },
      { id: 'v04', levelDb: -13.1 },
      { id: 'v07', levelDb: -9.8 },
      { id: 'v10', levelDb: -7.2 },
      { id: 'v13', levelDb: -4.1 },
      { id: 'v16', levelDb: 0 },
    ],
    release: { pattern: 'rel/{note}.mp3', low: 21, high: 108, gainDb: -30 },
    // Measured: this set swings between −7 dB and +13 dB (R−L) from one recording to the next.
    stereoBalance: { lowDb: -2.5, highDb: 2.5 },
    attribution: {
      title: 'Salamander Grand Piano V3 (Yamaha C5)',
      author: 'Alexander Holm',
      license: 'CC BY 3.0',
      url: 'https://archive.org/details/SalamanderGrandPianoV3',
    },
  },
};

export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: 'concert-grand',
    number: 1,
    name: 'Concert Grand',
    category: 'PIANO',
    bank: 0,
    program: 0,
    available: true,
    sampleSet: 'salamander-grand',
    range: [21, 108],
    gainDb: -5,
    pan: 0,
    velocityDb: 36,
    velocityFloorDb: -46,
    release: { lowTau: 0.2, highTau: 0.06, undampedFrom: 90 },
    decay: { lowTau: 9, highTau: 0.7 },
    modulation: { target: 'vibrato', rateHz: 5.3, depthCents: 28 },
    effects: { reverbSend: 0.36 },
    tags: ['grand', 'acoustic', 'piano', 'concert'],
  },
];

export const DEFAULT_INSTRUMENT_ID = 'concert-grand';

export const instrumentById = (id: string): InstrumentDef | undefined => INSTRUMENTS.find((i) => i.id === id);

/* ------------------------------------------------------------------ */
/* Sample quality tiers                                                 */
/* ------------------------------------------------------------------ */

export type SampleQuality = 'light' | 'standard' | 'full';

export interface QualityTier {
  id: SampleQuality;
  label: string;
  /** Velocity layers decoded in this tier (must exist in the sample set). */
  layers: string[];
  /** Layer loaded first so the instrument becomes playable quickly. */
  coreLayer: string;
  /**
   * Shorten each sample: cut once it has decayed `db` below its peak, never
   * keep more than `maxSec`, and fade out over `fadeSec`. null keeps the full
   * recording (up to 25 s per note).
   * Decoded audio is uncompressed stereo float, so this is what decides how
   * much memory the piano needs.
   */
  tail: { db: number; fadeSec: number; maxSec: number } | null;
  /** Rough decoded size for the 61-key range, shown in Settings. */
  approxMb: number;
}

export const QUALITY_TIERS: Record<SampleQuality, QualityTier> = {
  light: {
    id: 'light',
    label: 'Light',
    layers: ['v04', 'v10', 'v16'],
    coreLayer: 'v10',
    tail: { db: -34, fadeSec: 1.5, maxSec: 6 },
    approxMb: 130,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    layers: ['v01', 'v07', 'v13', 'v16'],
    coreLayer: 'v07',
    tail: { db: -40, fadeSec: 2.2, maxSec: 10 },
    approxMb: 260,
  },
  full: {
    id: 'full',
    label: 'Full length',
    layers: ['v01', 'v04', 'v07', 'v10', 'v13', 'v16'],
    coreLayer: 'v07',
    tail: null,
    approxMb: 660,
  },
};
