import { describe, expect, it } from 'vitest';
import { BLACK_KEYS, BLACK_LENGTH, FIRST_KEY, KEYS, KEY_COUNT, LAST_KEY, WHITE_COUNT, WHITE_KEYS, keyAt } from '../../src/data/keyboardLayout';
import { ASSIGNABLE_CODES, CONTROL_KEYS, defaultKeyMap } from '../../src/data/keymap';
import { applyTouch, velocityFromDepth } from '../../src/input/velocity';

describe('keyboard layout', () => {
  it('has exactly 61 keys, C2 to C7', () => {
    expect(KEY_COUNT).toBe(61);
    expect(KEYS.length).toBe(61);
    expect(FIRST_KEY).toBe(36);
    expect(LAST_KEY).toBe(96);
    expect(WHITE_KEYS.length).toBe(36);
    expect(WHITE_COUNT).toBe(36);
    expect(BLACK_KEYS.length).toBe(25);
  });

  it('lays white keys edge to edge', () => {
    WHITE_KEYS.forEach((k, i) => {
      expect(k.left).toBeCloseTo(i / 36, 10);
      expect(k.width).toBeCloseTo(1 / 36, 10);
    });
  });

  it('keeps every black key inside the keybed and over the right gap', () => {
    for (const k of BLACK_KEYS) {
      expect(k.left).toBeGreaterThan(0);
      expect(k.left + k.width).toBeLessThan(1);
      const centre = (k.left + k.width / 2) * 36;
      expect(Math.abs(centre - k.whiteIndex)).toBeLessThan(0.2); // near the boundary between two whites
    }
  });

  it('hit-tests the centre of every key', () => {
    for (const k of WHITE_KEYS) {
      expect(keyAt(k.left + k.width / 2, 0.9)?.midi).toBe(k.midi); // front part: always the white key
    }
    for (const k of BLACK_KEYS) {
      expect(keyAt(k.left + k.width / 2, BLACK_LENGTH * 0.5)?.midi).toBe(k.midi);
    }
  });

  it('gives the white key below the black-key zone and between black keys', () => {
    const cSharp = BLACK_KEYS[0];
    const x = cSharp.left + cSharp.width / 2;
    expect(keyAt(x, BLACK_LENGTH + 0.05)?.midi).not.toBe(cSharp.midi);
    // E–F and B–C have no black key between them
    const e2 = WHITE_KEYS[2];
    expect(keyAt(e2.left + e2.width * 0.98, 0.2)?.midi).toBe(e2.midi);
  });

  it('returns null outside the keybed', () => {
    expect(keyAt(-0.01, 0.5)).toBeNull();
    expect(keyAt(1, 0.5)).toBeNull();
    expect(keyAt(0.5, -0.1)).toBeNull();
    expect(keyAt(0.5, 1.1)).toBeNull();
  });

  it('reports depth for position-based velocity', () => {
    const k = WHITE_KEYS[10];
    expect(keyAt(k.left + k.width / 2, 0.95)!.depth).toBeGreaterThan(keyAt(k.left + k.width / 2, 0.7)!.depth);
  });
});

describe('computer key map', () => {
  const map = defaultKeyMap();

  it('follows the Z S X D C … / Q 2 W 3 E … layout', () => {
    const lower = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM'];
    const upper = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU'];
    lower.forEach((code, i) => expect(map[code]).toBe(48 + i));
    upper.forEach((code, i) => expect(map[code]).toBe(60 + i));
  });

  it('only uses keys on the 61-key range and never a control key', () => {
    for (const [code, key] of Object.entries(map)) {
      expect(key).toBeGreaterThanOrEqual(FIRST_KEY);
      expect(key).toBeLessThanOrEqual(LAST_KEY);
      expect(code in CONTROL_KEYS).toBe(false);
      expect(ASSIGNABLE_CODES.has(code)).toBe(true);
    }
  });
});

describe('touch response', () => {
  it('OFF returns the fixed velocity', () => {
    expect(applyTouch(10, 'off', 100)).toBe(100);
    expect(applyTouch(127, 'off', 64)).toBe(64);
  });

  it('NORMAL is linear, SOFT is louder, HARD is quieter', () => {
    for (const v of [10, 40, 64, 90, 120]) {
      expect(applyTouch(v, 'normal', 100)).toBe(v);
      expect(applyTouch(v, 'soft', 100)).toBeGreaterThan(v);
      expect(applyTouch(v, 'hard', 100)).toBeLessThan(v);
    }
  });

  it('keeps the range 1–127 and maps the extremes', () => {
    for (const mode of ['soft', 'normal', 'hard'] as const) {
      expect(applyTouch(127, mode, 100)).toBe(127);
      expect(applyTouch(1, mode, 100)).toBeGreaterThanOrEqual(1);
      expect(applyTouch(500, mode, 100)).toBe(127);
      expect(applyTouch(-5, mode, 100)).toBeGreaterThanOrEqual(1);
    }
  });

  it('is monotonic', () => {
    for (const mode of ['soft', 'normal', 'hard'] as const) {
      let prev = 0;
      for (let v = 1; v <= 127; v++) {
        const out = applyTouch(v, mode, 100);
        expect(out).toBeGreaterThanOrEqual(prev);
        prev = out;
      }
    }
  });

  it('plays louder towards the front of a key', () => {
    expect(velocityFromDepth(0)).toBe(38);
    expect(velocityFromDepth(1)).toBe(120);
    expect(velocityFromDepth(0.5)).toBeGreaterThan(velocityFromDepth(0.2));
  });
});
