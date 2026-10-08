import { useEffect, useRef } from 'react';
import { onFrame } from '../../core/frame';
import { services } from '../../services';

const SEGMENTS = 24;
const MIN_DB = -48;
const FALL_DB_PER_SEC = 26; // meter ballistics: instant attack, steady fall
const HOLD_MS = 1400;
const CLIP_HOLD_MS = 2000;

const toDb = (linear: number): number => (linear > 1e-6 ? 20 * Math.log10(linear) : -120);

/** Segment colour by level: green → amber above −9 dB → red above −3 dB. */
function colour(db: number, lit: boolean): string {
  if (db >= -3) return lit ? '#ff4a3d' : '#3a1513';
  if (db >= -9) return lit ? '#ffb540' : '#3a2a10';
  return lit ? '#45d98c' : '#11301f';
}

/**
 * Stereo output meter (L / R). It reads the true output level reported by
 * the master stage — nothing here is animated artificially. Drawn on a canvas
 * from the shared frame loop; React never re-renders for it.
 */
export function StereoMeter() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clipL = useRef<HTMLSpanElement>(null);
  const clipR = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const { engine } = services();

    const level = [MIN_DB, MIN_DB];
    const hold = [MIN_DB, MIN_DB];
    const holdAt = [0, 0];
    const clipAt = [0, 0];
    let lastDrawn = '';
    let seenAt = 0;

    const resize = (): void => {
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(8, Math.round(rect.width * dpr));
      cv.height = Math.max(8, Math.round(rect.height * dpr));
      lastDrawn = '';
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(cv);

    const draw = (): void => {
      const w = cv.width;
      const h = cv.height;
      g.clearRect(0, 0, w, h);
      const gap = Math.max(1, Math.round(h * 0.012));
      const segH = (h - gap * (SEGMENTS - 1)) / SEGMENTS;
      const barW = w * 0.4;
      for (let ch = 0; ch < 2; ch++) {
        const x = ch === 0 ? w * 0.06 : w * 0.54;
        for (let i = 0; i < SEGMENTS; i++) {
          // Segment i covers this dB value (bottom = MIN_DB, top = 0 dB).
          const db = MIN_DB + ((i + 1) / SEGMENTS) * -MIN_DB;
          const lit = level[ch] >= db - 1 || (hold[ch] >= db - 1 && hold[ch] < db + 1);
          g.fillStyle = colour(db, lit);
          const y = h - (i + 1) * segH - i * gap;
          g.fillRect(Math.round(x), Math.round(y), Math.round(barW), Math.max(1, Math.round(segH)));
        }
      }
    };

    const off = onFrame((now, dt) => {
      engine.pollMeter();
      const m = engine.meter;
      const fresh = m.at !== seenAt;
      seenAt = m.at;
      const input = [fresh ? toDb(m.peakL) : -120, fresh ? toDb(m.peakR) : -120];
      for (let ch = 0; ch < 2; ch++) {
        const fallen = level[ch] - (FALL_DB_PER_SEC * dt) / 1000;
        level[ch] = Math.max(MIN_DB, input[ch], fallen);
        if (level[ch] >= hold[ch]) {
          hold[ch] = level[ch];
          holdAt[ch] = now;
        } else if (now - holdAt[ch] > HOLD_MS) {
          hold[ch] = Math.max(MIN_DB, hold[ch] - (FALL_DB_PER_SEC * dt) / 1000);
        }
        // The limiter keeps the output below full scale; the lamp shows when it
        // is pulling the level down by more than 1 dB (or, without the limiter, at full scale).
        if (fresh && (m.reduction < 0.89 || input[ch] >= -0.3)) clipAt[ch] = now;
      }
      const lamp = [now - clipAt[0] < CLIP_HOLD_MS && clipAt[0] > 0, now - clipAt[1] < CLIP_HOLD_MS && clipAt[1] > 0];
      clipL.current?.classList.toggle('is-on', lamp[0]);
      clipR.current?.classList.toggle('is-on', lamp[1]);

      const signature = `${Math.round(level[0] * 2)}|${Math.round(level[1] * 2)}|${Math.round(hold[0])}|${Math.round(hold[1])}`;
      if (signature !== lastDrawn) {
        lastDrawn = signature;
        draw();
      }
    });

    return () => {
      off();
      observer.disconnect();
    };
  }, []);

  return (
    <div className="meter" role="img" aria-label="Stereo output level">
      <div className="meter__clips">
        <span ref={clipL} className="meter__clip" />
        <span ref={clipR} className="meter__clip" />
      </div>
      <div className="meter__body">
        <canvas ref={canvas} className="meter__canvas" />
        <div className="meter__scale" aria-hidden="true">
          <span style={{ top: '0%' }}>0</span>
          <span style={{ top: '12.5%' }}>6</span>
          <span style={{ top: '25%' }}>12</span>
          <span style={{ top: '50%' }}>24</span>
          <span style={{ top: '75%' }}>36</span>
          <span style={{ top: '100%' }}>48</span>
        </div>
      </div>
      <div className="meter__lr" aria-hidden="true">
        <span>L</span>
        <span>R</span>
      </div>
    </div>
  );
}
