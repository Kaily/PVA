/**
 * What an instrument hands to the voice engine for one note.
 *
 * Every sound source — the multi-layer grand piano, a SoundFont preset, a
 * physical-model tone — describes a note the same way: one or more *layers*,
 * each a buffer with a pitch ratio, a level, an envelope and optionally a
 * loop, a filter and a vibrato. The voice engine knows nothing about where
 * the buffers came from.
 */

export interface EnvelopeSpec {
  /** Seconds before the attack starts. */
  delay: number;
  /** Seconds of linear rise to full level. 0 = instant. */
  attack: number;
  /** Seconds at full level. Infinity = stay at full level (the sample decays by itself). */
  hold: number;
  /** Seconds the level would take to fall by 100 dB (SoundFont convention). */
  decay: number;
  /** Level the decay settles on, 0…1. */
  sustain: number;
  /** Release time constant in seconds (level falls to 37 % in this time). */
  releaseTau: number;
}

/**
 * A linear modulation envelope (SoundFont "modulation envelope"): 0 → 1 over
 * `attack`, stays for `hold`, falls to `sustain` and returns to 0 after the
 * key is released. It moves pitch and filter cut-off.
 */
export interface ModEnvelopeSpec {
  delay: number;
  attack: number;
  hold: number;
  /** Seconds a fall from 1 all the way to 0 would take; the fall stops at `sustain`. */
  decay: number;
  /** 0…1 */
  sustain: number;
  /** Seconds a fall from 1 to 0 takes after key-up. */
  release: number;
}

export interface FilterSpec {
  /** Low-pass cut-off in Hz. */
  frequency: number;
  /** Resonance in dB (0 = none). */
  resonanceDb: number;
  /** Cut-off sweep driven by `env`, in cents (0 = static filter). */
  envCents: number;
  /** Envelope of the sweep. */
  env: ModEnvelopeSpec | null;
}

export interface LfoSpec {
  delay: number;
  /** Hz */
  frequency: number;
  /** Peak pitch deviation in cents. */
  pitchCents: number;
  /** Peak level deviation in dB (tremolo). */
  volumeDb: number;
  /** Peak filter deviation in cents. */
  filterCents: number;
}

export interface LayerSpec {
  buffer: AudioBuffer;
  /** Playback rate relative to the buffer's own sample rate (pitch). */
  rate: number;
  /** Peak linear gain. */
  gain: number;
  /** −1 (left) … +1 (right). */
  pan: number;
  /** Where in the buffer playback starts, seconds. */
  offset: number;
  /** Sustain loop, in seconds of buffer time. */
  loop: { start: number; end: number; untilRelease: boolean } | null;
  env: EnvelopeSpec;
  filter: FilterSpec | null;
  lfo: LfoSpec | null;
  /** Pitch offset in cents, multiplied by the envelope (a scoop into the note, or a lasting offset). */
  pitchEnv: { cents: number; env: ModEnvelopeSpec } | null;
  /** Voices of the same part with the same non-zero class cut each other (open / closed hi-hat). */
  exclusiveClass: number;
}

export interface VoiceSpec {
  layers: LayerSpec[];
  /** Key-up does not stop the note (the undamped top register of a piano). */
  noDamper: boolean;
  /**
   * Rough time constant of the note's natural decay while held, seconds.
   * Infinity for sustained tones. Only used to rank voices for stealing.
   */
  decayTau: number;
  /** Mechanical key-release sound, played when the key lifts without the pedal. */
  keyNoise: { buffer: AudioBuffer; gain: number } | null;
}

/** An envelope that jumps to full level and stays there until the key is released. */
export const gateEnvelope = (releaseTau: number): EnvelopeSpec => ({
  delay: 0,
  attack: 0,
  hold: Infinity,
  decay: 0,
  sustain: 1,
  releaseTau,
});

/**
 * Level (0…1) of an envelope `t` seconds after note-on, while the key is held.
 * The voice engine uses it to start a release from exactly the current level.
 */
export function envelopeLevel(env: EnvelopeSpec, t: number): number {
  if (t < env.delay) return 0;
  let x = t - env.delay;
  if (x < env.attack) return env.attack > 0 ? x / env.attack : 1;
  x -= env.attack;
  if (x < env.hold) return 1;
  if (env.sustain >= 1) return 1;
  x -= env.hold;
  if (env.decay <= 0) return env.sustain;
  // Linear in dB: 100 dB per `decay` seconds, stopping at the sustain level.
  const level = Math.pow(10, (-5 * x) / env.decay);
  return level > env.sustain ? level : env.sustain;
}

/** Value (0…1) of a modulation envelope `t` seconds after note-on, while the key is held. */
export function modEnvelopeLevel(env: ModEnvelopeSpec, t: number): number {
  if (t < env.delay) return 0;
  let x = t - env.delay;
  if (x < env.attack) return env.attack > 0 ? x / env.attack : 1;
  x -= env.attack;
  if (x < env.hold || env.sustain >= 1) return 1;
  x -= env.hold;
  if (env.decay <= 0) return env.sustain;
  return Math.max(env.sustain, 1 - x / env.decay);
}

/** A pitch scoop: the note starts `cents` off and glides to pitch within `seconds`. */
export const pitchScoop = (cents: number, seconds: number): { cents: number; env: ModEnvelopeSpec } => ({
  cents,
  env: { delay: 0, attack: 0, hold: 0, decay: seconds, sustain: 0, release: 0.05 },
});

/** Seconds from the end of the hold stage until the decay reaches the sustain level. */
export function decayDuration(env: EnvelopeSpec): number {
  if (env.sustain >= 1 || env.decay <= 0) return 0;
  const db = env.sustain > 1e-5 ? -20 * Math.log10(env.sustain) : 100;
  return (env.decay * db) / 100;
}
