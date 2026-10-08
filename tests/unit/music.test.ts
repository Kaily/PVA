import { describe, expect, it } from 'vitest';
import { detectChord } from '../../src/music/ChordDetector';
import { TapTempo } from '../../src/music/TapTempo';
import { isBlackKey, keyLabel, noteName } from '../../src/music/notes';

const name = (notes: number[]): string | null => detectChord(notes)?.name ?? null;

describe('ChordDetector', () => {
  it('recognises the basic chord types from C', () => {
    expect(name([60, 64, 67])).toBe('C');
    expect(name([60, 63, 67])).toBe('Cm');
    expect(name([60, 64, 67, 70])).toBe('C7');
    expect(name([60, 64, 67, 71])).toBe('Cmaj7');
    expect(name([60, 63, 67, 70])).toBe('Cm7');
    expect(name([60, 62, 67])).toBe('Csus2');
    expect(name([60, 65, 67])).toBe('Csus4');
    expect(name([60, 63, 66])).toBe('Cdim');
    expect(name([60, 64, 68])).toBe('Caug');
  });

  it('works in every key', () => {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    for (let root = 0; root < 12; root++) {
      expect(name([48 + root, 52 + root, 55 + root])).toBe(names[root]);
      expect(name([48 + root, 51 + root, 55 + root, 58 + root])).toBe(`${names[root]}m7`);
    }
  });

  it('ignores octave doublings and note order', () => {
    expect(name([72, 48, 64, 55, 60, 76])).toBe('C');
  });

  it('names inversions as slash chords', () => {
    expect(name([64, 67, 72])).toBe('C/E');
    expect(name([67, 72, 76])).toBe('C/G');
  });

  it('resolves ambiguous sets by the bass note', () => {
    expect(name([60, 64, 67, 69])).toBe('C6'); // same notes as Am7
    expect(name([57, 60, 64, 67])).toBe('Am7');
    expect(name([60, 62, 67])).toBe('Csus2'); // same notes as Gsus4
    expect(name([67, 72, 74])).toBe('Gsus4');
  });

  it('returns null for fewer than three pitch classes or no match', () => {
    expect(detectChord([])).toBeNull();
    expect(detectChord([60])).toBeNull();
    expect(detectChord([60, 67, 72])).toBeNull();
    expect(detectChord([60, 61, 62])).toBeNull();
  });
});

describe('TapTempo', () => {
  it('needs two taps', () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(500)).toBeCloseTo(120, 5);
  });

  it('averages steady taps', () => {
    const t = new TapTempo();
    let bpm: number | null = null;
    for (let i = 0; i < 5; i++) bpm = t.tap(i * 400);
    expect(bpm).toBeCloseTo(150, 5);
  });

  it('ignores one sloppy tap', () => {
    const t = new TapTempo();
    const times = [0, 500, 1000, 1500, 2300, 2800]; // one interval of 800 ms among 500s
    let bpm: number | null = null;
    for (const ms of times) bpm = t.tap(ms);
    expect(bpm).toBeCloseTo(120, 5);
  });

  it('starts again after a pause', () => {
    const t = new TapTempo();
    t.tap(0);
    t.tap(500);
    expect(t.tap(5000)).toBeNull();
    expect(t.tap(5250)).toBeCloseTo(240, 5);
  });
});

describe('notes', () => {
  it('names notes with MIDI 60 = C4', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(36)).toBe('C2');
    expect(noteName(96)).toBe('C7');
    expect(noteName(69)).toBe('A4');
    expect(noteName(61)).toBe('C#4');
  });

  it('knows black keys', () => {
    expect([60, 62, 64, 65, 67, 69, 71].some(isBlackKey)).toBe(false);
    expect([61, 63, 66, 68, 70].every(isBlackKey)).toBe(true);
  });

  it('labels keys', () => {
    expect(keyLabel(60, 'off')).toBe('');
    expect(keyLabel(60, 'note')).toBe('C4');
    expect(keyLabel(62, 'note')).toBe('D');
    expect(keyLabel(67, 'solfege')).toBe('Sol');
  });
});
