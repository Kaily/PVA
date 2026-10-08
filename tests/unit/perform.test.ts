import { describe, expect, it } from 'vitest';
import { builtInMakeupDb } from '../../src/audio/dsp/compressorMakeup';
import { MODELS } from '../../src/audio/models/indianModels';
import { ARP_PATTERNS, ARP_RATES, DEFAULT_ARP, type ArpSettings } from '../../src/data/arpPatterns';
import {
  CHORUS_PRESETS,
  DELAY_PRESETS,
  DSP_PRESETS,
  DSP_TYPES,
  dspById,
  EQ_BANDS,
  EQ_GAIN_RANGE,
  EQ_PRESETS,
} from '../../src/data/effectPresets';
import { FIRST_KEY, LAST_KEY } from '../../src/data/keyboardLayout';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  DEFAULT_LAYER_TONE_ID,
  DEFAULT_LOWER_TONE_ID,
  DEFAULT_TONE_ID,
  MODEL_BANK,
  searchTones,
  toneById,
  toneByProgram,
  TONES,
  tonesInCategory,
} from '../../src/data/tones';
import { arpSequence } from '../../src/music/Arpeggiator';
import { detectChord } from '../../src/music/ChordDetector';
import { HARMONY_MODES, harmonize } from '../../src/music/Harmonizer';
import { defaultPreferences, initialState } from '../../src/state/appState';
import { browserList } from '../../src/state/browser';

describe('tone table', () => {
  it('ids are unique and numbers run 1…n in browser order', () => {
    expect(new Set(TONES.map((t) => t.id)).size).toBe(TONES.length);
    TONES.forEach((t, i) => expect(t.number).toBe(i + 1));
    expect(TONES.length).toBeGreaterThan(280);
    // categories appear in panel order
    const order = TONES.map((t) => CATEGORY_ORDER.indexOf(t.category));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
  });

  it('every category has tones and a panel legend', () => {
    expect(CATEGORY_ORDER.length).toBe(18);
    for (const c of CATEGORY_ORDER) {
      expect(tonesInCategory(c).filter((t) => t.available).length, c).toBeGreaterThan(0);
      expect(CATEGORY_LABEL[c].length).toBeLessThanOrEqual(8);
    }
  });

  it('a tone is either backed by a sound engine or marked unavailable with a reason', () => {
    for (const t of TONES) {
      if (t.available) {
        if (t.engine === 'sf2') expect(t.sf2, t.name).toBeDefined();
        if (t.engine === 'model') expect(MODELS[t.model ?? ''], t.name).toBeDefined();
        expect(t.range[0]).toBeLessThan(t.range[1]);
      } else {
        expect(t.unavailableReason && t.unavailableReason.length > 10, t.name).toBe(true);
        expect(t.model, t.name).toBeUndefined();
      }
      expect(t.gainDb).toBeLessThanOrEqual(6);
      expect(t.reverbSend).toBeGreaterThanOrEqual(0);
      expect(t.reverbSend).toBeLessThanOrEqual(1);
    }
    expect(TONES.filter((t) => !t.available).map((t) => t.name).sort()).toEqual(['Esraj', 'Sarangi']);
  });

  it('the Indian bank has the instruments the specification names', () => {
    const names = tonesInCategory('INDIAN').map((t) => t.name);
    for (const n of ['Harmonium', 'Sitar', 'Tanpura', 'Veena', 'Sarod', 'Santoor', 'Bansuri', 'Shehnai', 'Tabla']) expect(names).toContain(n);
  });

  it('factory tones exist; MIDI program numbers are unambiguous', () => {
    for (const id of [DEFAULT_TONE_ID, DEFAULT_LAYER_TONE_ID, DEFAULT_LOWER_TONE_ID]) expect(toneById(id)?.available, id).toBe(true);
    expect(toneByProgram(0, 0)?.id).toBe(DEFAULT_TONE_ID);
    expect(toneByProgram(0, 73)?.name).toBe('Flute');
    expect(toneByProgram(MODEL_BANK, 0)?.name).toBe('Harmonium');
    expect(toneByProgram(99, 73)?.name).toBe('Flute'); // unknown bank falls back to bank 0
    const seen = new Set<string>();
    for (const t of TONES.filter((x) => x.available)) {
      const key = `${t.bank}:${t.program}`;
      expect(seen.has(key), `${key} is used twice (${t.name})`).toBe(false);
      seen.add(key);
    }
    // drum kits and effects keep their keys when the keyboard is transposed
    expect(tonesInCategory('DRUM KIT').every((t) => t.fixedPitch)).toBe(true);
    expect(toneById('tabla')?.fixedPitch).toBe(true);
  });

  it('search: words, numbers, categories and tags', () => {
    expect(searchTones('')).toEqual([]);
    expect(searchTones('concert grand')[0].id).toBe(DEFAULT_TONE_ID);
    expect(searchTones('001').map((t) => t.number)).toContain(1);
    expect(searchTones('42')[0].number).toBe(42); // numeric entry: the exact number comes first
    expect(searchTones('7')[0].number).toBe(7);
    expect(searchTones('peti').map((t) => t.name)).toContain('Harmonium'); // tag
    expect(searchTones('indian').length).toBe(tonesInCategory('INDIAN').length);
    expect(searchTones('zzzz')).toEqual([]);
    expect(searchTones('GRAND piano').every((t) => /grand/i.test(`${t.name} ${t.tags.join(' ')}`))).toBe(true);
  });

  it('browser lists: category, favourites (by number), recent (latest first), search', () => {
    const base = { browserTab: 'category' as const, browserCategory: 'INDIAN' as const, browserQuery: '', favorites: ['tabla', 'concert-grand', 'gone'], recent: ['tabla', 'sarod'] };
    expect(browserList(base).length).toBe(tonesInCategory('INDIAN').length);
    expect(browserList({ ...base, browserTab: 'favorites' }).map((t) => t.id)).toEqual(['concert-grand', 'tabla']);
    expect(browserList({ ...base, browserTab: 'recent' }).map((t) => t.id)).toEqual(['tabla', 'sarod']);
    expect(browserList({ ...base, browserTab: 'search', browserQuery: 'veena' }).map((t) => t.id)).toEqual(['veena']);
  });
});

describe('factory set-up', () => {
  it('starts with the grand on Upper 1, layer / split / arpeggio / harmony off', () => {
    const s = initialState(defaultPreferences());
    expect(s.parts.upper1.toneId).toBe(DEFAULT_TONE_ID);
    expect(s.layerOn || s.splitOn || s.arp.on || s.harmonyOn).toBe(false);
    expect(s.splitPoint).toBeGreaterThan(FIRST_KEY);
    expect(s.splitPoint).toBeLessThanOrEqual(LAST_KEY);
    expect(s.eqUser.length).toBe(EQ_BANDS.length);
    expect(dspById(s.parts.upper1.dspId)).toBeDefined();
  });
});

describe('effect presets', () => {
  it('EQ curves stay inside the band limits', () => {
    expect(EQ_BANDS.length).toBe(4);
    expect(EQ_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(EQ_PRESETS[0].gains.every((g) => g === 0)).toBe(true);
    for (const p of EQ_PRESETS) {
      expect(p.gains.length).toBe(4);
      for (const g of p.gains) expect(Math.abs(g)).toBeLessThanOrEqual(EQ_GAIN_RANGE);
    }
    for (const b of EQ_BANDS) {
      expect(b.freq).toBeGreaterThanOrEqual(b.minFreq);
      expect(b.freq).toBeLessThanOrEqual(b.maxFreq);
    }
  });

  it('DSP library: 50+ numbered presets over 8 algorithms', () => {
    expect(DSP_PRESETS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(DSP_PRESETS.map((p) => p.id)).size).toBe(DSP_PRESETS.length);
    DSP_PRESETS.forEach((p, i) => expect(p.number).toBe(i + 1));
    for (const type of DSP_TYPES) expect(DSP_PRESETS.some((p) => p.type === type), type).toBe(true);
    for (const p of DSP_PRESETS) for (const v of Object.values(p.params)) expect(Number.isFinite(v)).toBe(true);
  });

  it('compressor: the node\'s own make-up gain is known, so presets can cancel it', () => {
    // values measured in Chromium with a −60 dBFS tone (far below the threshold)
    expect(builtInMakeupDb(-18, 8, 2.5)).toBeCloseTo(5.12, 1);
    expect(builtInMakeupDb(-30, 8, 6)).toBeCloseTo(13.34, 1);
    expect(builtInMakeupDb(-20, 0, 4)).toBeCloseTo(9.0, 1); // hard knee: 0.6 · 20 · (1 − 1/4)
    expect(builtInMakeupDb(-24, 30, 12)).toBeCloseTo(3.66, 1);
    for (const p of DSP_PRESETS.filter((x) => x.type === 'compressor')) {
      // what a quiet signal gets is the preset's own make-up value — never more than 10 dB
      expect(p.params.makeup).toBeGreaterThanOrEqual(0);
      expect(p.params.makeup).toBeLessThanOrEqual(10);
    }
  });

  it('chorus and delay presets are sane', () => {
    for (const p of CHORUS_PRESETS) expect(p.voices.length).toBeGreaterThan(0);
    for (const p of DELAY_PRESETS) {
      // the feedback loop must lose energy on every pass
      expect(p.feedback + p.cross).toBeLessThan(0.9);
      expect(p.left).toBeGreaterThan(0);
      expect(p.right).toBeGreaterThan(0);
    }
  });
});

describe('arpeggiator sequences', () => {
  const held = [
    { key: 64, velocity: 90 },
    { key: 60, velocity: 80 },
    { key: 67, velocity: 100 },
  ];
  const arp = (patch: Partial<ArpSettings>): ArpSettings => ({ ...DEFAULT_ARP, on: true, ...patch });
  const keys = (steps: { key: number }[][]): number[][] => steps.map((s) => s.map((n) => n.key));

  it('up, down, up/down and as-played', () => {
    expect(keys(arpSequence(held, arp({ mode: 'up', octaves: 1 })))).toEqual([[60], [64], [67]]);
    expect(keys(arpSequence(held, arp({ mode: 'down', octaves: 1 })))).toEqual([[67], [64], [60]]);
    expect(keys(arpSequence(held, arp({ mode: 'updown', octaves: 1 })))).toEqual([[60], [64], [67], [64]]);
    expect(keys(arpSequence(held, arp({ mode: 'order', octaves: 1 })))).toEqual([[64], [60], [67]]);
  });

  it('octave range extends the pattern upwards', () => {
    expect(keys(arpSequence(held, arp({ mode: 'up', octaves: 2 })))).toEqual([[60], [64], [67], [72], [76], [79]]);
    expect(arpSequence(held, arp({ mode: 'updown', octaves: 3 })).length).toBe(9 + 7);
  });

  it('chord mode plays all keys together; random stays inside the chord', () => {
    expect(keys(arpSequence(held, arp({ mode: 'chord', octaves: 1 })))).toEqual([[60, 64, 67]]);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const random = arpSequence(held, arp({ mode: 'random', octaves: 1 }), rnd);
    expect(random.length).toBe(3);
    for (const step of random) expect([60, 64, 67]).toContain(step[0].key);
  });

  it('every pattern produces steps for one, three and five held keys', () => {
    expect(ARP_PATTERNS.length).toBeGreaterThanOrEqual(8);
    for (const p of ARP_PATTERNS) {
      for (const n of [1, 3, 5]) {
        const chord = Array.from({ length: n }, (_, i) => ({ key: 60 + i * 3, velocity: 90 }));
        const steps = arpSequence(chord, arp({ mode: 'pattern', pattern: p.id, octaves: 1 }));
        expect(steps.length, p.id).toBe(p.steps.length);
        expect(steps.some((s) => s.length > 0), p.id).toBe(true);
        for (const step of steps) for (const note of step) {
          expect(note.key).toBeGreaterThanOrEqual(0);
          expect(note.key).toBeLessThanOrEqual(127);
          expect(note.velocity).toBeGreaterThanOrEqual(1);
          expect(note.velocity).toBeLessThanOrEqual(127);
        }
      }
    }
    expect(arpSequence([], arp({ mode: 'up' }))).toEqual([]);
  });

  it('rates are whole numbers of clock ticks (24 per beat)', () => {
    for (const r of ARP_RATES) expect(Number.isInteger(r.ticks) && r.ticks > 0).toBe(true);
    expect(ARP_RATES.find((r) => r.id === '1/8')?.ticks).toBe(12);
    expect(ARP_RATES.find((r) => r.id === '1/8T')?.ticks).toBe(8);
  });
});

describe('auto harmonize', () => {
  const C = detectChord([48, 52, 55])!;
  const Am7 = detectChord([45, 48, 52, 55])!;

  it('adds chord tones below the melody, never a second away', () => {
    for (let melody = 60; melody <= 84; melody++) {
      const [duet] = harmonize('duet', melody, C);
      expect(duet).toBeLessThanOrEqual(melody - 3);
      expect([0, 4, 7]).toContain(duet % 12);
      const trio = harmonize('trio', melody, C);
      expect(trio.length).toBe(2);
      expect(new Set(trio).size).toBe(2);
      for (const n of trio) expect([0, 4, 7]).toContain(n % 12);
    }
  });

  it('block, four-way close, country and octave', () => {
    expect(harmonize('octave', 72, null)).toEqual([60]);
    expect(harmonize('octave', 5, null)).toEqual([]);
    const block = harmonize('block', 76, C);
    expect(block).toContain(64); // the melody doubled an octave below
    expect(block.every((n) => n < 76)).toBe(true);
    const four = harmonize('fourway', 76, Am7);
    expect(four.length).toBe(3);
    expect(four.every((n) => n < 76 && n > 76 - 12)).toBe(true);
    const [above] = harmonize('country', 72, C);
    expect(above).toBeGreaterThan(72);
    expect([0, 4, 7]).toContain(above % 12);
  });

  it('needs a chord (except octave) and lists every mode on the panel', () => {
    for (const m of HARMONY_MODES) {
      if (m.id !== 'octave') expect(harmonize(m.id, 72, null)).toEqual([]);
      expect(harmonize(m.id, 72, C).length).toBeGreaterThan(0);
    }
  });
});
