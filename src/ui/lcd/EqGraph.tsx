import { useMemo, useRef } from 'react';
import { EQ_BANDS, EQ_GAIN_RANGE } from '../../data/effectPresets';
import { services } from '../../services';
import * as act from '../../state/actions';
import { useApp } from '../hooks';

/**
 * Response curve of the master equaliser. The curve is computed by the audio
 * engine from the same filter settings the sound goes through, so what is
 * drawn is what is heard. Every band has a handle: drag it up / down for the
 * gain and sideways for the frequency.
 */

const W = 560;
const H = 156;
const F_MIN = 20;
const F_MAX = 20000;
const DB = 15;
const POINTS = 140;

const xOf = (f: number): number => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * W;
const fOf = (x: number): number => F_MIN * Math.pow(F_MAX / F_MIN, x / W);
const yOf = (db: number): number => H / 2 - (db / DB) * (H / 2);
const dbOf = (y: number): number => ((H / 2 - y) / (H / 2)) * DB;

const FREQS = new Float32Array(POINTS);
for (let i = 0; i < POINTS; i++) FREQS[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / (POINTS - 1));

const GRID_F = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const LABEL_F: Record<number, string> = { 100: '100', 1000: '1k', 10000: '10k' };
const GRID_DB = [-12, -6, 0, 6, 12];

export function EqGraph() {
  // A string, because the store needs a stable value to compare.
  const signature = useApp((s) => `${s.eqPreset}|${s.eqUser.map((b) => `${b.gain},${b.freq}`).join(';')}`);
  const cursor = useApp((s) => s.cursor);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointer: number; band: number } | null>(null);

  const bands = useMemo(() => act.currentEq(services().store.get()), [signature]);
  const path = useMemo(() => {
    const db = services().engine.eqResponse(FREQS, bands);
    let line = '';
    for (let i = 0; i < POINTS; i++) {
      const y = Math.min(H, Math.max(0, yOf(db[i])));
      line += `${i === 0 ? 'M' : 'L'}${xOf(FREQS[i]).toFixed(1)} ${y.toFixed(1)}`;
    }
    return { line, area: `${line}L${W} ${H / 2}L0 ${H / 2}Z` };
  }, [bands]);

  const move = (e: React.PointerEvent): void => {
    const d = drag.current;
    const el = svg.current;
    if (!d || d.pointer !== e.pointerId || !el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    act.setEqBand(d.band, { gain: dbOf(y), freq: fOf(Math.min(W, Math.max(0, x))) });
  };
  const end = (e: React.PointerEvent): void => {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  };

  return (
    <div className="lcd-eq">
      <svg
        ref={svg}
        className="lcd-eq__graph"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Equaliser response curve"
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {GRID_F.map((f) => (
          <line key={f} className={`lcd-eq__grid${LABEL_F[f] ? ' is-major' : ''}`} x1={xOf(f)} x2={xOf(f)} y1={0} y2={H} />
        ))}
        {GRID_DB.map((db) => (
          <line key={db} className={`lcd-eq__grid${db === 0 ? ' is-zero' : ''}`} x1={0} x2={W} y1={yOf(db)} y2={yOf(db)} />
        ))}
        {Object.entries(LABEL_F).map(([f, text]) => (
          <text key={f} className="lcd-eq__label" x={xOf(Number(f)) + 4} y={H - 4}>
            {text}
          </text>
        ))}
        <text className="lcd-eq__label" x={4} y={yOf(12) + 11}>
          +12 dB
        </text>
        <text className="lcd-eq__label" x={4} y={yOf(-12) - 4}>
          −12
        </text>
        <path className="lcd-eq__area" d={path.area} />
        <path className="lcd-eq__curve" d={path.line} />
        {bands.map((b, i) => {
          const selected = cursor === `eq${i}`;
          return (
            <g
              key={i}
              className={`lcd-eq__handle${selected ? ' is-selected' : ''}`}
              transform={`translate(${xOf(b.freq).toFixed(1)} ${yOf(b.gain).toFixed(1)})`}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                e.preventDefault();
                svg.current?.setPointerCapture(e.pointerId);
                drag.current = { pointer: e.pointerId, band: i };
                act.setCursor(`eq${i}`);
              }}
            >
              <title>{`${EQ_BANDS[i].label}: drag to change gain (±${EQ_GAIN_RANGE} dB) and frequency`}</title>
              <circle r={15} className="lcd-eq__hit" />
              <circle r={9} />
              <text y={3.6}>{i + 1}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
