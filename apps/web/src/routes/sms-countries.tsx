import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Search, Check, TriangleAlert } from 'lucide-react';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

const EUR = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});
/** Cents at/above which a destination is visibly flagged as costly (~2× DACH). */
const EXPENSIVE_MINOR = 25;

/** ISO-3166 alpha-2 → flag emoji (regional indicators). */
function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + code.charCodeAt(0) - 65,
    base + code.charCodeAt(1) - 65,
  );
}

export function SmsCountriesPage() {
  const utils = trpc.useUtils();
  const q = trpc.sms.countries.useQuery();

  const [sel, setSel] = useState<Set<string> | null>(null);
  const [query, setQuery] = useState('');
  const [onlyAllowed, setOnlyAllowed] = useState(false);

  const serverSet = useMemo(
    () =>
      new Set(
        (q.data?.countries ?? []).filter((c) => c.allowed).map((c) => c.code),
      ),
    [q.data],
  );
  useEffect(() => {
    if (q.data && sel === null) setSel(new Set(serverSet));
  }, [q.data, sel, serverSet]);

  const save = trpc.sms.setAllowedCountries.useMutation({
    onSuccess: () => {
      void utils.sms.countries.invalidate();
      toast.success('SMS-Länder gespeichert');
    },
    onError: (e) => toast.error(e.message),
  });

  const countries = q.data?.countries ?? [];
  const current = sel ?? serverSet;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return countries.filter((c) => {
      if (onlyAllowed && !current.has(c.code)) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.code.toLowerCase().includes(needle)
      );
    });
  }, [countries, query, onlyAllowed, current]);

  const dirty = useMemo(() => {
    if (!sel) return false;
    if (sel.size !== serverSet.size) return true;
    for (const c of sel) if (!serverSet.has(c)) return true;
    return false;
  }, [sel, serverSet]);

  const added = useMemo(
    () => (sel ? [...sel].filter((c) => !serverSet.has(c)).length : 0),
    [sel, serverSet],
  );
  const removed = useMemo(
    () => (sel ? [...serverSet].filter((c) => !sel.has(c)).length : 0),
    [sel, serverSet],
  );

  function toggle(code: string) {
    setSel((prev) => {
      const next = new Set(prev ?? serverSet);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }
  function setVisible(on: boolean) {
    setSel((prev) => {
      const next = new Set(prev ?? serverSet);
      for (const c of filtered) on ? next.add(c.code) : next.delete(c.code);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title="SMS-Länder"
        subtitle="Lege fest, in welche Länder SMS gesendet werden dürfen — mit Endkundenpreis pro SMS. Nicht freigeschaltete Länder werden übersprungen (keine Kosten)."
      />

      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-4">
        {/* Controls */}
        <Card className="px-4 py-3.5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] text-ink-soft">
              <span className="font-semibold text-ink tabular-nums">
                {current.size}
              </span>{' '}
              von {countries.length} Ländern erlaubt
            </div>
            <div className="flex rounded-md border border-line p-0.5">
              {(
                [
                  ['all', 'Alle'],
                  ['allowed', 'Erlaubte'],
                ] as const
              ).map(([key, label]) => {
                const active = (key === 'allowed') === onlyAllowed;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setOnlyAllowed(key === 'allowed')}
                    className={cn(
                      'rounded px-2.5 py-1 text-[12px] font-medium transition-colors',
                      active
                        ? 'bg-ink text-surface'
                        : 'text-muted hover:text-ink',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-whisper"
              strokeWidth={1.75}
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Land oder Code suchen … (z. B. Deutschland, DE)"
              className="h-10 pl-9"
              aria-label="Land suchen"
            />
          </div>

          <div className="flex items-center justify-between text-[11.5px] text-whisper">
            <span>
              Preis = Endkundenpreis je SMS-Segment (inkl. Aufschlag ×
              {q.data?.markup ?? 1.5}). Versand nur in am Twilio-Konto
              freigeschaltete Länder.
            </span>
            {filtered.length > 0 && (
              <span className="flex flex-shrink-0 gap-2 pl-3">
                <button
                  type="button"
                  className="font-medium text-ink-soft hover:text-ink"
                  onClick={() => setVisible(true)}
                >
                  alle
                </button>
                <span className="text-line">·</span>
                <button
                  type="button"
                  className="font-medium text-ink-soft hover:text-ink"
                  onClick={() => setVisible(false)}
                >
                  keine
                </button>
              </span>
            )}
          </div>
        </Card>

        {/* List */}
        {q.isLoading || !sel ? (
          <Skeleton className="h-96 w-full rounded-xl" />
        ) : (
          <Card className="overflow-hidden">
            <div className="divide-y divide-line">
              {filtered.length === 0 ? (
                <p className="px-5 py-10 text-center text-[13px] text-muted">
                  Kein Land gefunden.
                </p>
              ) : (
                filtered.map((c) => {
                  const checked = current.has(c.code);
                  const costly = c.priceMinor >= EXPENSIVE_MINOR;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => toggle(c.code)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        checked ? 'bg-brand-soft/40' : 'hover:bg-sunken',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                          checked
                            ? 'border-brand bg-brand text-white'
                            : 'border-line bg-surface',
                        )}
                      >
                        {checked && (
                          <Check className="h-3 w-3" strokeWidth={3} />
                        )}
                      </span>
                      <span className="text-[17px] leading-none">
                        {flagEmoji(c.code)}
                      </span>
                      <span className="flex-1 truncate text-[13.5px] text-ink">
                        {c.name}
                        <span className="ml-1.5 text-[11px] text-whisper">
                          {c.code}
                        </span>
                      </span>
                      {costly && (
                        <TriangleAlert
                          className="h-3.5 w-3.5 flex-shrink-0 text-warning"
                          strokeWidth={2}
                          aria-label="teures Ziel"
                        />
                      )}
                      <span
                        className={cn(
                          'w-[64px] flex-shrink-0 text-right text-[13px] tabular-nums',
                          costly
                            ? 'font-semibold text-warning'
                            : 'text-ink-soft',
                        )}
                      >
                        {EUR.format(c.priceMinor / 100)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Sticky save bar */}
      {dirty && sel && (
        <div className="pointer-events-none sticky bottom-0 z-10 px-4 pb-4 sm:px-6 md:px-8">
          <div className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
            <span className="flex-1 text-[12.5px] text-ink-soft">
              {added > 0 && (
                <span className="font-medium text-positive">+{added}</span>
              )}
              {added > 0 && removed > 0 && ' · '}
              {removed > 0 && (
                <span className="font-medium text-negative">−{removed}</span>
              )}{' '}
              {added + removed === 1 ? 'Änderung' : 'Änderungen'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSel(new Set(serverSet))}
            >
              Zurücksetzen
            </Button>
            <Button
              size="sm"
              variant="brand"
              loading={save.isPending}
              onClick={() => save.mutate({ codes: [...sel] })}
            >
              Speichern
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
