/* PVA-61 master stage (AudioWorklet).
 *
 * One processor does three jobs on the stereo master bus so that none of
 * them adds latency:
 *
 *   1. master gain   — smoothed, so the volume knob never zippers
 *   2. peak limiter  — output-referred, instant attack / ~120 ms release,
 *                      NO look-ahead (a look-ahead limiter would add delay
 *                      to every note). It only engages when the summed
 *                      output would otherwise clip.
 *   3. metering      — true sample peak + RMS per channel and the limiter's
 *                      gain reduction, posted to the UI ~50 times a second.
 *
 * Plain JavaScript on purpose: this file is loaded with
 * audioWorklet.addModule() and runs on the audio rendering thread.
 */
class MasterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gain', defaultValue: 0.56, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'ceiling', defaultValue: 0.89, minValue: 0.05, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.env = 1; // limiter gain (1 = no reduction)
    this.gain = -1; // smoothed master gain; -1 = take the first value as-is
    this.release = 1 - Math.exp(-1 / (0.12 * sampleRate));
    this.gainSmooth = 1 - Math.exp(-1 / (0.012 * sampleRate));
    this.reportFrames = Math.max(128, Math.round(sampleRate / 50 / 128) * 128);
    this.count = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.sumL = 0;
    this.sumR = 0;
    this.minEnv = 1;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === 'dispose') this.alive = false;
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    const target = parameters.gain[0];
    const ceiling = parameters.ceiling[0];
    if (this.gain < 0) this.gain = target;

    const inL = input && input[0];
    const inR = input && (input[1] || input[0]);

    let env = this.env;
    let gain = this.gain;
    const release = this.release;
    const smooth = this.gainSmooth;
    let peakL = this.peakL;
    let peakR = this.peakR;
    let sumL = this.sumL;
    let sumR = this.sumR;
    let minEnv = this.minEnv;

    if (inL) {
      for (let i = 0; i < frames; i++) {
        gain += (target - gain) * smooth;
        const l = inL[i] * gain;
        const r = inR[i] * gain;
        const al = l < 0 ? -l : l;
        const ar = r < 0 ? -r : r;
        const a = al > ar ? al : ar;
        const want = a > ceiling ? ceiling / a : 1;
        // Instant attack guarantees the ceiling; release glides back.
        env = want < env ? want : env + (want - env) * release;
        if (env < minEnv) minEnv = env;
        const ol = l * env;
        const or = r * env;
        outL[i] = ol;
        if (outR !== outL) outR[i] = or;
        const pl = ol < 0 ? -ol : ol;
        const pr = or < 0 ? -or : or;
        if (pl > peakL) peakL = pl;
        if (pr > peakR) peakR = pr;
        sumL += ol * ol;
        sumR += or * or;
      }
    } else {
      // No input connected / silent: let the limiter and gain settle.
      gain = target;
      env += (1 - env) * Math.min(1, release * frames);
    }

    this.count += frames;
    if (this.count >= this.reportFrames) {
      this.port.postMessage([peakL, peakR, Math.sqrt(sumL / this.count), Math.sqrt(sumR / this.count), minEnv]);
      this.count = 0;
      peakL = 0;
      peakR = 0;
      sumL = 0;
      sumR = 0;
      minEnv = 1;
    }

    this.env = env;
    this.gain = gain;
    this.peakL = peakL;
    this.peakR = peakR;
    this.sumL = sumL;
    this.sumR = sumR;
    this.minEnv = minEnv;
    return this.alive;
  }
}

registerProcessor('pva-master', MasterProcessor);
