import { Emitter } from '../core/Emitter';
import { pad } from '../core/math';
import type { SampleSetDef } from '../data/instruments';

/**
 * SampleManager — the single place that loads, decodes, trims, caches and
 * looks up sample data. Instruments never fetch or decode audio themselves.
 *
 *  • loading / decoding   fetch → decodeAudioData, limited concurrency
 *  • trimming             leading silence removed (MP3 padding + pre-attack
 *                         noise would otherwise add 10–60 ms of latency), and
 *                         optionally the inaudible tail (decoded audio is
 *                         uncompressed, so tails dominate memory use)
 *  • caching              one AudioBuffer per (set, layer, root); requests for
 *                         something already loaded or in flight are shared
 *  • note mapping         any MIDI note → nearest recorded root
 *  • velocity mapping     caller asks for a layer; nearest loaded layer wins
 *  • fallback mapping     a missing/failed file falls back to a neighbouring
 *                         layer, then to a neighbouring root — one bad file
 *                         can never silence a key
 *  • memory cleanup       unload(setId) drops every buffer of a set
 */

export interface SampleHit {
  buffer: AudioBuffer;
  /** MIDI note the buffer was recorded at. */
  root: number;
  /** Index into the set's `layers` array of the layer actually used. */
  layerIndex: number;
  /** Measured loudness of the attack (linear RMS of the first 400 ms). */
  level: number;
}

export interface TailTrim {
  /** Cut once the sound has decayed this far below its peak (dB, negative). */
  db: number;
  /** Length of the fade-out applied at the cut. */
  fadeSec: number;
  /** Hard upper limit for the kept length, seconds. */
  maxSec: number;
}

export interface LoadRequest {
  setId: string;
  layers: string[];
  roots: number[];
  tail: TailTrim | null;
}

export interface LoadProgress {
  loaded: number;
  total: number;
  failed: number;
}

interface SetState {
  def: SampleSetDef;
  /** layers[layerIndex] → Map<root, buffer> */
  layers: Map<number, AudioBuffer>[];
  release: Map<number, AudioBuffer>;
  /** nearestRoots[midi] → root notes ordered by distance. */
  nearestRoots: number[][];
}

type Events = {
  /** A file could not be fetched or decoded. Playback continues with a fallback. */
  missing: { setId: string; file: string; reason: string };
  changed: { setId: string };
};

const MAX_CONCURRENT = 4;
/**
 * Head trim: playback starts just before the first frame that is louder than
 * this fraction of the attack peak. Measured on the Salamander set, cutting at
 * 5 % (−26 dB) instead of at the first trace of sound removes a further
 * ~6 ms (up to 18 ms on soft notes) of pre-attack key noise — delay the
 * player would otherwise feel on every note — and nothing of the tone itself.
 */
const HEAD_THRESHOLD = 0.05;
const HEAD_THRESHOLD_RELEASE = 0.05;
const HEAD_PREROLL_SEC = 0.0012;
const HEAD_FADE_SEC = 0.001;
const MIN_TAIL_SEC = 2.5;
/** How far the mapper may pitch a sample when it has to fall back (semitones). */
const NEAR_SEMITONES = 2;
const FAR_SEMITONES = 12;

export class SampleManager {
  readonly events = new Emitter<Events>();

  private readonly sets = new Map<string, SetState>();
  private readonly inflight = new Map<string, Promise<AudioBuffer | null>>();
  private readonly failed = new Set<string>();
  /** Attack loudness of every decoded buffer, measured once after decoding. */
  private readonly levels = new WeakMap<AudioBuffer, number>();
  private readonly queue: (() => void)[] = [];
  private running = 0;
  private bytes = 0;
  private bufferCount = 0;
  /** Bumped by unload() so decodes that finish afterwards are discarded. */
  private generation = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly baseUrl: string,
  ) {}

  /* ---------------------------------------------------------------- */
  /* registration                                                      */
  /* ---------------------------------------------------------------- */

  registerSet(def: SampleSetDef): void {
    if (this.sets.has(def.id)) return;
    const nearestRoots: number[][] = [];
    for (let midi = 0; midi < 128; midi++) {
      nearestRoots.push(
        [...def.roots].sort((a, b) => Math.abs(a - midi) - Math.abs(b - midi) || a - b),
      );
    }
    this.sets.set(def.id, {
      def,
      layers: def.layers.map(() => new Map<number, AudioBuffer>()),
      release: new Map(),
      nearestRoots,
    });
  }

  /** Root notes needed to play every note in [low, high] without falling back. */
  rootsForRange(setId: string, low: number, high: number): number[] {
    const set = this.sets.get(setId);
    if (!set) return [];
    const needed = new Set<number>();
    for (let n = Math.max(0, low); n <= Math.min(127, high); n++) needed.add(set.nearestRoots[n][0]);
    return [...needed].sort((a, b) => a - b);
  }

  /* ---------------------------------------------------------------- */
  /* loading                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Load a block of zones. Resolves when every file has either loaded or
   * failed; never rejects because of a single bad file.
   */
  async load(req: LoadRequest, onProgress?: (p: LoadProgress) => void): Promise<LoadProgress> {
    const set = this.sets.get(req.setId);
    if (!set) throw new Error(`Unknown sample set "${req.setId}"`);

    const jobs: Promise<void>[] = [];
    const progress: LoadProgress = { loaded: 0, total: 0, failed: 0 };

    for (const layerId of req.layers) {
      const layerIndex = set.def.layers.findIndex((l) => l.id === layerId);
      if (layerIndex < 0) continue;
      for (const root of req.roots) {
        if (set.layers[layerIndex].has(root)) continue;
        progress.total++;
        const file = set.def.pattern.replace('{layer}', layerId).replace('{note}', pad(root, 3));
        const balance = this.balanceTarget(set.def, root);
        jobs.push(
          this.fetchDecoded(set, file, { tail: req.tail, headThreshold: HEAD_THRESHOLD, balanceDb: balance }).then((buffer) => {
            if (buffer) {
              if (!set.layers[layerIndex].has(root)) {
                set.layers[layerIndex].set(root, buffer);
                this.account(buffer, +1);
              }
              progress.loaded++;
            } else {
              progress.failed++;
            }
            onProgress?.({ ...progress });
          }),
        );
      }
    }
    await Promise.all(jobs);
    if (jobs.length) this.events.emit('changed', { setId: req.setId });
    return progress;
  }

  /** Load key-release samples for the given notes (one file per key). */
  async loadRelease(setId: string, low: number, high: number): Promise<void> {
    const set = this.sets.get(setId);
    const rel = set?.def.release;
    if (!set || !rel) return;
    const jobs: Promise<void>[] = [];
    for (let note = Math.max(low, rel.low); note <= Math.min(high, rel.high); note++) {
      if (set.release.has(note)) continue;
      const file = rel.pattern.replace('{note}', pad(note, 3));
      jobs.push(
        this.fetchDecoded(set, file, { tail: null, headThreshold: HEAD_THRESHOLD_RELEASE, balanceDb: null }).then((buffer) => {
          if (buffer && !set.release.has(note)) {
            set.release.set(note, buffer);
            this.account(buffer, +1);
          }
        }),
      );
    }
    await Promise.all(jobs);
  }

  private fetchDecoded(
    set: SetState,
    file: string,
    opts: { tail: TailTrim | null; headThreshold: number; balanceDb: number | null },
  ): Promise<AudioBuffer | null> {
    const url = `${this.baseUrl}${set.def.baseUrl}${file}`;
    const existing = this.inflight.get(url);
    if (existing) return existing;
    if (this.failed.has(url)) return Promise.resolve(null);

    const generation = this.generation;
    const job = this.enqueue(async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(bytes);
        if (generation !== this.generation) return null; // set was unloaded meanwhile
        const trimmed = trimBuffer(this.ctx, decoded, opts.headThreshold, opts.tail);
        if (opts.balanceDb !== null) balanceStereo(trimmed, opts.balanceDb);
        this.levels.set(trimmed, attackLevel(trimmed));
        return trimmed;
      } catch (err) {
        this.failed.add(url);
        const reason = err instanceof Error ? err.message : String(err);
        this.events.emit('missing', { setId: set.def.id, file, reason });
        return null;
      } finally {
        this.inflight.delete(url);
      }
    });
    this.inflight.set(url, job);
    return job;
  }

  /** Wanted right-minus-left balance (dB) for a recording, or null when the set is left as recorded. */
  private balanceTarget(def: SampleSetDef, root: number): number | null {
    const b = def.stereoBalance;
    if (!b) return null;
    const lo = def.roots[0];
    const hi = def.roots[def.roots.length - 1];
    const t = hi > lo ? (root - lo) / (hi - lo) : 0.5;
    return b.lowDb + (b.highDb - b.lowDb) * t;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve) => {
      const run = (): void => {
        this.running++;
        task()
          .then(resolve)
          .finally(() => {
            this.running--;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      if (this.running < MAX_CONCURRENT) run();
      else this.queue.push(run);
    });
  }

  /* ---------------------------------------------------------------- */
  /* lookup (hot path — called on every Note On)                       */
  /* ---------------------------------------------------------------- */

  /**
   * Find the best loaded sample for a note.
   * `layerOrder` lists layer indices from most to least wanted.
   */
  lookup(setId: string, midi: number, layerOrder: readonly number[]): SampleHit | null {
    const set = this.sets.get(setId);
    if (!set || midi < 0 || midi > 127) return null;
    const roots = set.nearestRoots[midi];

    // Pass 1: right pitch zone first — prefer a neighbouring velocity layer
    // over a badly pitched sample.
    for (const maxDistance of [NEAR_SEMITONES, FAR_SEMITONES]) {
      for (const layerIndex of layerOrder) {
        const layer = set.layers[layerIndex];
        if (!layer || layer.size === 0) continue;
        for (const root of roots) {
          if (Math.abs(root - midi) > maxDistance) break;
          const buffer = layer.get(root);
          if (buffer) return { buffer, root, layerIndex, level: this.levels.get(buffer) ?? 0 };
        }
      }
    }
    return null;
  }

  /** Attack loudness of one specific zone, or null while it is not loaded. */
  levelOf(setId: string, layerIndex: number, root: number): number | null {
    const buffer = this.sets.get(setId)?.layers[layerIndex]?.get(root);
    return buffer ? (this.levels.get(buffer) ?? null) : null;
  }

  lookupRelease(setId: string, midi: number): AudioBuffer | null {
    return this.sets.get(setId)?.release.get(midi) ?? null;
  }

  isLoaded(setId: string, layerId: string, root: number): boolean {
    const set = this.sets.get(setId);
    if (!set) return false;
    const i = set.def.layers.findIndex((l) => l.id === layerId);
    return i >= 0 && set.layers[i].has(root);
  }

  /* ---------------------------------------------------------------- */
  /* memory                                                            */
  /* ---------------------------------------------------------------- */

  /** Drop every decoded buffer of a set. Voices still playing keep their own reference until they end. */
  unload(setId: string): void {
    const set = this.sets.get(setId);
    if (!set) return;
    this.generation++;
    for (const layer of set.layers) {
      for (const buffer of layer.values()) this.account(buffer, -1);
      layer.clear();
    }
    for (const buffer of set.release.values()) this.account(buffer, -1);
    set.release.clear();
    this.failed.clear();
    this.events.emit('changed', { setId });
  }

  private account(buffer: AudioBuffer, sign: 1 | -1): void {
    this.bytes += sign * buffer.length * buffer.numberOfChannels * 4;
    this.bufferCount += sign;
  }

  stats(): { buffers: number; megabytes: number; pending: number; failed: number } {
    return {
      buffers: this.bufferCount,
      megabytes: this.bytes / (1024 * 1024),
      pending: this.inflight.size,
      failed: this.failed.size,
    };
  }
}

/* -------------------------------------------------------------------- */
/* buffer analysis and trimming                                          */
/* -------------------------------------------------------------------- */

/** RMS over all channels of the first 400 ms — a simple, stable measure of how loud a strike is. */
export function attackLevel(buffer: AudioBuffer): number {
  const frames = Math.min(buffer.length, Math.floor(buffer.sampleRate * 0.4));
  if (frames === 0) return 0;
  let sum = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) sum += d[i] * d[i];
  }
  return Math.sqrt(sum / (frames * buffer.numberOfChannels));
}

/**
 * Bring a stereo recording's left/right balance to `targetDb` (right minus
 * left) without changing its overall loudness. The balance is measured on
 * the first two seconds, where the note is loudest. In place.
 */
export function balanceStereo(buffer: AudioBuffer, targetDb: number, maxCorrectionDb = 12): void {
  if (buffer.numberOfChannels < 2) return;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const frames = Math.min(buffer.length, Math.floor(buffer.sampleRate * 2));
  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < frames; i++) {
    sumL += left[i] * left[i];
    sumR += right[i] * right[i];
  }
  if (sumL <= 0 || sumR <= 0) return;
  const measuredDb = 10 * Math.log10(sumR / sumL);
  const correction = Math.max(-maxCorrectionDb, Math.min(maxCorrectionDb, targetDb - measuredDb));
  if (Math.abs(correction) < 0.1) return;
  let gainL = Math.pow(10, -correction / 40);
  let gainR = Math.pow(10, correction / 40);
  // Keep the summed power of the two channels unchanged.
  const norm = Math.sqrt((sumL + sumR) / (sumL * gainL * gainL + sumR * gainR * gainR));
  gainL *= norm;
  gainR *= norm;
  for (let i = 0; i < left.length; i++) {
    left[i] *= gainL;
    right[i] *= gainR;
  }
}

/**
 * Returns a copy of `src` that starts right at the attack and (optionally)
 * ends once the sound has decayed into inaudibility, with a smooth fade-out.
 */
export function trimBuffer(
  ctx: BaseAudioContext,
  src: AudioBuffer,
  headThreshold: number,
  tail: TailTrim | null,
): AudioBuffer {
  const sr = src.sampleRate;
  const channels = src.numberOfChannels;
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(src.getChannelData(c));
  const length = src.length;

  // --- peak of the attack region (first 400 ms) and overall peak ---------
  const attackEnd = Math.min(length, Math.floor(sr * 0.4));
  let attackPeak = 0;
  for (let c = 0; c < channels; c++) {
    const d = data[c];
    for (let i = 0; i < attackEnd; i++) {
      const a = d[i] < 0 ? -d[i] : d[i];
      if (a > attackPeak) attackPeak = a;
    }
  }

  // --- head: first frame above the threshold ---------------------------
  let start = 0;
  const threshold = Math.max(attackPeak * headThreshold, 1e-4);
  search: for (let i = 0; i < attackEnd; i++) {
    for (let c = 0; c < channels; c++) {
      const v = data[c][i];
      if (v > threshold || v < -threshold) {
        start = i;
        break search;
      }
    }
  }
  start = Math.max(0, start - Math.floor(sr * HEAD_PREROLL_SEC));

  // --- tail: last 50 ms block still above (peak + tail.db) --------------
  let end = length;
  let fadeFrames = Math.floor(sr * 0.02);
  if (tail) {
    const block = Math.floor(sr * 0.05);
    let peak = 0;
    const blocks = Math.floor(length / block);
    const env = new Float32Array(blocks);
    for (let b = 0; b < blocks; b++) {
      let m = 0;
      const from = b * block;
      for (let c = 0; c < channels; c++) {
        const d = data[c];
        for (let i = from; i < from + block; i += 2) {
          const a = d[i] < 0 ? -d[i] : d[i];
          if (a > m) m = a;
        }
      }
      env[b] = m;
      if (m > peak) peak = m;
    }
    const floor = peak * Math.pow(10, tail.db / 20);
    let lastLoud = blocks - 1;
    while (lastLoud > 0 && env[lastLoud] < floor) lastLoud--;
    const wantedEnd = (lastLoud + 1) * block + Math.floor(sr * tail.fadeSec);
    const minEnd = start + Math.floor(sr * MIN_TAIL_SEC);
    const maxEnd = start + Math.floor(sr * tail.maxSec);
    end = Math.min(length, maxEnd, Math.max(wantedEnd, minEnd));
    if (end < length) fadeFrames = Math.floor(sr * tail.fadeSec);
  }

  const outLength = Math.max(1, end - start);
  fadeFrames = Math.min(fadeFrames, outLength);
  const out = ctx.createBuffer(channels, outLength, sr);
  const fadeIn = Math.min(Math.max(8, Math.round(sr * HEAD_FADE_SEC)), outLength);

  for (let c = 0; c < channels; c++) {
    const dst = out.getChannelData(c);
    dst.set(data[c].subarray(start, end));
    // A 1 ms fade-in removes the step left by the head cut.
    for (let i = 0; i < fadeIn; i++) dst[i] *= i / fadeIn;
    // Raised-cosine fade-out to digital silence.
    const fadeStart = outLength - fadeFrames;
    for (let i = 0; i < fadeFrames; i++) {
      const g = 0.5 * (1 + Math.cos((Math.PI * i) / fadeFrames));
      dst[fadeStart + i] *= g;
    }
  }
  return out;
}
