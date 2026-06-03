import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';

/** Theme colours as CSS-var rgb() strings (work in inline SVG styles). */
export const CHART_COLORS = {
  brand: 'rgb(var(--brand))',
  positive: 'rgb(var(--positive))',
  warning: 'rgb(var(--warning))',
  negative: 'rgb(var(--negative))',
  line: 'rgb(var(--line))',
  whisper: 'rgb(var(--whisper))',
  surface: 'rgb(var(--surface))',
};

/** Measure an element's width (responsive SVGs render at true px → no distortion). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setW(cr.width);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Catmull-Rom → cubic-bezier smoothing for an interpolated curve. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]![0]} ${pts[0]![1]}`;
  let d = `M ${pts[0]![0].toFixed(2)} ${pts[0]![1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

// ─── Sparkline ────────────────────────────────────────────────────────────
export function Sparkline({
  values,
  color = CHART_COLORS.brand,
  height = 36,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const gid = useId();
  const H = height;
  const padX = 3;
  const padY = 5;

  let body: ReactNode = null;
  if (w > 0 && values.length >= 2) {
    const max = Math.max(...values);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const pts: [number, number][] = values.map((v, i) => [
      padX + (i / (values.length - 1)) * (w - 2 * padX),
      H - padY - ((v - min) / range) * (H - 2 * padY),
    ]);
    const line = smoothPath(pts);
    const last = pts[pts.length - 1]!;
    const baseY = H - padY;
    const area = `${line} L ${last[0].toFixed(2)} ${baseY} L ${pts[0]![0].toFixed(2)} ${baseY} Z`;
    body = (
      <svg width={w} height={H} className="block">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.16} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeDasharray="4 2.5"
          strokeLinecap="round"
        />
        {values.length <= 40 &&
          pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={1.6} fill={color} />)}
        <circle
          cx={last[0]}
          cy={last[1]}
          r={2.6}
          fill={color}
          stroke={CHART_COLORS.surface}
          strokeWidth={1.5}
        />
      </svg>
    );
  }
  return (
    <div ref={ref} style={{ height: H }} className="w-full">
      {body}
    </div>
  );
}

// ─── Gauge (semicircle) ─────────────────────────────────────────────────────
export function Gauge({ pct }: { pct: number }) {
  const gid = useId();
  const clamped = Math.max(0, Math.min(100, pct));
  const arc = 'M 20 100 A 80 80 0 0 1 180 100';
  const valueColor =
    clamped >= 75
      ? CHART_COLORS.positive
      : clamped >= 50
        ? CHART_COLORS.warning
        : CHART_COLORS.negative;
  return (
    <svg
      viewBox="0 0 200 116"
      className="w-full max-w-[260px]"
      role="img"
      aria-label={`Auslastung ${Math.round(clamped)} Prozent`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={CHART_COLORS.negative} />
          <stop offset="50%" stopColor={CHART_COLORS.warning} />
          <stop offset="100%" stopColor={CHART_COLORS.positive} />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke={CHART_COLORS.line} strokeWidth={15} strokeLinecap="round" />
      <path
        d={arc}
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth={15}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${clamped} 100`}
      />
      <text x="100" y="92" textAnchor="middle" style={{ fill: valueColor }} className="num" fontSize="34">
        {Math.round(clamped)}%
      </text>
      <text x="100" y="110" textAnchor="middle" fill={CHART_COLORS.whisper} fontSize="11">
        Auslastung
      </text>
    </svg>
  );
}

// ─── Dual-axis combo line chart ─────────────────────────────────────────────
export interface ComboPoint {
  label: string;
  full: string;
  revenueCents: number;
  occPct: number;
}

export function ComboChart({
  points,
  money,
  moneyAxis,
}: {
  points: ComboPoint[];
  money: (cents: number) => string;
  moneyAxis: (cents: number) => string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const revGid = useId();
  const H = 260;
  const pad = { l: 52, r: 46, t: 18, b: 30 };

  const ready = w > 0 && points.length >= 1;
  const plotW = Math.max(1, w - pad.l - pad.r);
  const plotH = H - pad.t - pad.b;
  const maxRev = Math.max(1, ...points.map((p) => p.revenueCents));
  const n = points.length;

  const x = (i: number) => pad.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yRev = (c: number) => pad.t + plotH - (c / maxRev) * plotH;
  const yOcc = (p: number) => pad.t + plotH - (Math.min(100, p) / 100) * plotH;

  const revPts: [number, number][] = points.map((p, i) => [x(i), yRev(p.revenueCents)]);
  const occPts: [number, number][] = points.map((p, i) => [x(i), yOcc(p.occPct)]);
  const revLine = smoothPath(revPts);
  const occLine = smoothPath(occPts);
  const baseY = pad.t + plotH;
  const revArea =
    revPts.length >= 2
      ? `${revLine} L ${revPts[revPts.length - 1]![0].toFixed(2)} ${baseY} L ${revPts[0]![0].toFixed(2)} ${baseY} Z`
      : '';

  const xStep = Math.max(1, Math.ceil(n / 12));
  const gridYs = [0, 0.25, 0.5, 0.75, 1];

  function onMove(e: MouseEvent<HTMLDivElement>) {
    if (!ready) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const frac = (mx - pad.l) / plotW;
    const idx = Math.round(frac * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, idx)));
  }

  return (
    <div ref={ref} className="relative w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {ready && (
        <svg width={w} height={H} className="block">
          <defs>
            <linearGradient id={revGid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.brand} stopOpacity={0.14} />
              <stop offset="100%" stopColor={CHART_COLORS.brand} stopOpacity={0} />
            </linearGradient>
          </defs>

          {gridYs.map((g) => {
            const yy = pad.t + plotH - g * plotH;
            return (
              <g key={g}>
                <line
                  x1={pad.l}
                  y1={yy}
                  x2={w - pad.r}
                  y2={yy}
                  stroke={CHART_COLORS.line}
                  strokeWidth={1}
                  strokeDasharray={g === 0 ? undefined : '2 3'}
                />
                <text x={pad.l - 8} y={yy + 3} textAnchor="end" fill={CHART_COLORS.whisper} fontSize="9.5">
                  {moneyAxis(Math.round(maxRev * g))}
                </text>
                <text x={w - pad.r + 8} y={yy + 3} textAnchor="start" fill={CHART_COLORS.whisper} fontSize="9.5">
                  {Math.round(g * 100)}%
                </text>
              </g>
            );
          })}

          {points.map((p, i) =>
            i % xStep === 0 ? (
              <text key={p.full} x={x(i)} y={H - 10} textAnchor="middle" fill={CHART_COLORS.whisper} fontSize="9.5">
                {p.label}
              </text>
            ) : null,
          )}

          {revArea && <path d={revArea} fill={`url(#${revGid})`} />}
          {occPts.length >= 2 && (
            <path
              d={occLine}
              fill="none"
              stroke={CHART_COLORS.positive}
              strokeWidth={2}
              strokeDasharray="5 3"
              strokeLinecap="round"
            />
          )}
          {revPts.length >= 2 && (
            <path
              d={revLine}
              fill="none"
              stroke={CHART_COLORS.brand}
              strokeWidth={2.25}
              strokeDasharray="5 3"
              strokeLinecap="round"
            />
          )}

          {points.map((p, i) =>
            n <= 62 || i % xStep === 0 ? (
              <g key={p.full}>
                <circle cx={x(i)} cy={yOcc(p.occPct)} r={2.4} fill={CHART_COLORS.positive} />
                <circle cx={x(i)} cy={yRev(p.revenueCents)} r={2.6} fill={CHART_COLORS.brand} />
              </g>
            ) : null,
          )}

          {hover != null && (
            <g>
              <line
                x1={x(hover)}
                y1={pad.t}
                x2={x(hover)}
                y2={baseY}
                stroke={CHART_COLORS.whisper}
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <circle
                cx={x(hover)}
                cy={yRev(points[hover]!.revenueCents)}
                r={3.6}
                fill={CHART_COLORS.brand}
                stroke={CHART_COLORS.surface}
                strokeWidth={1.5}
              />
              <circle
                cx={x(hover)}
                cy={yOcc(points[hover]!.occPct)}
                r={3.4}
                fill={CHART_COLORS.positive}
                stroke={CHART_COLORS.surface}
                strokeWidth={1.5}
              />
            </g>
          )}
        </svg>
      )}

      {ready && hover != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur"
          style={{ left: x(hover), top: 0 }}
        >
          <div className="font-medium text-ink">{points[hover]!.full}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-ink-soft">
            <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS.brand }} />
            {money(points[hover]!.revenueCents)}
          </div>
          <div className="flex items-center gap-1.5 text-ink-soft">
            <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS.positive }} />
            {Math.round(points[hover]!.occPct)}% Auslastung
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-4 text-[11.5px] text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS.brand }} />
          Umsatz
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS.positive }} />
          Auslastung
        </span>
      </div>
    </div>
  );
}
