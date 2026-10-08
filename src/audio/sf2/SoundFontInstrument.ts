import { clamp, dbToGain } from '../../core/math';
import type { ToneDef } from '../../data/tones';
import type { PlayableInstrument } from '../InstrumentManager';
import type { LayerSpec, ModEnvelopeSpec, VoiceSpec } from '../voiceTypes';
import {
  GEN,
  GEN_COUNT,
  SoundFont,
  absoluteCentsToHz,
  applyModulators,
  centibelsToGain,
  timecentsToSeconds,
  type Region,
} from './SoundFont';

/**
 * SoundFontBank — a loaded SoundFont plus the AudioBuffers made from its
 * samples. Samples are converted from 16-bit to an AudioBuffer the first time
 * a note needs them and then cached; a preset that is never played costs no
 * memory beyond the file itself.
 */
export class SoundFontBank {
  private readonly buffers = new Map<number, AudioBuffer>();
  private bytes = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    readonly font: SoundFont,
  ) {}

  buffer(sampleIndex: number): AudioBuffer | null {
    const cached = this.buffers.get(sampleIndex);
    if (cached) return cached;
    const s = this.font.samples[sampleIndex];
    if (!s) return null;
    const pool = this.font.sampleData;
    const start = Math.min(s.start, pool.length);
    const end = Math.min(Math.max(s.end, s.loopEnd), pool.length);
    const frames = end - start;
    if (frames < 8) return null;
    // Each sample keeps its own rate; the browser resamples on playback.
    const rate = clamp(s.sampleRate || 44100, 3000, 192000);
    let buffer: AudioBuffer;
    try {
      buffer = this.ctx.createBuffer(1, frames, rate);
    } catch {
      return null; // a rate this browser cannot represent
    }
    const out = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) out[i] = pool[start + i] / 32768;
    this.buffers.set(sampleIndex, buffer);
    this.bytes += frames * 4;
    return buffer;
  }

  /** Convert every sample a preset can use (called in the background after a tone is selected). */
  async warm(presetIndex: number, keyLo: number, keyHi: number): Promise<void> {
    const seen = new Set<number>();
    let n = 0;
    for (const r of this.font.regions(presetIndex)) {
      if (r.keyHi < keyLo || r.keyLo > keyHi || seen.has(r.sample)) continue;
      seen.add(r.sample);
      this.buffer(r.sample);
      if (++n % 6 === 0) await new Promise((resolve) => setTimeout(resolve, 0)); // stay out of the way of playing
    }
  }

  get megabytes(): number {
    return this.bytes / (1024 * 1024);
  }

  get bufferCount(): number {
    return this.buffers.size;
  }
}

/** Shortest release the engine uses, so nothing ever stops with a click. */
const MIN_RELEASE_TAU = 0.006;

export class SoundFontInstrument implements PlayableInstrument {
  private readonly regions: Region[];
  private readonly gens = new Float64Array(GEN_COUNT);
  private readonly trim: number;

  constructor(
    readonly def: ToneDef,
    private readonly bank: SoundFontBank,
    readonly presetIndex: number,
  ) {
    this.regions = bank.font.regions(presetIndex);
    this.trim = dbToGain(def.gainDb);
  }

  pick(note: number, velocity: number): VoiceSpec | null {
    if (note < 0 || note > 127) return null;
    const vel = clamp(Math.round(velocity), 1, 127);
    const layers: LayerSpec[] = [];
    let sustained = false;
    let longest = 0;

    const regions = this.regions;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      if (note < r.keyLo || note > r.keyHi || vel < r.velLo || vel > r.velHi) continue;
      const layer = this.layer(r, note, vel);
      if (!layer) continue;
      layers.push(layer);
      if (layer.loop && layer.env.sustain > 0.05) sustained = true;
      const seconds = layer.buffer.duration / layer.rate;
      if (seconds > longest) longest = seconds;
    }
    if (layers.length === 0) return null;
    return {
      layers,
      noDamper: false,
      decayTau: sustained ? Infinity : Math.max(0.15, longest / 3),
      keyNoise: null,
    };
  }

  private layer(r: Region, note: number, vel: number): LayerSpec | null {
    const sample = this.bank.font.samples[r.sample];
    const buffer = this.bank.buffer(r.sample);
    if (!buffer) return null;

    // A zone may force the key and / or velocity (typical for drum kits).
    const forcedKey = r.gens[GEN.keynum];
    const forcedVel = r.gens[GEN.velocity];
    const key = forcedKey >= 0 && forcedKey <= 127 ? forcedKey : note;
    const velocity = forcedVel > 0 && forcedVel <= 127 ? forcedVel : vel;

    const g = this.gens;
    applyModulators(r, { key, velocity }, g);
    const sr = buffer.sampleRate;

    // --- pitch -------------------------------------------------------------
    const rootGen = g[GEN.overridingRootKey];
    const root = rootGen >= 0 && rootGen <= 127 ? rootGen : sample.originalPitch <= 127 ? sample.originalPitch : 60;
    const cents = (key - root) * g[GEN.scaleTuning] + g[GEN.coarseTune] * 100 + g[GEN.fineTune] + sample.pitchCorrection;
    const rate = Math.pow(2, cents / 1200);

    // --- level, pan ------------------------------------------------------------
    const gain = centibelsToGain(clamp(g[GEN.initialAttenuation], 0, 1440)) * this.trim;
    if (gain < 1e-5) return null;
    const pan = clamp(g[GEN.pan], -500, 500) / 500;

    // --- sample start and loop ----------------------------------------------------
    const frames = buffer.length;
    const startFrames = clamp(g[GEN.startAddrsOffset] + g[GEN.startAddrsCoarseOffset] * 32768, 0, frames - 1);
    let loop: LayerSpec['loop'] = null;
    const mode = r.gens[GEN.sampleModes] & 3;
    if (mode === 1 || mode === 3) {
      const ls = sample.loopStart - sample.start + g[GEN.startloopAddrsOffset] + g[GEN.startloopAddrsCoarseOffset] * 32768;
      const le = sample.loopEnd - sample.start + g[GEN.endloopAddrsOffset] + g[GEN.endloopAddrsCoarseOffset] * 32768;
      if (ls >= 0 && le > ls + 4 && le <= frames) loop = { start: ls / sr, end: le / sr, untilRelease: mode === 3 };
    }

    // --- volume envelope --------------------------------------------------------------
    const keyScale = (cents100: number): number => Math.pow(2, (cents100 * (60 - key)) / 1200);
    const sustainCb = clamp(g[GEN.sustainVolEnv], 0, 1440);
    const release = timecentsToSeconds(g[GEN.releaseVolEnv]);
    const env = {
      delay: timecentsToSeconds(g[GEN.delayVolEnv]),
      attack: timecentsToSeconds(g[GEN.attackVolEnv]),
      hold: timecentsToSeconds(g[GEN.holdVolEnv]) * keyScale(g[GEN.keynumToVolEnvHold]),
      decay: timecentsToSeconds(g[GEN.decayVolEnv]) * keyScale(g[GEN.keynumToVolEnvDecay]),
      sustain: sustainCb >= 1000 ? 0 : centibelsToGain(sustainCb),
      // SF2 release = time to fall 100 dB; as an exponential that is time / ln(10^5).
      releaseTau: Math.max(MIN_RELEASE_TAU, release / 11.51),
    };

    // --- modulation envelope (moves filter and pitch) -------------------------------------
    const envCents = g[GEN.modEnvToFilterFc];
    const envPitch = g[GEN.modEnvToPitch];
    const modEnv: ModEnvelopeSpec | null =
      envCents !== 0 || envPitch !== 0
        ? {
            delay: timecentsToSeconds(g[GEN.delayModEnv]),
            attack: timecentsToSeconds(g[GEN.attackModEnv]),
            hold: timecentsToSeconds(g[GEN.holdModEnv]) * keyScale(g[GEN.keynumToModEnvHold]),
            decay: timecentsToSeconds(g[GEN.decayModEnv]) * keyScale(g[GEN.keynumToModEnvDecay]),
            sustain: 1 - clamp(g[GEN.sustainModEnv], 0, 1000) / 1000,
            release: timecentsToSeconds(g[GEN.releaseModEnv]),
          }
        : null;

    // --- filter --------------------------------------------------------------------------
    let filter: LayerSpec['filter'] = null;
    const fcCents = clamp(g[GEN.initialFilterFc], 1500, 13500);
    if (fcCents < 13300 || envCents < 0) {
      filter = {
        frequency: Math.min(absoluteCentsToHz(fcCents), 20000),
        resonanceDb: clamp(g[GEN.initialFilterQ], 0, 960) / 10,
        envCents,
        env: envCents !== 0 ? modEnv : null,
      };
    }

    // --- LFO (one per layer: the modulation LFO if it is used, else the vibrato LFO) -------
    let lfo: LayerSpec['lfo'] = null;
    const modPitch = g[GEN.modLfoToPitch];
    const modFilter = filter ? g[GEN.modLfoToFilterFc] : 0;
    const modVolume = g[GEN.modLfoToVolume] / 10;
    const vibPitch = g[GEN.vibLfoToPitch];
    if (modPitch || modFilter || modVolume) {
      lfo = {
        delay: timecentsToSeconds(g[GEN.delayModLFO]),
        frequency: clamp(absoluteCentsToHz(g[GEN.freqModLFO]), 0.05, 40),
        pitchCents: modPitch + vibPitch,
        volumeDb: modVolume,
        filterCents: modFilter,
      };
    } else if (vibPitch) {
      lfo = {
        delay: timecentsToSeconds(g[GEN.delayVibLFO]),
        frequency: clamp(absoluteCentsToHz(g[GEN.freqVibLFO]), 0.05, 40),
        pitchCents: vibPitch,
        volumeDb: 0,
        filterCents: 0,
      };
    }

    // --- pitch moved by the modulation envelope (a scoop, a blip or a lasting offset) -------
    const pitchEnv: LayerSpec['pitchEnv'] = envPitch !== 0 && modEnv ? { cents: envPitch, env: modEnv } : null;

    return {
      buffer,
      rate,
      gain,
      pan,
      offset: startFrames / sr,
      loop,
      env,
      filter,
      lfo,
      pitchEnv,
      exclusiveClass: r.gens[GEN.exclusiveClass] > 0 ? r.gens[GEN.exclusiveClass] : 0,
    };
  }
}
