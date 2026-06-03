import { useMemo, useState, type ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
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

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) }; // lastyear
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

  const money = useMemo(() => {
    const cur = q.data?.currency ?? 'EUR';
    const fmt = new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 0,
    });
    return (cents: number) => fmt.format(cents / 100);
  }, [q.data?.currency]);

  const cur = q.data?.current;
  const prev = q.data?.previous;

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
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className={SELECT_CLS}
                aria-label="Von"
              />
              <span className="text-whisper">–</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
                className={SELECT_CLS}
                aria-label="Bis"
              />
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl" />
          </>
        ) : cur.bookings === 0 ? (
          <Card className="px-5 py-12 text-center">
            <p className="text-[13.5px] text-muted">
              Keine Buchungen in diesem Zeitraum.
            </p>
          </Card>
        ) : (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile label="Umsatz (netto)" value={money(cur.umsatzNetCents)} cur={cur.umsatzNetCents} prev={prev.umsatzNetCents} />
              <Tile label="Auslastung" value={`${Math.round(cur.occupancyBp / 100)} %`} cur={cur.occupancyBp} prev={prev.occupancyBp} />
              <Tile label="Buchungen" value={cur.bookings} cur={cur.bookings} prev={prev.bookings} />
              <Tile label="Übernachtungen" value={cur.nights} cur={cur.nights} prev={prev.nights} />
              <Tile label="ADR · Ø Preis/Nacht" value={money(cur.adrCents)} cur={cur.adrCents} prev={prev.adrCents} />
              <Tile label="RevPAR" value={money(cur.revparCents)} cur={cur.revparCents} prev={prev.revparCents} />
              <Tile label="Ø Aufenthalt" value={`${cur.avgStayNights.toFixed(1)} Nä.`} />
              <Tile label="Ø Vorlaufzeit" value={`${Math.round(cur.avgLeadDays)} Tage`} />
            </div>

            {/* Daily / monthly revenue */}
            <Card className="p-5">
              <h3 className="text-[13px] font-semibold text-ink">Umsatz pro {q.data!.rangeDays > 62 ? 'Monat' : 'Tag'}</h3>
              <RevenueBars daily={cur.daily} money={money} />
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Card className="p-5">
                <h3 className="text-[13px] font-semibold text-ink mb-3">Kanäle</h3>
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
                <h3 className="text-[13px] font-semibold text-ink mb-3">Top-Apartments</h3>
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
              Auslastung &amp; RevPAR auf Basis von {q.data!.activeApartments} aktiven Apartment(s) × {q.data!.rangeDays} Tagen. Vergleich jeweils zur gleich langen Vorperiode.
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

function Tile({
  label,
  value,
  cur,
  prev,
}: {
  label: string;
  value: ReactNode;
  cur?: number;
  prev?: number;
}) {
  const delta =
    cur != null && prev != null && prev > 0 ? ((cur - prev) / prev) * 100 : null;
  const up = (delta ?? 0) >= 0;
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-2 num text-[22px] leading-none text-ink">{value}</div>
      {delta != null && Math.abs(delta) >= 0.5 ? (
        <div
          className={cn(
            'mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium',
            up ? 'text-positive' : 'text-negative',
          )}
        >
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {up ? '+' : ''}
          {delta.toFixed(0)} %
          <span className="text-whisper font-normal">vs. Vorperiode</span>
        </div>
      ) : (
        delta != null && (
          <div className="mt-2 text-[11.5px] text-whisper">≈ Vorperiode</div>
        )
      )}
    </Card>
  );
}

function RevenueBars({
  daily,
  money,
}: {
  daily: { date: string; cents: number }[];
  money: (c: number) => string;
}) {
  const points = useMemo(() => {
    if (daily.length <= 62) {
      return daily.map((d) => ({ key: d.date, label: d.date.slice(8, 10), full: d.date, cents: d.cents }));
    }
    const m = new Map<string, number>();
    for (const d of daily) {
      const k = d.date.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + d.cents);
    }
    return [...m.entries()].map(([k, c]) => ({
      key: k,
      label: MONTHS[Number(k.slice(5, 7)) - 1] ?? k,
      full: k,
      cents: c,
    }));
  }, [daily]);

  const max = Math.max(1, ...points.map((p) => p.cents));
  const step = Math.max(1, Math.ceil(points.length / 12));
  const H = 176; // chart height in px (definite → bar heights are reliable)

  if (points.length === 0) {
    return <p className="mt-4 text-[12px] text-whisper">Keine Daten.</p>;
  }

  return (
    <div className="mt-4">
      <div className="flex items-end gap-px" style={{ height: H }}>
        {points.map((p) => (
          <div
            key={p.key}
            className="flex-1 rounded-t-sm bg-brand/75 transition-colors hover:bg-brand"
            style={{ height: p.cents > 0 ? Math.max(2, (p.cents / max) * H) : 0 }}
            title={`${p.full}: ${money(p.cents)}`}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-px">
        {points.map((p, i) => (
          <div key={p.key} className="flex-1 text-center text-[9px] text-whisper">
            {i % step === 0 ? p.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function BarList({
  items,
  money,
}: {
  items: { key: string; label: string; dot: string; value: number; sub: string }[];
  money: (c: number) => string;
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-whisper">Keine Daten.</p>;
  }
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
            <div
              className="h-full rounded-full bg-brand/70"
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
