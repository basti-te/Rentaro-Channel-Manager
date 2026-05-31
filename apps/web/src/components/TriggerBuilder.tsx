/**
 * Structured trigger builder — shared by the message-template editor and the
 * cleaning-rule editor. Emits/parses the trigger DSL understood by
 * @cm/api services/triggers.ts:
 *
 *   reservation|checkin|checkout : ±Nd @ HH:MM   (property-local time)
 *   lastminute:Nd                                (fire immediately on booking,
 *                                                 only if booked ≤ N days before
 *                                                 check-in — no fixed clock time)
 *
 * Controlled component: parent owns the {anchor, rel, days, time, thresholdDays}
 * parts. `anchor === 'lastminute'` switches to the last-minute mode, where only
 * `thresholdDays` matters.
 */
import { Input } from './ui/Input';
import { Label } from './ui/Label';

export type Anchor = 'reservation' | 'checkin' | 'checkout' | 'lastminute';
export type Rel = 'before' | 'on' | 'after';

export interface TriggerParts {
  anchor: Anchor;
  rel: Rel;
  days: number; // 1–90, used when rel !== 'on'
  time: string; // HH:MM
  /** Last-minute mode: max days between booking and check-in to qualify (1–90). */
  thresholdDays: number;
  /**
   * Optional min lead time (days). Only for checkin + rel='before': fire only
   * if the booking was made at least this many days before check-in. 0/undefined
   * = no guard. Used to avoid overlap with a last-minute template.
   */
  minLeadDays?: number;
}

const ANCHOR_LABEL: Record<Anchor, string> = {
  reservation: 'Neue Reservierung',
  checkin: 'Check-in',
  checkout: 'Check-out',
  lastminute: 'Last-Minute-Buchung',
};

/** Anchors that use the relation/day/time controls (everything but lastminute). */
type TimedAnchor = Exclude<Anchor, 'lastminute'>;

/** Allowed relations per anchor + their labels (per the product spec). */
const REL_OPTIONS: Record<TimedAnchor, Array<{ rel: Rel; label: string }>> = {
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

/** Sensible defaults for parts not used by the current mode (no `rel`; callers
 *  set it explicitly so it can't be double-specified). */
const DEFAULTS = { days: 1, time: '18:00', thresholdDays: 2 };

export function buildTriggerDsl(p: TriggerParts): string {
  if (p.anchor === 'lastminute') {
    const t = Math.max(1, Math.min(90, p.thresholdDays || DEFAULTS.thresholdDays));
    return `lastminute:${t}d`;
  }
  if (p.rel === 'on') return `${p.anchor}:+0d@${p.time}`;
  const sign = p.rel === 'before' ? '-' : '+';
  let dsl = `${p.anchor}:${sign}${p.days}d@${p.time}`;
  // Min-lead guard only makes sense for "X days before check-in".
  if (p.anchor === 'checkin' && p.rel === 'before' && p.minLeadDays && p.minLeadDays >= 1) {
    dsl += `~minlead=${Math.min(90, Math.round(p.minLeadDays))}d`;
  }
  return dsl;
}

export function parseTriggerDsl(s: string): TriggerParts {
  // Legacy bare trigger → "on day of reservation" (time defaulted).
  if (s === 'booking_created')
    return { anchor: 'reservation', rel: 'on', ...DEFAULTS, time: '09:00' };
  const lm = /^lastminute:(\d{1,3})d$/.exec(s);
  if (lm) {
    return {
      anchor: 'lastminute',
      rel: 'on',
      days: 1,
      time: DEFAULTS.time,
      thresholdDays: Math.max(1, Math.min(90, Number(lm[1]) || DEFAULTS.thresholdDays)),
    };
  }
  const m = /^(reservation|checkin|checkout):([+-]?\d{1,3})d@(\d\d:\d\d)(?:~minlead=(\d{1,3})d)?$/.exec(s);
  if (!m) return { anchor: 'checkin', rel: 'before', days: 1, time: '18:00', thresholdDays: DEFAULTS.thresholdDays };
  const off = Number(m[2]);
  const anchor = m[1] as Anchor;
  const rel: Rel = off === 0 ? 'on' : off < 0 ? 'before' : 'after';
  return {
    anchor,
    rel,
    days: Math.min(90, Math.abs(off) || 1),
    time: m[3]!,
    thresholdDays: DEFAULTS.thresholdDays,
    ...(m[4] != null ? { minLeadDays: Math.min(90, Number(m[4])) } : {}),
  };
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
  const { anchor, rel, days, time, thresholdDays, minLeadDays } = value;
  const isLastMinute = anchor === 'lastminute';

  function changeAnchor(a: Anchor) {
    if (a === 'lastminute') {
      onChange({ ...value, anchor: a });
      return;
    }
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
        {anchor !== 'lastminute' && (
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
        )}
      </div>

      {isLastMinute ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted">Nur wenn Anreise in ≤</span>
            <Input
              type="number"
              min={1}
              max={90}
              value={thresholdDays}
              onChange={(e) =>
                onChange({
                  ...value,
                  thresholdDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)),
                })
              }
              className="w-20"
              aria-label="Tage bis Anreise"
            />
            <span className="text-[12.5px] text-muted">Tagen</span>
          </div>
          <p className="text-[11px] text-whisper">
            Wird sofort nach Buchungseingang gesendet — aber nur, wenn die
            Anreise innerhalb dieser Frist liegt. Ideal für den Check-in-Code
            bei kurzfristigen Buchungen. Für Buchungen mit mehr Vorlauf nutze
            zusätzlich eine reguläre „Tage vor Check-in"-Vorlage.
          </p>
        </>
      ) : (
        <>
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

          {/* Min-lead guard — only meaningful for "X days before check-in". */}
          {anchor === 'checkin' && rel === 'before' && (
            <label className="flex items-start gap-2 pt-1">
              <input
                type="checkbox"
                checked={(minLeadDays ?? 0) >= 1}
                onChange={(e) =>
                  onChange({
                    ...value,
                    minLeadDays: e.target.checked ? Math.max(1, days) : undefined,
                  })
                }
                className="mt-0.5"
              />
              <span className="text-[11.5px] text-muted">
                Nur senden, wenn die Buchung mindestens{' '}
                {(minLeadDays ?? 0) >= 1 ? (
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={minLeadDays}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        minLeadDays: Math.max(1, Math.min(90, Number(e.target.value) || 1)),
                      })
                    }
                    className="mx-1 w-14 h-7 rounded border border-line bg-surface px-1.5 text-[12px] text-ink"
                    aria-label="Mindestvorlauf in Tagen"
                  />
                ) : (
                  ' X '
                )}
                Tage im Voraus erfolgte (verhindert Doppelung mit der
                Last-Minute-Vorlage).
              </span>
            </label>
          )}
        </>
      )}
    </div>
  );
}
