/**
 * Metronome voices. All of them are synthesised (see audio/Metronome.ts);
 * the numbers below describe each click.
 */
export interface ClickSpec {
  /** Oscillator pitch, Hz. */
  freq: number;
  /** Pitch at the very start of the click (drops to `freq`), Hz. */
  startFreq: number;
  /** Amplitude decay time constant, seconds. */
  decay: number;
  wave: OscillatorType;
  /** Level of the short noise transient mixed in (0 = none). */
  noise: number;
  gain: number;
}

export interface MetronomeSound {
  id: string;
  name: string;
  accent: ClickSpec;
  beat: ClickSpec;
}

export const METRONOME_SOUNDS: MetronomeSound[] = [
  {
    id: 'click',
    name: 'Click',
    accent: { freq: 1760, startFreq: 2400, decay: 0.012, wave: 'triangle', noise: 0.5, gain: 1 },
    beat: { freq: 1175, startFreq: 1500, decay: 0.01, wave: 'triangle', noise: 0.35, gain: 0.7 },
  },
  {
    id: 'wood',
    name: 'Wood Block',
    accent: { freq: 1050, startFreq: 1350, decay: 0.03, wave: 'sine', noise: 0.25, gain: 1 },
    beat: { freq: 780, startFreq: 980, decay: 0.028, wave: 'sine', noise: 0.2, gain: 0.75 },
  },
  {
    id: 'beep',
    name: 'Beep',
    accent: { freq: 1000, startFreq: 1000, decay: 0.045, wave: 'sine', noise: 0, gain: 0.9 },
    beat: { freq: 800, startFreq: 800, decay: 0.04, wave: 'sine', noise: 0, gain: 0.65 },
  },
  {
    id: 'bell',
    name: 'Bell',
    accent: { freq: 2093, startFreq: 2093, decay: 0.22, wave: 'sine', noise: 0.15, gain: 0.85 },
    beat: { freq: 1175, startFreq: 1500, decay: 0.01, wave: 'triangle', noise: 0.35, gain: 0.7 },
  },
];

export const metronomeSoundById = (id: string): MetronomeSound => METRONOME_SOUNDS.find((s) => s.id === id) ?? METRONOME_SOUNDS[0];
