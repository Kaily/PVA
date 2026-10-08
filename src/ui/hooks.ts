import { useEffect, useRef } from 'react';
import { onFrame } from '../core/frame';
import { useStore } from '../core/store';
import { services } from '../services';
import type { AppState } from '../state/appState';

/** Read one slice of the panel state. */
export function useApp<S>(selector: (state: AppState) => S): S {
  return useStore(services().store, selector);
}

/** Run a callback on every animation frame while the component is mounted. */
export function useFrame(fn: (nowMs: number, dtMs: number) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onFrame((now, dt) => ref.current(now, dt)), []);
}
