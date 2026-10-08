import { describe, expect, it } from 'vitest';
import { additiveLoop, estimateF0, fft, midiToHz, modal, normalize, pluckString } from '../../src/audio/models/dsp';
import { MODELS, TABLA_STROKES } from '../../src/audio/models/indianModels';
import { decayDuration, envelopeLevel, modEnvelopeLevel, pitchScoop } from '../../src/audio/voiceTypes';

const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref);

/** Frequency of the strongest spectral line near `expected`, by a direct Fourier sum. */
function lineNear(data: Float32Array, sampleRate: number, expected: number, start = 0): number {
  const n = Math.min(data.length - start, 1 << 15);
  const power = (f: number): number => {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * f) / sampleRate;
    for (let i = 0; i < n; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re += data[start + i] * hann * Math.cos(w * i);
      im += data[start + i] * hann * Math.sin(w * i);
    }
    return re * re + im * im;
  };
  let best = expected;
  let bestPower = -1;
  for (let c = -80; c <= 80; c += 1) {
    const f = expected * Math.pow(2, c / 1200);
    const p = power(f);
    if (p > bestPower) {
      bestPower = p;
      best = f;
    }
  }
  return best;
}

describe('DSP helpers', () => {
  it('fft finds a sine and its inverse restores the signal', () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / n);
    const original = re.slice();
    fft(re, im);
    let peak = 0;
    for (let k = 1; k < n / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[peak], im[peak])) peak = k;
    expect(peak).toBe(37);
    fft(re, im, true); // the inverse is not scaled: divide by n
    for (let i = 0; i < n; i += 37) expect(re[i] / n).toBeCloseTo(original[i], 3);
  });

  it('additive loops are seamless and exactly in tune', () => {
    for (const note of [40, 57, 69, 84]) {
      const freq = midiToHz(note);
      const tone = additiveLoop(freq, [
        { ratio: 1, amplitude: 1 },
        { ratio: 2, amplitude: 0.5 },
        { ratio: 3, amplitude: 0.25 },
      ]);
      // the loop holds whole cycles: the wave continues across the seam without a step
      const d = tone.data;
      const n = d.length;
      const stepInside = Math.abs(d[1] - d[0]);
      const stepAtSeam = Math.abs(d[0] - d[n - 1]);
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
      expect(stepAtSeam).toBeLessThan(Math.max(stepInside * 4, peak * 0.05));
      expect(Math.abs(cents(lineNear(d, tone.sampleRate, freq), freq))).toBeLessThan(2);
      expect(Math.abs(tone.sampleRate - 44100) / 44100).toBeLessThan(0.12);
    }
  });

  it('plucked strings can be tuned from their measured pitch', () => {
    for (const note of [45, 60, 76]) {
      const freq = midiToHz(note);
      const data = pluckString({ freq, sampleRate: 44100, seconds: 1.2, t60: 4, damping: 0.2, position: 0.2, brightness: 0.7, jawari: 0, seed: 3 });
      const measured = estimateF0(data, 44100, freq);
      // the raw string is already close …
      expect(Math.abs(cents(measured, freq))).toBeLessThan(25);
      // … and the estimate agrees with the spectrum, so correcting by it lands on pitch
      const line = lineNear(data, 44100, freq, 4410);
      expect(Math.abs(cents(measured, line))).toBeLessThan(4);
      expect(data.some((v) => !Number.isFinite(v))).toBe(false);
    }
  });

  it('modal synthesis decays and normalize sets the peak', () => {
    const data = modal([{ freq: 440, amplitude: 1, t60: 0.5 }], 44100, 1);
    const rms = (a: number, b: number): number => Math.sqrt(data.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
    expect(rms(0, 4410)).toBeGreaterThan(rms(22050, 26460) * 5);
    normalize(data, 0.5);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.5, 3);
  });
});

describe('Indian instrument models', () => {
  const pitched = ['harmonium', 'shrutibox', 'pungi', 'bansuri', 'tanpura', 'veena', 'sarod', 'santoor', 'swarmandal', 'jaltarang', 'tablatarang'];

  it('every model renders finite, non-silent audio', () => {
    for (const [id, model] of Object.entries(MODELS)) {
      const note = model.kit ? 60 : 62;
      for (let layer = 0; layer < model.layers.length; layer++) {
        const r = model.render(note, layer);
        let peak = 0;
        for (let i = 0; i < r.data.length; i++) {
          const v = r.data[i];
          if (!Number.isFinite(v)) throw new Error(`${id}: non-finite sample`);
          peak = Math.max(peak, Math.abs(v));
        }
        expect(peak, `${id} layer ${layer}`).toBeGreaterThan(0.05);
        expect(peak, `${id} layer ${layer}`).toBeLessThanOrEqual(1);
        expect(r.sampleRate).toBeGreaterThan(20000);
      }
      expect(model.layers[0]).toBe(1);
      const env = model.envelope(note);
      expect(env.releaseTau).toBeGreaterThan(0);
    }
  });

  it('pitched models sound the note that is asked for', () => {
    for (const id of pitched) {
      const model = MODELS[id];
      for (const note of [57, 69]) {
        const r = model.render(note, model.layers.length - 1);
        const freq = midiToHz(note);
        const measured = lineNear(r.data, r.sampleRate, freq, Math.min(r.data.length >> 2, Math.floor(r.sampleRate * 0.1)));
        expect(Math.abs(cents(measured, freq)), `${id} at note ${note}: ${measured.toFixed(2)} Hz`).toBeLessThan(6);
      }
    }
  }, 60_000);

  it('louder layers of a model are brighter or equal, never missing', () => {
    for (const model of Object.values(MODELS)) {
      for (let i = 1; i < model.layers.length; i++) expect(model.layers[i]).toBeGreaterThan(model.layers[i - 1]);
    }
  });

  it('tabla: twelve strokes, one per pitch class', () => {
    expect(TABLA_STROKES.length).toBe(12);
    expect(new Set(TABLA_STROKES.map((s) => s.bol)).size).toBe(12);
    const tabla = MODELS.tabla;
    expect(tabla.kit).toBe(true);
    const a = tabla.render(60, 0).data;
    const b = tabla.render(64, 0).data;
    let different = false;
    for (let i = 0; i < Math.min(a.length, b.length); i += 50) if (Math.abs(a[i] - b[i]) > 1e-4) different = true;
    expect(different).toBe(true);
  });
});

describe('envelopes', () => {
  it('volume envelope: delay, attack, hold, decay to sustain', () => {
    const env = { delay: 0.1, attack: 0.2, hold: 0.3, decay: 1, sustain: 0.1, releaseTau: 0.1 };
    expect(envelopeLevel(env, 0.05)).toBe(0);
    expect(envelopeLevel(env, 0.2)).toBeCloseTo(0.5, 6);
    expect(envelopeLevel(env, 0.45)).toBe(1);
    // decay is 100 dB per `decay` seconds: 20 dB after 0.2 s
    expect(envelopeLevel(env, 0.6 + 0.1)).toBeCloseTo(Math.pow(10, -0.5), 4);
    expect(envelopeLevel(env, 5)).toBe(0.1);
    expect(decayDuration(env)).toBeCloseTo(0.2, 6);
    expect(decayDuration({ ...env, sustain: 1 })).toBe(0);
  });

  it('modulation envelope: linear, lasting offset when sustain is 1', () => {
    const env = { delay: 0, attack: 0.1, hold: 0.1, decay: 1, sustain: 0.25, release: 0.2 };
    expect(modEnvelopeLevel(env, 0.05)).toBeCloseTo(0.5, 6);
    expect(modEnvelopeLevel(env, 0.15)).toBe(1);
    expect(modEnvelopeLevel(env, 0.7)).toBeCloseTo(0.5, 6);
    expect(modEnvelopeLevel(env, 9)).toBe(0.25);
    expect(modEnvelopeLevel({ ...env, sustain: 1 }, 9)).toBe(1);
    const scoop = pitchScoop(-30, 0.08);
    expect(modEnvelopeLevel(scoop.env, 0)).toBe(1); // starts fully off pitch …
    expect(modEnvelopeLevel(scoop.env, 0.08)).toBe(0); // … and has arrived after 80 ms
  });
});
