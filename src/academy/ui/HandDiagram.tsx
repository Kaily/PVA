/**
 * Right hand seen from above, as it lies on the keys: thumb (1) on the
 * left, little finger (5) on the right. The finger to use is lit.
 */
const FINGERS: { n: number; x: number; y: number; h: number; r?: number }[] = [
  { n: 1, x: 10, y: 52, h: 30, r: -24 },
  { n: 2, x: 30, y: 14, h: 52 },
  { n: 3, x: 50, y: 6, h: 58 },
  { n: 4, x: 70, y: 12, h: 52 },
  { n: 5, x: 89, y: 28, h: 40 },
];

export function HandDiagram({ finger, caption }: { finger: number; caption: string }) {
  return (
    <figure className="ac-hand" aria-label={`Right hand, finger ${finger}`}>
      <svg viewBox="0 0 112 124" role="img" aria-hidden="true">
        <rect className="ac-hand__palm" x="20" y="56" width="88" height="60" rx="22" />
        {FINGERS.map((f) => (
          <g key={f.n} transform={f.r ? `rotate(${f.r} ${f.x + 8} ${f.y + f.h})` : undefined}>
            <rect className={`ac-hand__finger${f.n === finger ? ' is-on' : ''}`} x={f.x} y={f.y} width="16" height={f.h + 14} rx="8" />
            <text className={`ac-hand__num${f.n === finger ? ' is-on' : ''}`} x={f.x + 8} y={f.y + 14} textAnchor="middle">
              {f.n}
            </text>
          </g>
        ))}
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
