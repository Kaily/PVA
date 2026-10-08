import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  absoluteCentsToHz,
  applyModulators,
  centibelsToGain,
  GEN,
  GEN_COUNT,
  SoundFont,
  timecentsToSeconds,
} from '../../src/audio/sf2/SoundFont';
import { SF2_PRESETS } from '../../src/data/sf2Presets.generated';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'soundfonts', 'GeneralUser-GS.sf2');
const present = existsSync(file);

describe('SoundFont units', () => {
  it('converts timecents, absolute cents and centibels', () => {
    expect(timecentsToSeconds(0)).toBe(1);
    expect(timecentsToSeconds(1200)).toBe(2);
    expect(timecentsToSeconds(-12000)).toBe(0); // "instant"
    expect(absoluteCentsToHz(6900)).toBeCloseTo(440, 0);
    expect(centibelsToGain(0)).toBe(1);
    expect(centibelsToGain(200)).toBeCloseTo(0.1, 6); // 20 dB
  });
});

describe.skipIf(!present)('GeneralUser GS SoundFont', () => {
  const load = (): SoundFont => {
    const bytes = readFileSync(file);
    return new SoundFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  const font = present ? load() : (null as unknown as SoundFont);
  const preset = (bank: number, program: number) => {
    const p = font.findPreset(bank, program);
    if (!p) throw new Error(`preset ${bank}:${program} missing`);
    return p;
  };
  const regionsFor = (bank: number, program: number, key: number, velocity: number) =>
    font.regions(preset(bank, program).index).filter((r) => key >= r.keyLo && key <= r.keyHi && velocity >= r.velLo && velocity <= r.velHi);

  it('parses the file: presets, samples and sample data', () => {
    expect(font.presets.length).toBeGreaterThan(250);
    expect(font.samples.length).toBeGreaterThan(800);
    expect(font.sampleData.length).toBeGreaterThan(10_000_000);
    for (const s of font.samples) {
      expect(s.end).toBeGreaterThan(s.start);
      expect(s.end).toBeLessThanOrEqual(font.sampleData.length);
      expect(s.sampleRate).toBeGreaterThan(4000);
    }
  });

  it('the generated tone table matches the file', () => {
    for (const [bank, program, name] of SF2_PRESETS) {
      const p = font.findPreset(bank, program);
      expect(p, `${bank}:${program} ${name}`).toBeDefined();
      expect(p!.name).toBe(name);
    }
  });

  it('every preset in the tone table has playable regions across the keyboard', () => {
    for (const [bank, program, name] of SF2_PRESETS) {
      const regions = font.regions(preset(bank, program).index);
      expect(regions.length, name).toBeGreaterThan(0);
      for (const r of regions) {
        expect(r.keyLo).toBeLessThanOrEqual(r.keyHi);
        expect(r.velLo).toBeLessThanOrEqual(r.velHi);
        expect(r.sample).toBeGreaterThanOrEqual(0);
        expect(r.sample).toBeLessThan(font.samples.length);
        expect(r.gens.length).toBe(GEN_COUNT);
      }
      if (bank !== 128 && bank !== 120 && program < 120) {
        // melodic presets: no hole in the playing range of a 61-key keyboard
        for (let key = 36; key <= 96; key += 6) {
          const hit = regions.some((r) => key >= r.keyLo && key <= r.keyHi && 100 >= r.velLo && 100 <= r.velHi);
          expect(hit, `${name} has no sound at key ${key}`).toBe(true);
        }
      }
    }
  });

  it('merges instrument and preset generators (preset values are added)', () => {
    // Ocarina: the low zone is tuned 7 semitones down and lifted back by the modulation envelope.
    const [zone] = regionsFor(0, 79, 60, 100);
    expect(zone.gens[GEN.coarseTune]).toBe(-7);
    expect(zone.gens[GEN.modEnvToPitch]).toBe(700);
    expect(zone.gens[GEN.sustainModEnv]).toBe(0); // stays at full level → the offset lasts
    // Train: the preset adds 20 dB of attenuation to whatever the instrument zones say
    const train = regionsFor(6, 125, 60, 100);
    expect(train.length).toBe(2);
    for (const r of train) expect(r.gens[GEN.initialAttenuation]).toBeGreaterThanOrEqual(200);
    expect(train.map((r) => r.gens[GEN.pan]).sort((a, b) => a - b)).toEqual([-500, 500]);
  });

  it('velocity makes a note louder (default modulator, 0.4 attenuation scale)', () => {
    const [zone] = regionsFor(0, 0, 60, 100);
    const out = new Float64Array(GEN_COUNT);
    const level = (velocity: number): number => {
      applyModulators(zone, { key: 60, velocity }, out);
      return centibelsToGain(Math.max(0, out[GEN.initialAttenuation]));
    };
    expect(level(127)).toBeGreaterThan(level(64));
    expect(level(64)).toBeGreaterThan(level(20));
    // about 12 dB between velocity 127 and 64 (40·log10 law), not more than 20
    const db = 20 * Math.log10(level(127) / level(64));
    expect(db).toBeGreaterThan(8);
    expect(db).toBeLessThan(20);
  });

  it('drum kit: one sound per key, open and closed hi-hat share an exclusive class', () => {
    const kit = (key: number) => regionsFor(128, 0, key, 100);
    expect(kit(36).length).toBeGreaterThan(0); // kick
    expect(kit(38).length).toBeGreaterThan(0); // snare
    const closed = kit(42)[0].gens[GEN.exclusiveClass];
    const open = kit(46)[0].gens[GEN.exclusiveClass];
    expect(closed).toBeGreaterThan(0);
    expect(open).toBe(closed);
    expect(kit(36)[0].sample).not.toBe(kit(38)[0].sample);
  });
});
