/**
 * Structured trigger builder — shared by the message-template editor and the
 * cleaning-rule editor. Emits/parses the trigger DSL understood by
 * @cm/api services/triggers.ts:
 *
 *   reservation|checkin|checkout : ±Nd @ HH:MM   (property-local time)
 *
 * Controlled component: parent owns the {anchor, rel, days, time} parts.
 */
import { Input } from './ui/Input';
import { Label } from './ui/Label';

export type Anchor = 'reservation' | 'checkin' | 'checkout';
export type Rel = 'before' | 'on' | 'after';

export interface TriggerParts {
  anchor: Anchor;
  rel: Rel;
  days: number; // 1–90, used when rel !== 'on'
  time: string; // HH:MM
}

const ANCHOR_LABEL: Record<Anchor, string> = {
  reservation: 'Neue Reservierung',
  checkin: 'Check-in',
  checkout: 'Check-out',
};

/** Allowed relations per anchor + their labels (per the product spec). */
const REL_OPTIONS: Record<Anchor, Array<{ rel: Rel; label: string }>> = {
  reservation: [
    { rel: 'on', label: 'Am Tag der Reservierung' },
    { rel: 'after', label: 'Tage nach Reservierung' },
  ],
  checkin: [
    { rel: 'before', label: 'Tage vor Check-in' },
    { rel: 'on', label: 'Am Check-in-Tag' },
    { rel: 'after', label: 'Tage nach Check-in' },
  ],
  checkout: [
    { rel: 'on', label: 'Am Check-out-Tag' },
    { rel: 'after', label: 'Tage nach Check-out' },
  ],
};

/** "00:00" … "23:30" in 30-min steps (listing-local time). */
const TIME_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

export function buildTriggerDsl(p: TriggerParts): string {
  if (p.rel === 'on') return `${p.anchor}:+0d@${p.time}`;
  const sign = p.rel === 'before' ? '-' : '+';
  return `${p.anchor}:${sign}${p.days}d@${p.time}`;
}

export function parseTriggerDsl(s: string): TriggerParts {
  // Legacy bare trigger → "on day of reservation" (time defaulted).
  if (s === 'booking_created')
    return { anchor: 'reservation', rel: 'on', days: 1, time: '09:00' };
  const m = /^(reservation|checkin|checkout):([+-]?\d{1,3})d@(\d\d:\d\d)$/.exec(s);
  if (!m) return { anchor: 'checkin', rel: 'before', days: 1, time: '18:00' };
  const off = Number(m[2]);
  const anchor = m[1] as Anchor;
  const rel: Rel = off === 0 ? 'on' : off < 0 ? 'before' : 'after';
  return { anchor, rel, days: Math.min(90, Math.abs(off) || 1), time: m[3]! };
}

const SELECT_CLS =
  'h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors';

export function TriggerBuilder({
  value,
  onChange,
}: {
  value: TriggerParts;
  onChange: (p: TriggerParts) => void;
}) {
  const { anchor, rel, days, time } = value;

  function changeAnchor(a: Anchor) {
    const nextRel = REL_OPTIONS[a].some((o) => o.rel === rel)
      ? rel
      : REL_OPTIONS[a][0]!.rel;
    onChange({ ...value, anchor: a, rel: nextRel });
  }

  return (
    <div className="space-y-1.5">
      <Label>Trigger</Label>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={anchor}
          onChange={(e) => changeAnchor(e.target.value as Anchor)}
          className={SELECT_CLS}
          aria-label="Ereignis"
        >
          {(Object.keys(ANCHOR_LABEL) as Anchor[]).map((a) => (
            <option key={a} value={a}>
              {ANCHOR_LABEL[a]}
            </option>
          ))}
        </select>
        <select
          value={rel}
          onChange={(e) => onChange({ ...value, rel: e.target.value as Rel })}
          className={SELECT_CLS}
          aria-label="Zeitpunkt"
        >
          {REL_OPTIONS[anchor].map((o) => (
            <option key={o.rel} value={o.rel}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rel !== 'on' ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) =>
                onChange({
                  ...value,
                  days: Math.max(1, Math.min(90, Number(e.target.value) || 1)),
                })
              }
              className="w-20"
              aria-label="Tage"
            />
            <span className="text-[12.5px] text-muted">Tage</span>
          </div>
        ) : (
          <div />
        )}
        <select
          value={time}
          onChange={(e) => onChange({ ...value, time: e.target.value })}
          className={SELECT_CLS}
          aria-label="Uhrzeit"
        >
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t} Uhr
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-whisper">
        Uhrzeit in lokaler Zeit des Apartments.
      </p>
    </div>
  );
}
