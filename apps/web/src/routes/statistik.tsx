import { useMemo, useState, type ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { Sparkline, Gauge, ComboChart, CHART_COLORS, type ComboPoint } from '../components/charts';
import { trpc } from '../lib/trpc';

const SELECT_CLS =
  'h-9 rounded-md border border-line bg-surface px-3 text-[13px] text-ink focus:border-ink focus:outline-none transition-colors';
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

type Preset = 'month' | '30d' | 'year' | 'lastyear' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'month', label: 'Dieser Monat' },
  { key: '30d', label: 'Letzte 30 Tage' },
  { key: 'year', label: 'Dieses Jahr' },
  { key: 'lastyear', label: 'Letztes Jahr' },
  { key: 'custom', label: 'Frei' },
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fullDate = (s: string) => {
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
};

function presetRange(p: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  if (p === 'month') return { from: iso(new Date(y, now.getMonth(), 1)), to: iso(now) };
  if (p === '30d') {
    const f = new Date(now);
    f.setDate(f.getDate() - 29);
    return { from: iso(f), to: iso(now) };
  }
  if (p === 'year') return { from: iso(new Date(y, 0, 1)), to: iso(now) };
  return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) };
}

type Bucket = {
  label: string;
  full: string;
  days: number;
  netCents: number;
  lodgingCents: number;
  nights: number;
  arrivals: number;
  cancellations: number;
  staySum: number;
  leadSum: number;
};

type SeriesPoint = {
  date: string;
  netCents: number;
  lodgingCents: number;
  nights: number;
  arrivals: number;
  cancellations: number;
  staySum: number;
  leadSum: number;
};

function bucketize(series: SeriesPoint[]): Bucket[] {
  if (series.length <= 62) {
    return series.map((s) => ({ ...s, label: s.date.slice(8, 10), full: fullDate(s.date), days: 1 }));
  }
  const m = new Map<string, Bucket>();
  for (const s of series) {
    const k = s.date.slice(0, 7);
    const lbl = `${MONTHS[Number(k.slice(5, 7)) - 1]}`;
    const b =
      m.get(k) ??
      ({
        label: lbl,
        full: `${lbl} ${k.slice(0, 4)}`,
        days: 0,
        netCents: 0,
        lodgingCents: 0,
        nights: 0,
        arrivals: 0,
        cancellations: 0,
        staySum: 0,
        leadSum: 0,
      } satisfies Bucket);
    b.days += 1;
    b.netCents += s.netCents;
    b.lodgingCents += s.lodgingCents;
    b.nights += s.nights;
    b.arrivals += s.arrivals;
    b.cancellations += s.cancellations;
    b.staySum += s.staySum;
    b.leadSum += s.leadSum;
    m.set(k, b);
  }
  return [...m.values()];
}

export function StatistikPage() {
  const [preset, setPreset] = useState<Preset>('month');
  const [customFrom, setCustomFrom] = useState(() => presetRange('month').from);
  const [customTo, setCustomTo] = useState(() => iso(new Date()));
  const [propertyId, setPropertyId] = useState<string | null>(null);

  const { from, to } =
    preset === 'custom' ? { from: customFrom, to: customTo } : presetRange(preset);

  const propsQ = trpc.properties.list.useQuery();
  const q = trpc.analytics.summary.useQuery({ from, to, propertyId });

  const currency = q.data?.currency ?? 'EUR';
  const { money, moneyAxis } = useMemo(() => {
    const full = new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    const sym = (0).toLocaleString('de-DE', { style: 'currency', currency, maximumFractionDigits: 0 }).replace(/[\d\s.,]/g, '');
    return {
      money: (c: number) => full.format(c / 100),
      moneyAxis: (c: number) => {
        const v = c / 100;
        const s = v >= 1000 ? `${(v / 1000).toLocaleString('de-DE', { maximumFractionDigits: v >= 10000 ? 0 : 1 })}k` : `${Math.round(v)}`;
        return `${sym}${s}`;
      },
    };
  }, [currency]);

  const cur = q.data?.current;
  const prev = q.data?.previous;
  const apts = q.data?.activeApartments ?? 0;

  const buckets = useMemo(() => (cur ? bucketize(cur.series as SeriesPoint[]) : []), [cur]);
  const occOf = (b: Bucket) => (apts > 0 && b.days > 0 ? (b.nights / (apts * b.days)) * 100 : 0);
  const adrOf = (b: Bucket) => (b.nights > 0 ? b.lodgingCents / b.nights : 0);
  const revparOf = (b: Bucket) => (apts > 0 && b.days > 0 ? b.netCents / (apts * b.days) : 0);
  const stayOf = (b: Bucket) => (b.arrivals > 0 ? b.staySum / b.arrivals : 0);
  const leadOf = (b: Bucket) => (b.arrivals > 0 ? b.leadSum / b.arrivals : 0);

  const comboPoints: ComboPoint[] = buckets.map((b) => ({
    label: b.label,
    full: b.full,
    revenueCents: b.netCents,
    occPct: occOf(b),
  }));

  return (
    <>
      <PageHeader
        title="Statistik"
        subtitle="Umsatz, Auslastung und Buchungen über einen Zeitraum. Umsatz netto (ohne Citytax), pro Übernachtung verbucht."
      />

      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-5xl space-y-5">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-md border border-line p-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={cn(
                  'rounded px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                  preset === p.key ? 'bg-ink text-surface' : 'text-muted hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className={SELECT_CLS} aria-label="Von" />
              <span className="text-whisper">–</span>
              <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} className={SELECT_CLS} aria-label="Bis" />
            </div>
          )}

          <select
            value={propertyId ?? ''}
            onChange={(e) => setPropertyId(e.target.value || null)}
            className={cn(SELECT_CLS, 'ml-auto max-w-[220px]')}
            aria-label="Apartment filtern"
          >
            <option value="">Alle Apartments</option>
            {(propsQ.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {q.isLoading || !cur || !prev ? (
          <>
            <Skeleton className="h-72 rounded-xl" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[124px] rounded-xl" />
              ))}
            </div>
          </>
        ) : cur.umsatzNetCents === 0 && cur.nights === 0 && cur.bookings === 0 && cur.cancellations === 0 ? (
          <Card className="px-5 py-12 text-center">
            <p className="text-[13.5px] text-muted">Keine Buchungen in diesem Zeitraum.</p>
          </Card>
        ) : (
          <>
            {/* Hero: combo chart + occupancy gauge */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2 p-5">
                <h3 className="text-[13px] font-semibold text-ink">Umsatz &amp; Auslastung</h3>
                <div className="mt-2">
                  <ComboChart points={comboPoints} money={money} moneyAxis={moneyAxis} />
                </div>
              </Card>
              <Card className="flex flex-col items-center justify-center p-5">
                <Gauge pct={cur.occupancyBp / 100} />
                <Delta cur={cur.occupancyBp} prev={prev.occupancyBp} suffix="vs. Vorperiode" className="mt-1" />
                <p className="mt-1 text-center text-[11px] text-whisper">
                  Ø über {q.data!.rangeDays} Tage · {apts} Apartment(s)
                </p>
              </Card>
            </div>

            {/* KPI tiles with sparklines */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile label="Umsatz (netto)" value={money(cur.umsatzNetCents)} cur={cur.umsatzNetCents} prev={prev.umsatzNetCents} spark={buckets.map((b) => b.netCents)} />
              <Tile label="Buchungen" value={cur.bookings} cur={cur.bookings} prev={prev.bookings} spark={buckets.map((b) => b.arrivals)} />
              <Tile label="Übernachtungen" value={cur.nights} cur={cur.nights} prev={prev.nights} spark={buckets.map((b) => b.nights)} />
              <Tile label="Stornierungen" value={cur.cancellations} cur={cur.cancellations} prev={prev.cancellations} spark={buckets.map((b) => b.cancellations)} color={CHART_COLORS.negative} invert />
              <Tile label="ADR · Ø Preis/Nacht" value={money(cur.adrCents)} cur={cur.adrCents} prev={prev.adrCents} spark={buckets.map(adrOf)} />
              <Tile label="RevPAR" value={money(cur.revparCents)} cur={cur.revparCents} prev={prev.revparCents} spark={buckets.map(revparOf)} />
              <Tile label="Ø Aufenthalt" value={`${cur.avgStayNights.toFixed(1)} Nä.`} cur={cur.avgStayNights} prev={prev.avgStayNights} spark={buckets.map(stayOf)} />
              <Tile label="Ø Vorlaufzeit" value={`${Math.round(cur.avgLeadDays)} Tage`} cur={cur.avgLeadDays} prev={prev.avgLeadDays} spark={buckets.map(leadOf)} />
            </div>

            {/* Breakdowns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Card className="p-5">
                <h3 className="mb-3 text-[13px] font-semibold text-ink">Kanäle</h3>
                <BarList
                  items={cur.channels.map((c) => ({
                    key: c.key,
                    label: CHANNEL[c.key]?.label ?? c.key,
                    dot: CHANNEL[c.key]?.dot ?? 'bg-muted',
                    value: c.netCents,
                    sub: `${c.count} Buchung${c.count === 1 ? '' : 'en'}`,
                  }))}
                  money={money}
                />
              </Card>
              <Card className="p-5">
                <h3 className="mb-3 text-[13px] font-semibold text-ink">Top-Apartments</h3>
                <BarList
                  items={cur.topProperties.slice(0, 8).map((p) => ({
                    key: p.propertyId,
                    label: p.name,
                    dot: 'bg-brand',
                    value: p.netCents,
                    sub: `${p.nights} Nä.`,
                  }))}
                  money={money}
                />
              </Card>
            </div>

            <p className="text-[11px] text-whisper">
              Auslastung &amp; RevPAR auf Basis von {apts} aktiven Apartment(s) × {q.data!.rangeDays} Tagen. Buchungen, Aufenthalt, Vorlaufzeit &amp; Stornierungen nach Anreisedatum. Vergleich zur gleich langen Vorperiode.
            </p>
          </>
        )}
      </div>
    </>
  );
}

const CHANNEL: Record<string, { label: string; dot: string }> = {
  airbnb: { label: 'Airbnb', dot: 'bg-[#FF5A5F]' },
  booking_com: { label: 'Booking.com', dot: 'bg-[#003580]' },
  internal: { label: 'Direkt', dot: 'bg-ink' },
  expedia: { label: 'Expedia', dot: 'bg-[#FFC72C]' },
  other_ota: { label: 'Andere OTA', dot: 'bg-muted' },
};

function Delta({
  cur,
  prev,
  suffix,
  className,
}: {
  cur: number;
  prev: number;
  suffix?: string;
  className?: string;
}) {
  if (prev <= 0) return null;
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.5) {
    return <div className={cn('text-[11px] text-whisper', className)}>≈ Vorperiode</div>;
  }
  const up = d >= 0;
  return (
    <div className={cn('inline-flex items-center gap-1 text-[11px] font-medium', up ? 'text-positive' : 'text-negative', className)}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {d.toFixed(0)} %{suffix ? <span className="font-normal text-whisper">{suffix}</span> : null}
    </div>
  );
}

function Tile({
  label,
  value,
  cur,
  prev,
  spark,
  color = CHART_COLORS.brand,
  invert = false,
}: {
  label: string;
  value: ReactNode;
  cur?: number;
  prev?: number;
  spark: number[];
  color?: string;
  invert?: boolean;
}) {
  const delta = cur != null && prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;
  const up = (delta ?? 0) >= 0;
  const good = invert ? !up : up;
  return (
    <Card className="flex flex-col p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="num mt-1.5 text-[21px] leading-none text-ink">{value}</div>
      <div className="mt-1.5 h-[15px]">
        {delta != null && Math.abs(delta) >= 0.5 && (
          <div className={cn('inline-flex items-center gap-1 text-[11px] font-medium', good ? 'text-positive' : 'text-negative')}>
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {up ? '+' : ''}
            {delta.toFixed(0)} %
          </div>
        )}
      </div>
      <div className="mt-2">
        <Sparkline values={spark} color={color} />
      </div>
    </Card>
  );
}

function BarList({
  items,
  money,
}: {
  items: { key: string; label: string; dot: string; value: number; sub: string }[];
  money: (c: number) => string;
}) {
  if (items.length === 0) return <p className="text-[12px] text-whisper">Keine Daten.</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.key}>
          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', it.dot)} />
              <span className="truncate text-ink">{it.label}</span>
            </span>
            <span className="flex flex-shrink-0 items-center gap-2">
              <span className="text-whisper">{it.sub}</span>
              <span className="num text-ink-soft">{money(it.value)}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-brand/70" style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
