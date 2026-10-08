/**
 * SoundFont 2 file reader.
 *
 * Parses the RIFF structure into typed tables and resolves a preset into a
 * flat list of *regions*: for every (key range, velocity range) the sample to
 * play and the final value of all generators, with the instrument and preset
 * levels and their global zones already combined as the SF2 specification
 * prescribes. Modulators are kept per region and evaluated at note-on
 * (see sf2/SoundFontInstrument.ts).
 *
 * No audio objects are created here — this file is pure data handling and is
 * covered by unit tests under Node.
 */

export const GEN = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  modLfoToPitch: 5,
  vibLfoToPitch: 6,
  modEnvToPitch: 7,
  initialFilterFc: 8,
  initialFilterQ: 9,
  modLfoToFilterFc: 10,
  modEnvToFilterFc: 11,
  endAddrsCoarseOffset: 12,
  modLfoToVolume: 13,
  chorusEffectsSend: 15,
  reverbEffectsSend: 16,
  pan: 17,
  delayModLFO: 21,
  freqModLFO: 22,
  delayVibLFO: 23,
  freqVibLFO: 24,
  delayModEnv: 25,
  attackModEnv: 26,
  holdModEnv: 27,
  decayModEnv: 28,
  sustainModEnv: 29,
  releaseModEnv: 30,
  keynumToModEnvHold: 31,
  keynumToModEnvDecay: 32,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keynumToVolEnvHold: 39,
  keynumToVolEnvDecay: 40,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  keynum: 46,
  velocity: 47,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
} as const;

export const GEN_COUNT = 60;

/** Generators that only exist at instrument level (a preset may not offset them). */
const INSTRUMENT_ONLY = new Set<number>([
  GEN.startAddrsOffset,
  GEN.endAddrsOffset,
  GEN.startloopAddrsOffset,
  GEN.endloopAddrsOffset,
  GEN.startAddrsCoarseOffset,
  GEN.endAddrsCoarseOffset,
  GEN.startloopAddrsCoarseOffset,
  GEN.endloopAddrsCoarseOffset,
  GEN.keynum,
  GEN.velocity,
  GEN.sampleModes,
  GEN.exclusiveClass,
  GEN.overridingRootKey,
  GEN.sampleID,
  GEN.instrument,
  GEN.keyRange,
  GEN.velRange,
]);

function defaultGenerators(): Int16Array {
  const g = new Int16Array(GEN_COUNT);
  g[GEN.initialFilterFc] = 13500;
  for (const i of [
    GEN.delayModLFO,
    GEN.delayVibLFO,
    GEN.delayModEnv,
    GEN.attackModEnv,
    GEN.holdModEnv,
    GEN.decayModEnv,
    GEN.releaseModEnv,
    GEN.delayVolEnv,
    GEN.attackVolEnv,
    GEN.holdVolEnv,
    GEN.decayVolEnv,
    GEN.releaseVolEnv,
  ]) {
    g[i] = -12000;
  }
  g[GEN.keynum] = -1;
  g[GEN.velocity] = -1;
  g[GEN.scaleTuning] = 100;
  g[GEN.overridingRootKey] = -1;
  return g;
}

export interface Modulator {
  src: number;
  dest: number;
  amount: number;
  amtSrc: number;
  transform: number;
}

/** SF2 default modulators that depend only on the strike (the controller ones are handled by the mixer). */
const DEFAULT_MODULATORS: Modulator[] = [
  { src: 0x0502, dest: GEN.initialAttenuation, amount: 960, amtSrc: 0, transform: 0 }, // velocity → level
  { src: 0x0102, dest: GEN.initialFilterFc, amount: -2400, amtSrc: 0, transform: 0 }, // velocity → brightness
];

export interface SampleHeader {
  name: string;
  /** Frame positions inside the shared sample pool. */
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  originalPitch: number;
  pitchCorrection: number;
}

export interface PresetHeader {
  name: string;
  program: number;
  bank: number;
  /** Index into the preset table. */
  index: number;
}

export interface Region {
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  sample: number;
  /** Final generator values (instrument + preset, global zones applied). */
  gens: Int16Array;
  /** Instrument-level modulators (defaults with overrides applied). */
  mods: Modulator[];
  /** Preset-level modulators; their output is added on top. */
  presetMods: Modulator[];
}

interface Table {
  view: DataView;
  offset: number;
  count: number;
}

const sameModulator = (a: Modulator, b: Modulator): boolean =>
  a.src === b.src && a.dest === b.dest && a.amtSrc === b.amtSrc && a.transform === b.transform;

function overlay(base: Modulator[], extra: Modulator[]): Modulator[] {
  if (extra.length === 0) return base;
  const out = base.slice();
  for (const m of extra) {
    const i = out.findIndex((o) => sameModulator(o, m));
    if (i >= 0) out[i] = m;
    else out.push(m);
  }
  return out;
}

export class SoundFont {
  readonly name: string;
  readonly presets: PresetHeader[] = [];
  readonly samples: SampleHeader[] = [];
  /** All sample data, 16-bit mono, concatenated. */
  readonly sampleData: Int16Array;

  private readonly pbag: Table;
  private readonly pgen: Table;
  private readonly pmod: Table;
  private readonly instBag: number[] = [];
  private readonly ibag: Table;
  private readonly igen: Table;
  private readonly imod: Table;
  private readonly presetBag: number[] = [];
  private readonly regionCache = new Map<number, Region[]>();

  constructor(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    const tag = (o: number): string => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    if (buffer.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('Not a SoundFont 2 file.');

    const chunks = new Map<string, { offset: number; size: number }>();
    let p = 12;
    while (p + 8 <= buffer.byteLength) {
      const id = tag(p);
      const size = view.getUint32(p + 4, true);
      if (id === 'LIST') {
        let q = p + 12;
        const end = Math.min(p + 8 + size, buffer.byteLength);
        while (q + 8 <= end) {
          const sub = tag(q);
          const subSize = view.getUint32(q + 4, true);
          chunks.set(sub, { offset: q + 8, size: subSize });
          q += 8 + subSize + (subSize & 1);
        }
      }
      p += 8 + size + (size & 1);
    }

    const need = (id: string): { offset: number; size: number } => {
      const c = chunks.get(id);
      if (!c) throw new Error(`SoundFont is missing the "${id}" chunk.`);
      return c;
    };
    const table = (id: string, recordSize: number): Table => {
      const c = need(id);
      return { view, offset: c.offset, count: Math.floor(c.size / recordSize) };
    };
    const text = (offset: number, length: number): string => {
      let s = '';
      for (let i = 0; i < length; i++) {
        const ch = view.getUint8(offset + i);
        if (ch === 0) break;
        s += String.fromCharCode(ch);
      }
      return s.trim();
    };

    const inam = chunks.get('INAM');
    this.name = inam ? text(inam.offset, inam.size) : 'SoundFont';

    // sample pool (16-bit little endian; RIFF data is word aligned, but be safe)
    const smpl = need('smpl');
    this.sampleData =
      smpl.offset % 2 === 0
        ? new Int16Array(buffer, smpl.offset, smpl.size >> 1)
        : new Int16Array(buffer.slice(smpl.offset, smpl.offset + (smpl.size & ~1)));

    const phdr = table('phdr', 38);
    for (let i = 0; i < phdr.count; i++) {
      const o = phdr.offset + i * 38;
      this.presetBag.push(view.getUint16(o + 24, true));
      if (i < phdr.count - 1) {
        this.presets.push({ name: text(o, 20), program: view.getUint16(o + 20, true), bank: view.getUint16(o + 22, true), index: i });
      }
    }
    const inst = table('inst', 22);
    for (let i = 0; i < inst.count; i++) this.instBag.push(view.getUint16(inst.offset + i * 22 + 20, true));

    this.pbag = table('pbag', 4);
    this.pgen = table('pgen', 4);
    this.pmod = table('pmod', 10);
    this.ibag = table('ibag', 4);
    this.igen = table('igen', 4);
    this.imod = table('imod', 10);

    const shdr = table('shdr', 46);
    for (let i = 0; i < shdr.count - 1; i++) {
      const o = shdr.offset + i * 46;
      this.samples.push({
        name: text(o, 20),
        start: view.getUint32(o + 20, true),
        end: view.getUint32(o + 24, true),
        loopStart: view.getUint32(o + 28, true),
        loopEnd: view.getUint32(o + 32, true),
        sampleRate: view.getUint32(o + 36, true),
        originalPitch: view.getUint8(o + 40),
        pitchCorrection: view.getInt8(o + 41),
      });
    }
  }

  findPreset(bank: number, program: number): PresetHeader | undefined {
    return this.presets.find((p) => p.bank === bank && p.program === program);
  }

  /* ---------------------------------------------------------------- */
  /* zones                                                             */
  /* ---------------------------------------------------------------- */

  private readZone(
    bag: Table,
    gen: Table,
    mod: Table,
    zone: number,
  ): { gens: Map<number, number>; mods: Modulator[] } {
    const v = bag.view;
    const genFrom = v.getUint16(bag.offset + zone * 4, true);
    const modFrom = v.getUint16(bag.offset + zone * 4 + 2, true);
    const genTo = v.getUint16(bag.offset + (zone + 1) * 4, true);
    const modTo = v.getUint16(bag.offset + (zone + 1) * 4 + 2, true);
    const gens = new Map<number, number>();
    for (let i = genFrom; i < genTo && i < gen.count; i++) {
      const o = gen.offset + i * 4;
      const oper = v.getUint16(o, true);
      // ranges are kept as the raw unsigned word, everything else is signed
      gens.set(oper, oper === GEN.keyRange || oper === GEN.velRange ? v.getUint16(o + 2, true) : v.getInt16(o + 2, true));
    }
    const mods: Modulator[] = [];
    for (let i = modFrom; i < modTo && i < mod.count; i++) {
      const o = mod.offset + i * 10;
      mods.push({
        src: v.getUint16(o, true),
        dest: v.getUint16(o + 2, true),
        amount: v.getInt16(o + 4, true),
        amtSrc: v.getUint16(o + 6, true),
        transform: v.getUint16(o + 8, true),
      });
    }
    return { gens, mods };
  }

  /** All regions of a preset, resolved. Cached. */
  regions(presetIndex: number): Region[] {
    const cached = this.regionCache.get(presetIndex);
    if (cached) return cached;
    const out: Region[] = [];
    const pFrom = this.presetBag[presetIndex];
    const pTo = this.presetBag[presetIndex + 1];

    let presetGlobal: { gens: Map<number, number>; mods: Modulator[] } | null = null;
    for (let pz = pFrom; pz < pTo; pz++) {
      const pZone = this.readZone(this.pbag, this.pgen, this.pmod, pz);
      const instIndex = pZone.gens.get(GEN.instrument);
      if (instIndex === undefined) {
        if (pz === pFrom) presetGlobal = pZone; // a zone without an instrument is only valid as the first (global) zone
        continue;
      }
      const pRange = (id: number): [number, number] => {
        const raw = pZone.gens.get(id) ?? presetGlobal?.gens.get(id);
        return raw === undefined ? [0, 127] : [raw & 0xff, (raw >> 8) & 0xff];
      };
      const [pKeyLo, pKeyHi] = pRange(GEN.keyRange);
      const [pVelLo, pVelHi] = pRange(GEN.velRange);
      const presetMods = overlay(presetGlobal?.mods ?? [], pZone.mods);

      const iFrom = this.instBag[instIndex];
      const iTo = this.instBag[instIndex + 1];
      let instGlobal: { gens: Map<number, number>; mods: Modulator[] } | null = null;
      for (let iz = iFrom; iz < iTo; iz++) {
        const iZone = this.readZone(this.ibag, this.igen, this.imod, iz);
        const sample = iZone.gens.get(GEN.sampleID);
        if (sample === undefined) {
          if (iz === iFrom) instGlobal = iZone;
          continue;
        }
        if (sample >= this.samples.length) continue;
        const iRange = (id: number): [number, number] => {
          const raw = iZone.gens.get(id) ?? instGlobal?.gens.get(id);
          return raw === undefined ? [0, 127] : [raw & 0xff, (raw >> 8) & 0xff];
        };
        const [iKeyLo, iKeyHi] = iRange(GEN.keyRange);
        const [iVelLo, iVelHi] = iRange(GEN.velRange);
        const keyLo = Math.max(pKeyLo, iKeyLo);
        const keyHi = Math.min(pKeyHi, iKeyHi);
        const velLo = Math.max(pVelLo, iVelLo);
        const velHi = Math.min(pVelHi, iVelHi);
        if (keyLo > keyHi || velLo > velHi) continue;

        // instrument level: defaults ← global zone ← zone
        const gens = defaultGenerators();
        if (instGlobal) for (const [k, val] of instGlobal.gens) if (k < GEN_COUNT) gens[k] = val;
        for (const [k, val] of iZone.gens) if (k < GEN_COUNT) gens[k] = val;
        // preset level: offsets (zone value, else global zone value) are added
        for (let k = 0; k < GEN_COUNT; k++) {
          if (INSTRUMENT_ONLY.has(k)) continue;
          const add = pZone.gens.get(k) ?? presetGlobal?.gens.get(k);
          if (add !== undefined) gens[k] = Math.max(-32768, Math.min(32767, gens[k] + add));
        }

        out.push({
          keyLo,
          keyHi,
          velLo,
          velHi,
          sample,
          gens,
          mods: overlay(overlay(DEFAULT_MODULATORS, instGlobal?.mods ?? []), iZone.mods),
          presetMods,
        });
      }
    }
    this.regionCache.set(presetIndex, out);
    return out;
  }
}

/* -------------------------------------------------------------------- */
/* modulators                                                            */
/* -------------------------------------------------------------------- */

const concave = (x: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const y = (-20 / 96) * Math.log10((1 - x) * (1 - x));
  return y > 1 ? 1 : y;
};
const convex = (x: number): number => 1 - concave(1 - x);

export interface ModulatorInputs {
  key: number;
  velocity: number;
}

/**
 * Value (0…1 or −1…1) of a modulator source at note-on.
 * Returns null for sources this engine handles elsewhere or does not track
 * (continuous controllers, pitch wheel …): the modulator is then skipped.
 */
function sourceValue(oper: number, input: ModulatorInputs): number | null {
  if (oper === 0) return 1; // "no controller" = constant 1
  const index = oper & 0x7f;
  const isCC = (oper & 0x80) !== 0;
  const negative = (oper & 0x100) !== 0;
  const bipolar = (oper & 0x200) !== 0;
  const curve = (oper >> 10) & 0x3f;

  let x: number;
  if (isCC) return null;
  if (index === 2) x = input.velocity / 127;
  else if (index === 3) x = input.key / 127;
  else return null;

  if (negative) x = 1 - x;
  const shape = (u: number): number => (curve === 1 ? concave(u) : curve === 2 ? convex(u) : curve === 3 ? (u >= 0.5 ? 1 : 0) : u);
  if (!bipolar) return shape(x);
  const s = 2 * x - 1;
  return s >= 0 ? shape(s) : -shape(-s);
}

/** Add the output of every applicable modulator to a copy of the generator values. */
export function applyModulators(region: Region, input: ModulatorInputs, out: Float64Array): void {
  for (let i = 0; i < GEN_COUNT; i++) out[i] = region.gens[i];
  // The attenuation generator follows the E-mu hardware convention (0.4 ×);
  // modulator output is added in true centibels.
  out[GEN.initialAttenuation] *= 0.4;
  const run = (mods: Modulator[]): void => {
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i];
      if (m.dest >= GEN_COUNT || m.amount === 0) continue;
      const a = sourceValue(m.src, input);
      if (a === null) continue;
      const b = sourceValue(m.amtSrc, input);
      if (b === null) continue;
      let v = m.amount * a * b;
      if (m.transform === 2) v = Math.abs(v);
      out[m.dest] += v;
    }
  };
  run(region.mods);
  run(region.presetMods);
}

export const timecentsToSeconds = (tc: number): number => (tc <= -11950 ? 0 : Math.pow(2, tc / 1200));
export const absoluteCentsToHz = (cents: number): number => 8.176 * Math.pow(2, cents / 1200);
export const centibelsToGain = (cb: number): number => Math.pow(10, -cb / 200);
