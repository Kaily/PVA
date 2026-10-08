import { mulberry32 } from '../core/math';
import type { ReverbPreset } from '../data/reverbPresets';

/**
 * Builds a stereo impulse response from a preset.
 *
 * Model: a sparse cluster of early reflections followed by a diffuse late
 * field made of decorrelated noise. The late field is split into two bands
 * with different decay times, so the tail gets darker as it dies away — the
 * main cue that separates a hall from a bright "bathroom" reverb.
 *
 * Deterministic (seeded), so a preset always sounds the same.
 */
export function generateImpulse(ctx: BaseAudioContext, preset: ReverbPreset): AudioBuffer {
  const sr = ctx.sampleRate;
  const pre = Math.floor((preset.preDelayMs / 1000) * sr);
  const length = pre + Math.ceil(preset.decay * 1.08 * sr);
  const buffer = ctx.createBuffer(2, length, sr);

  const kLow = 6.908 / preset.decay; // −60 dB after `decay` seconds
  const kHigh = 6.908 / (preset.decay * preset.damping);
  const split = 1 - Math.exp((-2 * Math.PI * preset.crossover) / sr);
  const hp = Math.exp((-2 * Math.PI * 140) / sr); // keep the tail out of the low mud
  const build = Math.max(1, Math.floor((preset.buildMs / 1000) * sr));
  const fadeOut = Math.floor(length * 0.06);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rnd = mulberry32(preset.seed * 9973 + ch * 7919 + 1);

    // --- late field -------------------------------------------------------
    let lowState = 0;
    let hpIn = 0;
    let hpOut = 0;
    for (let i = pre; i < length; i++) {
      const n = i - pre;
      const t = n / sr;
      // Sum of two uniforms: smoother than plain white noise.
      const noise = rnd() + rnd() - 1;
      lowState += (noise - lowState) * split;
      const high = noise - lowState;
      let s = lowState * 1.6 * Math.exp(-kLow * t) + high * Math.exp(-kHigh * t);
      if (n < build) {
        const r = Math.sin((Math.PI / 2) * (n / build));
        s *= r * r;
      }
      // One-pole high-pass.
      hpOut = hp * (hpOut + s - hpIn);
      hpIn = s;
      data[i] = hpOut * 0.5;
    }

    // --- early reflections --------------------------------------------------
    const window = 0.012 + preset.size * 0.075; // seconds
    for (let k = 0; k < preset.earlyCount; k++) {
      const at = 0.003 + rnd() * window;
      const idx = pre + Math.floor(at * sr);
      const amp = (rnd() > 0.5 ? 1 : -1) * preset.earlyGain * (1 - (at / (window + 0.003)) * 0.65);
      if (idx + 2 >= length) continue;
      data[idx] += amp * 0.5;
      data[idx + 1] += amp * 0.35;
      data[idx + 2] += amp * 0.15;
    }

    // --- tidy the very end ----------------------------------------------------
    for (let i = 0; i < fadeOut; i++) {
      data[length - 1 - i] *= i / fadeOut;
    }
  }
  return buffer;
}
