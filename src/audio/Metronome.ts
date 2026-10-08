import { clamp } from '../core/math';
import { metronomeSoundById, type ClickSpec, type MetronomeSound } from '../data/metronomeSounds';
import type { Beat, Clock } from './Clock';

/**
 * Metronome — sample-accurate click on every beat of the Clock.
 *
 * `beats` is the bar length used for the accent: 1–16 accents the first beat
 * of every bar, 0 switches the accent off (every click the same), exactly as
 * on a hardware keyboard. Clicks are synthesised, so there is nothing to load.
 */
export class Metronome {
  private on = false;
  private beats = 4;
  private sound: MetronomeSound = metronomeSoundById('click');
  private noise: AudioBuffer | null = null;
  private barStart = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly clock: Clock,
    private readonly out: AudioNode,
  ) {
    clock.events.on('beat', (beat) => this.onBeat(beat));
  }

  get isOn(): boolean {
    return this.on;
  }

  get beatsPerBar(): number {
    return this.beats;
  }

  setOn(on: boolean): void {
    if (this.on === on) return;
    this.on = on;
    if (on) {
      // The bar starts on the next beat, whether or not the clock was already running.
      this.barStart = -1;
      this.clock.acquire('metronome');
    } else {
      this.clock.release('metronome');
    }
  }

  setBeats(beats: number): void {
    this.beats = clamp(Math.round(beats), 0, 16);
    // Start a fresh bar at the next beat so the accent lands where expected.
    this.barStart = -1;
  }

  setSound(id: string): void {
    this.sound = metronomeSoundById(id);
  }

  /** Position of a beat inside the bar (0 = accented beat). */
  beatInBar(index: number): number {
    return this.beats > 0 ? (((index - this.barStart) % this.beats) + this.beats) % this.beats : -1;
  }

  private onBeat(beat: Beat): void {
    if (!this.on) return;
    if (this.barStart < 0) this.barStart = beat.index;
    const accent = this.beats > 0 && this.beatInBar(beat.index) === 0;
    this.click(accent ? this.sound.accent : this.sound.beat, beat.time);
  }

  private click(spec: ClickSpec, time: number): void {
    const ctx = this.ctx;
    const length = spec.decay * 7 + 0.01;

    const osc = ctx.createOscillator();
    osc.type = spec.wave;
    osc.frequency.setValueAtTime(spec.startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(spec.freq, time + Math.min(0.012, spec.decay));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(spec.gain, time + 0.0006);
    env.gain.setTargetAtTime(0, time + 0.0006, spec.decay);
    osc.connect(env);
    env.connect(this.out);
    osc.start(time);
    osc.stop(time + length);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };

    if (spec.noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = spec.freq * 2.2;
      filter.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(spec.noise * spec.gain, time);
      g.gain.setTargetAtTime(0, time, 0.0035);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.out);
      src.start(time);
      src.stop(time + 0.04);
      src.onended = () => {
        src.disconnect();
        filter.disconnect();
        g.disconnect();
      };
    }
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const length = Math.floor(this.ctx.sampleRate * 0.05);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
}
