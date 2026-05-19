import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';
import { cn } from '@cm/ui';

type TenantData = inferRouterOutputs<AppRouter>['settings']['tenant'];

import { PageHeader } from './_dashboard';
import { Trash2, Plus } from 'lucide-react';
import { BillingCard } from '../components/BillingCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

const SELECT_CLS =
  'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors disabled:opacity-60';

/** Full IANA / ISO-4217 lists via Intl, with a tiny fallback. */
function intlValues(kind: 'timeZone' | 'currency', fallback: string[]): string[] {
  const fn = (Intl as unknown as {
    supportedValuesOf?: (k: string) => string[];
  }).supportedValuesOf;
  try {
    const v = fn?.(kind);
    return v && v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

const TZ_FALLBACK = [
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/London',
  'Europe/Madrid',
  'UTC',
];
const CUR_FALLBACK = ['EUR', 'USD', 'GBP', 'CHF'];

/**
 * Pin a preferred default (Berlin / EUR) to the top, keep the saved value
 * selectable, then the full alphabetical list — deduplicated.
 */
function withPreferred(
  list: string[],
  preferred: string,
  current: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [preferred, current, ...list]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

const DEFAULT_TZ = 'Europe/Berlin';
const DEFAULT_CURRENCY = 'EUR';

const currencyName = (() => {
  try {
    const dn = new Intl.DisplayNames(['de'], { type: 'currency' });
    return (code: string) => {
      try {
        const n = dn.of(code);
        return n && n !== code ? `${code} — ${n}` : code;
      } catch {
        return code;
      }
    };
  } catch {
    return (code: string) => code;
  }
})();

export function SettingsPage() {
  const utils = trpc.useUtils();
  const meQ = trpc.me.current.useQuery();
  const tenantQ = trpc.settings.tenant.useQuery();

  const role = meQ.data?.memberships?.[0]?.role;
  const isAdmin = role === 'owner' || role === 'admin';

  return (
    <>
      <PageHeader
        title="Einstellungen"
        subtitle="Workspace-Standards, Preis-Quelle und SMS-Absender."
      />
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-5">
        {!isAdmin && meQ.data && (
          <Card className="px-4 py-3 bg-warning-soft/40 border-warning/30">
            <p className="text-[12.5px] text-ink-soft">
              Nur Owner/Admin können Einstellungen ändern — du kannst sie
              ansehen.
            </p>
          </Card>
        )}

        {tenantQ.isLoading || !tenantQ.data ? (
          <>
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </>
        ) : (
          <>
            <GeneralSection
              data={tenantQ.data}
              disabled={!isAdmin}
              onSaved={() => utils.settings.tenant.invalidate()}
            />
            <RateSourceSection
              value={tenantQ.data.rateSource}
              disabled={!isAdmin}
              onSaved={() => utils.settings.tenant.invalidate()}
            />
            <SmsSenderSection
              value={tenantQ.data.smsSenderId}
              disabled={!isAdmin}
              onSaved={() => utils.settings.tenant.invalidate()}
            />
            <TeammatesSection disabled={!isAdmin} />
            <BillingCard context="settings" />
          </>
        )}
      </div>
    </>
  );
}

function SectionCard({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="mb-3">
        <h2 className="display text-[16px] font-medium text-ink">{title}</h2>
        {desc && <p className="text-[12.5px] text-muted mt-0.5">{desc}</p>}
      </div>
      {children}
    </Card>
  );
}

function GeneralSection({
  data,
  disabled,
  onSaved,
}: {
  data: TenantData;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(data.name);
  const [tz, setTz] = useState(data.defaultTimezone);
  const [currency, setCurrency] = useState(data.defaultCurrency);
  const [taxPct, setTaxPct] = useState(
    (data.defaultCityTaxRateBp / 100).toString(),
  );
  const tzOptions = useMemo(
    () =>
      withPreferred(
        intlValues('timeZone', TZ_FALLBACK),
        DEFAULT_TZ,
        data.defaultTimezone,
      ),
    [data.defaultTimezone],
  );
  const curOptions = useMemo(
    () =>
      withPreferred(
        intlValues('currency', CUR_FALLBACK),
        DEFAULT_CURRENCY,
        data.defaultCurrency,
      ),
    [data.defaultCurrency],
  );
  const [ci, setCi] = useState(data.defaultCheckinTime);
  const [co, setCo] = useState(data.defaultCheckoutTime);

  // Re-seed if the query refetches with new values.
  useEffect(() => {
    setName(data.name);
    setTz(data.defaultTimezone);
    setCurrency(data.defaultCurrency);
    setTaxPct((data.defaultCityTaxRateBp / 100).toString());
    setCi(data.defaultCheckinTime);
    setCo(data.defaultCheckoutTime);
  }, [data]);

  const save = trpc.settings.updateTenant.useMutation({
    onSuccess: () => {
      toast.success('Einstellungen gespeichert');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const pctNum = Number(taxPct.replace(',', '.'));
  const pctValid = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled || !pctValid) return;
    save.mutate({
      name: name.trim(),
      defaultTimezone: tz.trim(),
      defaultCurrency: currency.trim().toUpperCase(),
      defaultCityTaxRateBp: Math.round(pctNum * 100),
      defaultCheckinTime: ci,
      defaultCheckoutTime: co,
    });
  }

  return (
    <SectionCard
      title="Allgemein"
      desc="Standardwerte für neue Buchungen und Anzeige."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="s-name">Workspace-Name</Label>
          <Input
            id="s-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="s-tz">Zeitzone</Label>
            <select
              id="s-tz"
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              disabled={disabled}
              className={SELECT_CLS}
            >
              {tzOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-cur">Währung</Label>
            <select
              id="s-cur"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={disabled}
              className={SELECT_CLS}
            >
              {curOptions.map((c) => (
                <option key={c} value={c}>
                  {currencyName(c)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="s-tax">City-Tax (%)</Label>
            <Input
              id="s-tax"
              inputMode="decimal"
              value={taxPct}
              onChange={(e) => setTaxPct(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-ci">Check-in</Label>
            <Input
              id="s-ci"
              type="time"
              value={ci}
              onChange={(e) => setCi(e.target.value)}
              disabled={disabled}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-co">Check-out</Label>
            <Input
              id="s-co"
              type="time"
              value={co}
              onChange={(e) => setCo(e.target.value)}
              disabled={disabled}
              required
            />
          </div>
        </div>
        {!pctValid && (
          <p className="text-[12px] text-negative">
            City-Tax muss zwischen 0 und 100 % liegen.
          </p>
        )}
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="brand"
            size="sm"
            loading={save.isPending}
            disabled={disabled || !pctValid}
          >
            Speichern
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function RateSourceSection({
  value,
  disabled,
  onSaved,
}: {
  value: 'pms' | 'pricelabs';
  disabled: boolean;
  onSaved: () => void;
}) {
  const save = trpc.settings.setRateSource.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.changed
          ? `Rate-Quelle: ${r.rateSource} — ${r.properties ?? 0} Apartment(s) neu synchronisiert`
          : 'Unverändert',
      );
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <SectionCard
      title="Preis-Quelle"
      desc="Wer setzt die Nachtpreise in Channex? PMS = wir pushen; PriceLabs = PriceLabs schreibt direkt (wir pushen nur Restriktionen)."
    >
      <div
        className="inline-flex rounded-lg border border-line bg-surface p-0.5"
        role="tablist"
        aria-label="Preis-Quelle"
      >
        {(['pms', 'pricelabs'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={disabled || save.isPending}
            aria-selected={value === opt}
            onClick={() => value !== opt && save.mutate({ rateSource: opt })}
            className={cn(
              'px-3.5 py-1.5 rounded-[7px] text-[13px] font-medium transition-colors',
              value === opt
                ? 'bg-brand text-white shadow-sm'
                : 'text-muted hover:text-ink hover:bg-sunken',
              disabled && 'opacity-60 cursor-not-allowed',
            )}
          >
            {opt === 'pms' ? 'PMS (wir pushen)' : 'PriceLabs'}
          </button>
        ))}
      </div>
      <p className="text-[11.5px] text-whisper mt-2">
        Beim Umschalten werden Raten/Restriktionen für alle verbundenen
        Apartments über ~180 Tage neu an Channex gemeldet.
      </p>
    </SectionCard>
  );
}

function SmsSenderSection({
  value,
  disabled,
  onSaved,
}: {
  value: string | null;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');

  const save = trpc.settings.setSmsSenderId.useMutation({
    onSuccess: () => {
      toast.success('SMS-Absender gespeichert');
      onSaved();
      setEditing(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <SectionCard
      title="SMS-Absender"
      desc="Alphanumerischer Absender für ausgehende SMS dieses Workspaces (≤11 Zeichen, ≥1 Buchstabe). Leer = Konto-Standard."
    >
      {!editing ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[14px] text-ink">
            {value ? (
              <span className="font-medium">{value}</span>
            ) : (
              <span className="text-muted italic">Standard (Konto-Vorgabe)</span>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setV(value ?? '');
              setEditing(true);
            }}
          >
            Ändern
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="z. B. Information"
            maxLength={11}
            className="max-w-[260px]"
            autoFocus
          />
          <Button
            size="sm"
            variant="brand"
            loading={save.isPending}
            onClick={() => save.mutate({ smsSenderId: v.trim() })}
          >
            Speichern
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Abbrechen
          </Button>
          {value && (
            <button
              type="button"
              className="text-[12px] text-muted hover:text-negative"
              onClick={() => save.mutate({ smsSenderId: '' })}
            >
              Auf Standard zurücksetzen
            </button>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function TeammatesSection({ disabled }: { disabled: boolean }) {
  const utils = trpc.useUtils();
  const listQ = trpc.teammates.list.useQuery();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const refresh = () => utils.teammates.list.invalidate();
  const create = trpc.teammates.create.useMutation({
    onSuccess: () => {
      toast.success('Teammate angelegt');
      setName('');
      setPhone('');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.teammates.update.useMutation({
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.teammates.delete.useMutation({
    onSuccess: () => {
      toast.success('Teammate gelöscht');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const phoneValid = /^\+[1-9]\d{6,14}$/.test(phone.trim());

  return (
    <SectionCard
      title="Teammates"
      desc="Cleaner / interne Empfänger für die Reinigungs-Erinnerungen (SMS). Telefon im Format +49170…"
    >
      {!disabled && (
        <div className="flex items-end gap-2 flex-wrap mb-3">
          <div className="space-y-1 flex-1 min-w-[160px]">
            <Label htmlFor="tm-name">Name</Label>
            <Input
              id="tm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Anna"
            />
          </div>
          <div className="space-y-1 min-w-[160px]">
            <Label htmlFor="tm-phone">Telefon</Label>
            <Input
              id="tm-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+49170…"
            />
          </div>
          <Button
            variant="brand"
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            loading={create.isPending}
            disabled={!name.trim() || !phoneValid}
            onClick={() =>
              create.mutate({ name: name.trim(), phone: phone.trim() })
            }
          >
            Teammate
          </Button>
        </div>
      )}

      {listQ.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (listQ.data?.length ?? 0) === 0 ? (
        <p className="text-[12.5px] text-muted">
          Noch keine Teammates angelegt.
        </p>
      ) : (
        <ul className="rounded-md border border-line divide-y divide-line">
          {listQ.data!.map((tm) => (
            <li key={tm.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] text-ink truncate">
                  {tm.name}
                </div>
                <div className="num text-[12px] text-muted">{tm.phone}</div>
              </div>
              <Switch
                size="sm"
                checked={tm.active}
                onChange={(next) =>
                  update.mutate({ id: tm.id, active: next })
                }
                aria-label="Aktiv"
                disabled={disabled}
              />
              {!disabled && (
                <button
                  type="button"
                  className="text-whisper hover:text-negative p-1.5 rounded hover:bg-negative-soft transition-colors"
                  onClick={() => {
                    if (confirm(`Teammate „${tm.name}“ löschen?`))
                      del.mutate({ id: tm.id });
                  }}
                  aria-label="Löschen"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
