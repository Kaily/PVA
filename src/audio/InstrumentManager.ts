import { Emitter } from '../core/Emitter';
import { clamp, dbToGain } from '../core/math';
import {
  INSTRUMENTS,
  QUALITY_TIERS,
  SAMPLE_SETS,
  type InstrumentDef,
  type SampleQuality,
  type SampleSetDef,
} from '../data/instruments';
import { TONES, toneById, type ToneDef } from '../data/tones';
import { MODELS } from './models/indianModels';
import { ModelInstrument } from './models/ModelInstrument';
import type { SampleManager } from './SampleManager';
import { SoundFont } from './sf2/SoundFont';
import { SoundFontBank, SoundFontInstrument } from './sf2/SoundFontInstrument';
import { gateEnvelope, type VoiceSpec } from './voiceTypes';

/**
 * InstrumentManager — turns tone metadata into something playable.
 *
 * Three engines stand behind the tone list:
 *
 *   grand  the multi-layer sampled concert grand (SampleManager). Loaded first
 *          so the instrument is playable about a second after start.
 *   sf2    presets of the SoundFont library. The file is fetched once, in the
 *          background; a preset's samples are converted when it is first used.
 *   model  synthesis models (Indian bank), rendered when the tone is selected.
 *
 * Whatever the engine, the voice engine only sees `PlayableInstrument.pick()`,
 * which maps (note, velocity) to the layers of one voice.
 */

export interface PlayableInstrument {
  readonly def: ToneDef;
  pick(note: number, velocity: number): VoiceSpec | null;
}

export interface LoadStatus {
  phase: 'idle' | 'core' | 'library' | 'done' | 'error';
  loaded: number;
  total: number;
  failed: number;
}

export type LibraryState = 'idle' | 'loading' | 'ready' | 'error';

/** Memory the rendered model tones may take together before the least recently used are dropped. */
const MODEL_BUDGET_MB = 90;

type Events = {
  /** Progress of the grand piano's samples. */
  status: LoadStatus;
  /** State of the SoundFont tone library. */
  library: { state: LibraryState; error?: string };
};

/* -------------------------------------------------------------------- */
/* the sampled grand                                                     */
/* -------------------------------------------------------------------- */

class GrandInstrument implements PlayableInstrument {
  /** layerOrder[v] → layer indices ordered by preference for velocity v. */
  private readonly layerOrder: number[][] = [];
  /** Loudest layer of this quality tier: the loudness reference for every note. */
  private readonly refLayer: number;
  private readonly trim: number;

  constructor(
    readonly def: ToneDef,
    private readonly grand: InstrumentDef,
    private readonly set: SampleSetDef,
    private readonly samples: SampleManager,
    activeLayers: string[],
  ) {
    this.trim = dbToGain(def.gainDb);
    // Layers of this quality tier, softest → loudest.
    const active = set.layers
      .map((layer, index) => ({ layer, index }))
      .filter((l) => activeLayers.includes(l.layer.id));
    this.refLayer = active[active.length - 1].index;

    // Velocity at which each layer's natural loudness equals the target law.
    const centre = active.map((l) => 127 * Math.pow(10, l.layer.levelDb / grand.velocityDb));

    for (let v = 0; v < 128; v++) {
      // Rank layers by how close their natural velocity is; the first is the
      // right one, the rest are fallbacks while other layers still load.
      const ranked = active
        .map((l, i) => ({ index: l.index, d: Math.abs(Math.log(Math.max(1, v) / centre[i])) }))
        .sort((a, b) => a.d - b.d)
        .map((l) => l.index);
      this.layerOrder.push(ranked);
    }
  }

  /**
   * Choose the recording for a strike and the gain that puts it exactly on
   * the velocity law.
   *
   * Loudness is calibrated per note: the level wanted for velocity v is the
   * measured level of this note's own loudest recording, lowered by the
   * velocity law, and the gain is whatever the chosen recording needs to get
   * there. Loudness therefore rises smoothly with velocity on every key —
   * switching sample layers changes the timbre, never the level.
   */
  pick(note: number, velocity: number): VoiceSpec | null {
    const grand = this.grand;
    const [lo, hi] = grand.range;
    if (note < lo || note > hi) return null;
    const v = clamp(Math.round(velocity), 1, 127);
    const hit = this.samples.lookup(this.set.id, note, this.layerOrder[v]);
    if (!hit) return null;

    const layers = this.set.layers;
    const wantedDb = Math.max(grand.velocityFloorDb, grand.velocityDb * Math.log10(v / 127));
    const reference = this.samples.levelOf(this.set.id, this.refLayer, hit.root);
    let gainDb: number;
    if (reference && hit.level > 0) {
      const targetDb = 20 * Math.log10(reference) - layers[this.refLayer].levelDb + wantedDb;
      gainDb = targetDb - 20 * Math.log10(hit.level);
    } else {
      // The reference recording is still loading: use the set's average layer levels.
      gainDb = wantedDb - layers[hit.layerIndex].levelDb;
    }

    const pos = (note - lo) / (hi - lo || 1);
    const rel = this.set.release;
    const noise = rel ? this.samples.lookupRelease(this.set.id, note) : null;
    return {
      layers: [
        {
          buffer: hit.buffer,
          rate: Math.pow(2, (note - hit.root) / 12),
          gain: dbToGain(clamp(gainDb, -40, 15)) * this.trim,
          pan: 0,
          offset: 0,
          loop: null,
          // Damper release: slower in the bass, quicker in the treble.
          env: gateEnvelope(grand.release.lowTau * Math.pow(grand.release.highTau / grand.release.lowTau, pos)),
          filter: null,
          lfo: null,
          pitchEnv: null,
          exclusiveClass: 0,
        },
      ],
      // The top register of a piano has no dampers.
      noDamper: note >= grand.release.undampedFrom,
      decayTau: grand.decay.lowTau * Math.pow(grand.decay.highTau / grand.decay.lowTau, pos),
      keyNoise: noise && rel ? { buffer: noise, gain: dbToGain(rel.gainDb) * this.trim } : null,
    };
  }
}

/* -------------------------------------------------------------------- */
/* manager                                                               */
/* -------------------------------------------------------------------- */

export class InstrumentManager {
  readonly events = new Emitter<Events>();
  status: LoadStatus = { phase: 'idle', loaded: 0, total: 0, failed: 0 };
  library: LibraryState = 'idle';
  libraryError: string | null = null;

  private readonly playable = new Map<string, PlayableInstrument>();
  private quality: SampleQuality = 'standard';
  /** Sounding-note range that has been requested so far for the grand. */
  private readonly loadedRange = new Map<string, [number, number]>();
  private loadToken = 0;
  private bank: SoundFontBank | null = null;
  private libraryPromise: Promise<void> | null = null;
  private readonly preparing = new Map<string, Promise<PlayableInstrument>>();
  /** Order of use, for deciding which rendered model tone to give up first. */
  private readonly lastUsed = new Map<string, number>();
  private useCounter = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly samples: SampleManager,
    private readonly soundFontUrl: string,
  ) {
    for (const set of Object.values(SAMPLE_SETS)) samples.registerSet(set);
  }

  get tones(): readonly ToneDef[] {
    return TONES;
  }

  get currentQuality(): SampleQuality {
    return this.quality;
  }

  /** The instrument for a tone, if it can be played right now. */
  get(toneId: string): PlayableInstrument | undefined {
    return this.playable.get(toneId);
  }

  /* ---------------------------------------------------------------- */
  /* any tone                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Make a tone playable for the sounding range [low, high] and return its
   * instrument. Safe to call repeatedly; concurrent calls share the work.
   */
  prepare(toneId: string, low: number, high: number): Promise<PlayableInstrument> {
    this.lastUsed.set(toneId, ++this.useCounter);
    const ready = this.playable.get(toneId);
    const tone = toneById(toneId);
    if (!tone) return Promise.reject(new Error(`Unknown tone "${toneId}".`));
    if (!tone.available) return Promise.reject(new Error(`${tone.name} is not available. ${tone.unavailableReason ?? ''}`.trim()));

    if (ready) {
      if (tone.engine === 'grand') void this.ensureRange(toneId, low, high);
      else if (ready instanceof ModelInstrument) void ready.prepare(low, high);
      else if (ready instanceof SoundFontInstrument && this.bank) void this.bank.warm(ready.presetIndex, low, high);
      return Promise.resolve(ready);
    }
    const running = this.preparing.get(toneId);
    if (running) return running;

    const job = this.build(tone, low, high).finally(() => this.preparing.delete(toneId));
    this.preparing.set(toneId, job);
    return job;
  }

  private async build(tone: ToneDef, low: number, high: number): Promise<PlayableInstrument> {
    if (tone.engine === 'grand') return this.load(tone.id, this.quality, low, high);

    if (tone.engine === 'sf2') {
      await this.loadLibrary();
      const bank = this.bank;
      if (!bank || !tone.sf2) throw new Error('The tone library is not loaded.');
      const preset = bank.font.findPreset(tone.sf2.bank, tone.sf2.program);
      if (!preset) throw new Error(`${tone.name} is missing from the tone library.`);
      const inst = new SoundFontInstrument(tone, bank, preset.index);
      this.playable.set(tone.id, inst);
      void bank.warm(preset.index, low, high);
      return inst;
    }

    const model = tone.model ? MODELS[tone.model] : undefined;
    if (!model) throw new Error(`${tone.name} has no synthesis model.`);
    const inst = new ModelInstrument(tone, model, this.ctx);
    // Render the middle of the keyboard before the tone becomes selectable,
    // the rest in the background.
    await inst.prepare(Math.max(low, 55), Math.min(high, 79));
    this.playable.set(tone.id, inst);
    void inst.prepare(low, high);
    return inst;
  }

  /* ---------------------------------------------------------------- */
  /* SoundFont library                                                 */
  /* ---------------------------------------------------------------- */

  /** Fetch and parse the SoundFont (once). Resolves when its tones can be selected. */
  loadLibrary(): Promise<void> {
    if (this.libraryPromise) return this.libraryPromise;
    this.setLibrary('loading');
    this.libraryPromise = (async () => {
      try {
        const res = await fetch(this.soundFontUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        this.bank = new SoundFontBank(this.ctx, new SoundFont(data));
        this.setLibrary('ready');
      } catch (err) {
        this.libraryPromise = null; // allow a retry
        const reason = err instanceof Error ? err.message : String(err);
        this.setLibrary('error', reason);
        throw new Error(`The tone library could not be loaded (${reason}).`);
      }
    })();
    return this.libraryPromise;
  }

  private setLibrary(state: LibraryState, error?: string): void {
    this.library = state;
    this.libraryError = error ?? null;
    this.events.emit('library', { state, error });
  }

  /** Whether a tone can be selected at the moment. */
  selectable(tone: ToneDef): boolean {
    if (!tone.available) return false;
    if (tone.engine === 'sf2') return this.library !== 'error';
    return true;
  }

  /**
   * Modelled tones are rendered into memory when they are selected (up to
   * ~40 MB each). Keep the ones in use and the most recent others within a
   * budget; older ones are dropped and simply rendered again when selected.
   */
  trimModels(inUse: Iterable<string>, budgetMb = MODEL_BUDGET_MB): void {
    const keep = new Set(inUse);
    const models: [string, ModelInstrument][] = [];
    let total = 0;
    for (const [id, p] of this.playable) {
      if (!(p instanceof ModelInstrument)) continue;
      total += p.megabytes;
      models.push([id, p]);
    }
    if (total <= budgetMb) return;
    models.sort((a, b) => (this.lastUsed.get(a[0]) ?? 0) - (this.lastUsed.get(b[0]) ?? 0));
    for (const [id, p] of models) {
      if (total <= budgetMb) break;
      if (keep.has(id) || this.preparing.has(id)) continue;
      total -= p.megabytes;
      p.dispose();
      this.playable.delete(id);
    }
  }

  memory(): { soundFontMb: number; soundFontBuffers: number; modelMb: number } {
    let modelMb = 0;
    for (const p of this.playable.values()) if (p instanceof ModelInstrument) modelMb += p.megabytes;
    return { soundFontMb: this.bank?.megabytes ?? 0, soundFontBuffers: this.bank?.bufferCount ?? 0, modelMb };
  }

  /* ---------------------------------------------------------------- */
  /* the grand                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Load the grand for the sounding-note range [low, high].
   *
   * Resolves as soon as the *core* layer is decoded — the instrument is
   * playable at that point. The remaining velocity layers and the key-release
   * samples keep loading in the background; `status` reports progress.
   */
  async load(id: string, quality: SampleQuality, low: number, high: number): Promise<PlayableInstrument> {
    const tone = toneById(id);
    const def = INSTRUMENTS.find((i) => i.id === id);
    if (!tone || !def || !def.available) throw new Error(`Instrument "${id}" is not available.`);
    const set = SAMPLE_SETS[def.sampleSet];
    if (!set) throw new Error(`Sample set "${def.sampleSet}" is not defined.`);

    const tier = QUALITY_TIERS[quality];
    this.quality = quality;
    const token = ++this.loadToken;
    const lo = Math.max(def.range[0], low);
    const hi = Math.min(def.range[1], high);
    const roots = this.samples.rootsForRange(set.id, lo, hi);
    this.loadedRange.set(id, [lo, hi]);

    const instrument = new GrandInstrument(tone, def, set, this.samples, tier.layers);
    this.playable.set(id, instrument);

    const layerIndex = (layerId: string): number => set.layers.findIndex((l) => l.id === layerId);
    const coreIndex = layerIndex(tier.coreLayer);
    // Background layers load outwards from the core layer, so the dynamics
    // fill in from mezzo-forte towards the extremes.
    const rest = tier.layers
      .filter((l) => l !== tier.coreLayer)
      .sort((a, b) => Math.abs(layerIndex(a) - coreIndex) - Math.abs(layerIndex(b) - coreIndex));

    const total = roots.length * tier.layers.length;
    let done = 0;
    let failed = 0;
    const report = (phase: LoadStatus['phase']): void => {
      if (token !== this.loadToken) return;
      this.status = { phase, loaded: done, total, failed };
      this.events.emit('status', this.status);
    };

    report('core');
    let before = 0;
    const core = await this.samples.load({ setId: set.id, layers: [tier.coreLayer], roots, tail: tier.tail }, (p) => {
      done += p.loaded - before;
      before = p.loaded;
      failed = p.failed;
      report('core');
    });
    if (token !== this.loadToken) return instrument;
    if (core.loaded === 0 && core.total > 0) {
      report('error');
      throw new Error(`No samples could be loaded for "${def.name}".`);
    }
    // Zones that were already cached count as done.
    done = roots.length;
    const coreFailed = core.failed;
    report('library');

    // Background: the rest of the piano. Not awaited by the caller.
    void (async () => {
      let layersFailed = 0;
      for (const layer of rest) {
        const res = await this.samples.load({ setId: set.id, layers: [layer], roots, tail: tier.tail });
        if (token !== this.loadToken) return;
        done += roots.length;
        layersFailed += res.failed;
        failed = coreFailed + layersFailed;
        report('library');
      }
      await this.samples.loadRelease(set.id, lo, hi);
      if (token !== this.loadToken) return;
      report('done');
    })();

    return instrument;
  }

  /**
   * Make sure the grand has samples for a (possibly shifted) sounding range.
   * Called when transpose / octave moves the keyboard outside what is loaded.
   */
  async ensureRange(id: string, low: number, high: number): Promise<void> {
    const def = INSTRUMENTS.find((i) => i.id === id);
    const current = this.loadedRange.get(id);
    if (!def || !current) return;
    const set = SAMPLE_SETS[def.sampleSet];
    const lo = Math.max(def.range[0], Math.min(low, current[0]));
    const hi = Math.min(def.range[1], Math.max(high, current[1]));
    if (lo >= current[0] && hi <= current[1]) return;
    this.loadedRange.set(id, [lo, hi]);

    const tier = QUALITY_TIERS[this.quality];
    const roots = this.samples.rootsForRange(set.id, lo, hi);
    const token = this.loadToken;
    // Core layer first so the new keys respond quickly, then the others.
    await this.samples.load({ setId: set.id, layers: [tier.coreLayer], roots, tail: tier.tail });
    if (token !== this.loadToken) return;
    await this.samples.load({ setId: set.id, layers: tier.layers, roots, tail: tier.tail });
    if (token !== this.loadToken) return;
    await this.samples.loadRelease(set.id, lo, hi);
  }

  /** Drop the grand's decoded audio (used when the sample quality changes). */
  unload(id: string): void {
    const def = INSTRUMENTS.find((i) => i.id === id);
    if (!def) return;
    this.loadToken++;
    this.samples.unload(def.sampleSet);
    this.playable.delete(id);
    this.loadedRange.delete(id);
    this.status = { phase: 'idle', loaded: 0, total: 0, failed: 0 };
    this.events.emit('status', this.status);
  }
}
