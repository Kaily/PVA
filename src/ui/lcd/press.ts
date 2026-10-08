import type React from 'react';
import { unlockAudio } from '../../state/actions';

/**
 * Handlers for something on the display that acts on pointer *down* (like the
 * panel buttons) and still works from the keyboard / assistive technology,
 * where only `click` arrives.
 */
let lastPointerPress = -1e9;

export function press(fn: () => void): {
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
} {
  return {
    onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); // no focus steal: the space bar stays the sustain pedal
      lastPointerPress = performance.now();
      unlockAudio();
      fn();
    },
    onClick() {
      // The click that follows a pointer press was already handled on the way down.
      if (performance.now() - lastPointerPress < 700) return;
      unlockAudio();
      fn();
    },
  };
}
