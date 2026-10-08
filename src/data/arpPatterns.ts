/**
 * Arpeggiator settings and the pattern library. Data only.
 */

export type ArpMode = 'up' | 'down' | 'updown' | 'random' | 'order' | 'chord' | 'pattern';

export const ARP_MODES: { id: ArpMode; label: string }[] = [
  { id: 'up', label: 'Up' },
  { id: 'down', label: 'Down' },
  { id: 'updown', label: 'Up / Down' },
  { id: 'random', label: 'Random' },
  { id: 'order', label: 'As played' },
  { id: 'chord', label: 'Chord' },
  { id: 'pattern', label: 'Pattern' },
];

/** Step lengths in clock ticks (24 per quarter note). */
export const ARP_RATES: { id: string; label: string; ticks: number }[] = [
  { id: '1/4', label: '1/4', ticks: 24 },
  { id: '1/8', label: '1/8', ticks: 12 },
  { id: '1/8T', label: '1/8 triplet', ticks: 8 },
  { id: '1/16', label: '1/16', ticks: 6 },
  { id: '1/16T', label: '1/16 triplet', ticks: 4 },
  { id: '1/32', label: '1/32', ticks: 3 },
];

export interface ArpStep {
  /**
   * Which note of the held chord, counted from the lowest (0 = lowest).
   * Indices beyond the chord wrap around an octave higher.
   * null = rest.
   */
  note: number | null;
  /** Extra octaves added to this step. */
  octave?: number;
  /** Velocity factor (1 = as played). */
  accent?: number;
  /** Length factor on top of the gate setting. */
  length?: number;
  /** Play the whole held chord on this step. */
  chord?: boolean;
}

export interface ArpPattern {
  id: string;
  name: string;
  steps: ArpStep[];
}

export const ARP_PATTERNS: ArpPattern[] = [
  {
    id: 'alberti',
    name: 'Alberti',
    steps: [{ note: 0, accent: 1.1 }, { note: 2 }, { note: 1 }, { note: 2 }],
  },
  {
    id: 'broken8',
    name: 'Broken Octave',
    steps: [{ note: 0, accent: 1.15 }, { note: 1 }, { note: 2 }, { note: 0, octave: 1 }, { note: 2 }, { note: 1 }],
  },
  {
    id: 'pulse',
    name: 'Pulse',
    steps: [
      { note: 0, chord: true, accent: 1.15 },
      { note: 0, chord: true, accent: 0.7, length: 0.6 },
      { note: 0, chord: true, accent: 0.85 },
      { note: 0, chord: true, accent: 0.7, length: 0.6 },
    ],
  },
  {
    id: 'offbeat',
    name: 'Off-beat',
    steps: [{ note: 0, accent: 1.1 }, { note: null }, { note: 1, chord: true, accent: 0.85, length: 0.7 }, { note: null }],
  },
  {
    id: 'trance',
    name: 'Gate 16',
    steps: [
      { note: 0, accent: 1.15 },
      { note: 0, octave: 1, accent: 0.75 },
      { note: 1 },
      { note: 0, octave: 1, accent: 0.75 },
      { note: 2, accent: 1.05 },
      { note: 0, octave: 1, accent: 0.75 },
      { note: 1 },
      { note: null },
    ],
  },
  {
    id: 'waltz',
    name: 'Waltz',
    steps: [
      { note: 0, accent: 1.15, length: 1.4 },
      { note: 1, chord: true, accent: 0.8, length: 0.7 },
      { note: 1, chord: true, accent: 0.8, length: 0.7 },
    ],
  },
  {
    id: 'teental',
    name: 'Tihai 3+3+2',
    steps: [
      { note: 0, accent: 1.2 },
      { note: 1 },
      { note: 2 },
      { note: 0, accent: 1.1 },
      { note: 1 },
      { note: 2 },
      { note: 0, octave: 1, accent: 1.15 },
      { note: 2 },
    ],
  },
  {
    id: 'climb',
    name: 'Climb',
    steps: [{ note: 0 }, { note: 1 }, { note: 2 }, { note: 3 }, { note: 1, octave: 1 }, { note: 3 }, { note: 2 }, { note: 1 }],
  },
];

export const arpPatternById = (id: string): ArpPattern => ARP_PATTERNS.find((p) => p.id === id) ?? ARP_PATTERNS[0];

export interface ArpSettings {
  on: boolean;
  mode: ArpMode;
  rate: string;
  /** 1–4 */
  octaves: number;
  /** Note length as a percentage of the step, 10–100. */
  gate: number;
  /** 0–60: how far every second step is pushed back, as a percentage of a step. */
  swing: number;
  /** Keep playing after the keys are released. */
  latch: boolean;
  pattern: string;
}

export const DEFAULT_ARP: ArpSettings = {
  on: false,
  mode: 'up',
  rate: '1/16',
  octaves: 1,
  gate: 70,
  swing: 0,
  latch: false,
  pattern: 'alberti',
};
