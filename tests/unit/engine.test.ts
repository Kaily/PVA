import { describe, expect, it } from 'vitest';
import { trimBuffer } from '../../src/audio/SampleManager';
import { INSTRUMENTS, QUALITY_TIERS, SAMPLE_SETS } from '../../src/data/instruments';
import { METRONOME_SOUNDS } from '../../src/data/metronomeSounds';
import { REVERB_PRESETS } from '../../src/data/reverbPresets';
import { generateImpulse } from '../../src/audio/reverbIR';

/** Minimal stand-ins for AudioBuffer / BaseAudioContext so the DSP helpers run under Node. */
class FakeBuffer {
  readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
}
const ctx = {
  sampleRate: 48000,
  createBuffer: (ch: number, len: number, sr: number) => new FakeBuffer(ch, len, sr),
} as unknown as BaseAudioContext;

/** 20 ms of silence, then a decaying 220 Hz tone. */
function note(seconds: number, decayTau: number): AudioBuffer {
  const sr = 48000;
  const b = new FakeBuffer(2, Math.floor(seconds * sr), sr);
  const lead = Math.floor(0.02 * sr);
  for (let c = 0; c < 2; c++) {
    const d = b.data[c];
    for (let i = lead; i < d.length; i++) {
      const t = (i - lead) / sr;
      d[i] = Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t / decayTau) * 0.8;
    }
  }
  return b as unknown as AudioBuffer;
}

describe('trimBuffer', () => {
  it('removes leading silence so the attack starts within 2 ms', () => {
    const out = trimBuffer(ctx, note(4, 1), 0.03, null);
    const d = out.getChannelData(0);
    let first = 0;
    while (first < d.length && Math.abs(d[first]) < 0.05) first++;
    expect(first / 48000).toBeLessThan(0.004);
    expect(out.length).toBeLessThan(4 * 48000 - 0.015 * 48000);
  });

  it('shortens a long tail, respects maxSec and ends in silence', () => {
    const src = note(20, 1.2);
    const out = trimBuffer(ctx, src, 0.03, { db: -40, fadeSec: 1.5, maxSec: 10 });
    expect(out.length / 48000).toBeLessThan(8.5); // −40 dB is reached after ~5.5 s, plus the fade
    expect(out.length / 48000).toBeGreaterThan(5);
    const capped = trimBuffer(ctx, note(20, 30), 0.03, { db: -40, fadeSec: 1.5, maxSec: 6 });
    expect(capped.length / 48000).toBeCloseTo(6, 1);
    for (const b of [out, capped]) {
      const d = b.getChannelData(1);
      expect(Math.abs(d[d.length - 1])).toBeLessThan(1e-4);
    }
  });

  it('keeps the full length when no tail trim is requested', () => {
    const out = trimBuffer(ctx, note(6, 2), 0.03, null);
    expect(out.length / 48000).toBeGreaterThan(5.95);
  });
});

describe('reverb impulse responses', () => {
  it('are finite, stereo, decorrelated and as long as their decay', () => {
    for (const preset of REVERB_PRESETS) {
      const ir = generateImpulse(ctx, preset);
      expect(ir.numberOfChannels).toBe(2);
      expect(ir.length / 48000).toBeGreaterThan(preset.decay);
      const l = ir.getChannelData(0);
      const r = ir.getChannelData(1);
      let same = 0;
      let energyHead = 0;
      let energyTail = 0;
      for (let i = 0; i < l.length; i++) {
        expect(Number.isFinite(l[i])).toBe(true);
        if (l[i] === r[i]) same++;
        if (i < l.length / 4) energyHead += l[i] * l[i];
        else if (i > (l.length * 3) / 4) energyTail += l[i] * l[i];
      }
      expect(same / l.length).toBeLessThan(0.2);
      expect(energyTail).toBeLessThan(energyHead * 0.01); // it really decays
    }
  });

  it('is deterministic', () => {
    const a = generateImpulse(ctx, REVERB_PRESETS[0]).getChannelData(0);
    const b = generateImpulse(ctx, REVERB_PRESETS[0]).getChannelData(0);
    expect(Array.from(a.slice(0, 2000))).toEqual(Array.from(b.slice(0, 2000)));
  });
});

describe('instrument metadata', () => {
  it('every instrument points at a defined sample set and sane ranges', () => {
    for (const inst of INSTRUMENTS) {
      const set = SAMPLE_SETS[inst.sampleSet];
      expect(set).toBeDefined();
      expect(inst.range[0]).toBeLessThan(inst.range[1]);
      expect(set.roots[0]).toBeLessThanOrEqual(inst.range[0]);
      expect(set.roots[set.roots.length - 1]).toBeGreaterThanOrEqual(inst.range[1]);
      // layers ordered from soft to loud, loudest at 0 dB
      const levels = set.layers.map((l) => l.levelDb);
      expect([...levels].sort((a, b) => a - b)).toEqual(levels);
      expect(levels[levels.length - 1]).toBe(0);
    }
  });

  it('quality tiers only reference layers that exist', () => {
    const ids = SAMPLE_SETS['salamander-grand'].layers.map((l) => l.id);
    for (const tier of Object.values(QUALITY_TIERS)) {
      expect(tier.layers.length).toBeGreaterThan(0);
      for (const layer of tier.layers) expect(ids).toContain(layer);
      expect(tier.layers).toContain(tier.coreLayer);
    }
  });

  it('has unique tone numbers and metronome / reverb ids', () => {
    const unique = (xs: (string | number)[]): boolean => new Set(xs).size === xs.length;
    expect(unique(INSTRUMENTS.map((i) => i.number))).toBe(true);
    expect(unique(INSTRUMENTS.map((i) => i.id))).toBe(true);
    expect(unique(METRONOME_SOUNDS.map((m) => m.id))).toBe(true);
    expect(unique(REVERB_PRESETS.map((r) => r.id))).toBe(true);
  });
});

describe('balanceStereo', () => {
  it('moves the image to the target and keeps the loudness', async () => {
    const { balanceStereo } = await import('../../src/audio/SampleManager');
    const b = new FakeBuffer(2, 48000, 48000);
    for (let i = 0; i < b.length; i++) {
      const s = Math.sin(i * 0.05);
      b.data[0][i] = s * 0.1; // left 12 dB quieter than right
      b.data[1][i] = s * 0.4;
    }
    const power = (d: Float32Array): number => d.reduce((a, v) => a + v * v, 0);
    const before = power(b.data[0]) + power(b.data[1]);
    balanceStereo(b as unknown as AudioBuffer, 2);
    const after = power(b.data[0]) + power(b.data[1]);
    expect(10 * Math.log10(power(b.data[1]) / power(b.data[0]))).toBeCloseTo(2, 1);
    expect(after / before).toBeCloseTo(1, 3);
  });
});
