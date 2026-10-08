import { clamp, dbToGain } from '../../core/math';
import type { ToneDef } from '../../data/tones';
import type { PlayableInstrument } from '../InstrumentManager';
import type { LayerSpec, VoiceSpec } from '../voiceTypes';
import type { ModelDef } from './indianModels';

interface Rendered {
  buffer: AudioBuffer;
  loop: boolean;
}

/**
 * ModelInstrument — plays a synthesis model through the ordinary voice
 * engine. The model renders each needed note once into a buffer (a few
 * milliseconds per note); after that the tone behaves exactly like a sampled
 * instrument: instant note-on, velocity layers, loops, pedals, polyphony.
 */
export class ModelInstrument implements PlayableInstrument {
  private readonly cache = new Map<number, Rendered>();
  private readonly trim: number;
  private bytes = 0;
  private disposed = false;

  constructor(
    readonly def: ToneDef,
    private readonly model: ModelDef,
    private readonly ctx: BaseAudioContext,
  ) {
    this.trim = dbToGain(def.gainDb);
  }

  /** The note a key is rendered at: the nearest "root" on the model's grid. */
  private rootFor(note: number): number {
    if (this.model.kit) return 60 + (((note % 12) + 12) % 12); // the same twelve sounds on every octave
    const step = this.model.rootStep;
    const [lo, hi] = this.def.range;
    return clamp(lo + Math.round((note - lo) / step) * step, lo, hi);
  }

  private layerFor(velocity: number): number {
    const thresholds = this.model.layers;
    let layer = 0;
    for (let i = 1; i < thresholds.length; i++) if (velocity >= thresholds[i]) layer = i;
    return layer;
  }

  private rendered(root: number, layer: number): Rendered | null {
    const key = root * 8 + layer;
    const hit = this.cache.get(key);
    if (hit) return hit;
    try {
      const note = this.model.render(root, layer);
      const buffer = this.ctx.createBuffer(1, note.data.length, clamp(note.sampleRate, 3000, 192000));
      buffer.getChannelData(0).set(note.data);
      const r: Rendered = { buffer, loop: note.loop };
      this.cache.set(key, r);
      this.bytes += note.data.length * 4;
      return r;
    } catch (err) {
      console.error(`[ModelInstrument] "${this.model.id}" could not render note ${root}`, err);
      return null;
    }
  }

  /** Render everything the given key range needs, a few notes at a time so playing is not disturbed. */
  async prepare(keyLo: number, keyHi: number): Promise<void> {
    const [lo, hi] = this.def.range;
    const roots = new Set<number>();
    for (let n = Math.max(lo, keyLo); n <= Math.min(hi, keyHi); n++) roots.add(this.rootFor(n));
    let n = 0;
    for (const root of roots) {
      for (let layer = 0; layer < this.model.layers.length; layer++) {
        if (this.disposed) return;
        if (this.cache.has(root * 8 + layer)) continue;
        this.rendered(root, layer);
        if (++n % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  /** Give the rendered audio back. Notes that are still sounding keep their own buffers until they end. */
  dispose(): void {
    this.disposed = true;
    this.cache.clear();
    this.bytes = 0;
  }

  pick(note: number, velocity: number): VoiceSpec | null {
    if (this.disposed) return null;
    const [lo, hi] = this.def.range;
    if (note < lo || note > hi) return null;
    const v = clamp(Math.round(velocity), 1, 127);
    const root = this.rootFor(note);
    const r = this.rendered(root, this.layerFor(v));
    if (!r) return null;

    const extras = this.model.extras?.(note, v) ?? {};
    const layer: LayerSpec = {
      buffer: r.buffer,
      rate: this.model.kit ? 1 : Math.pow(2, (note - root) / 12),
      gain: dbToGain(this.model.velocityDb * Math.log10(v / 127)) * this.trim,
      pan: extras.pan ?? 0,
      offset: 0,
      loop: r.loop ? { start: 0, end: r.buffer.duration, untilRelease: false } : null,
      env: this.model.envelope(note),
      filter: null,
      lfo: extras.lfo ?? null,
      pitchEnv: extras.pitchEnv ?? null,
      exclusiveClass: 0,
    };
    return { layers: [layer], noDamper: false, decayTau: this.model.decayTau(note), keyNoise: null };
  }

  get megabytes(): number {
    return this.bytes / (1024 * 1024);
  }
}
