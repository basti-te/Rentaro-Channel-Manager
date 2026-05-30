import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';
import { cn } from '@cm/ui';

type TenantData = inferRouterOutputs<AppRouter>['settings']['tenant'];

import { PageHeader } from './_dashboard';
import { Trash2, Plus, Pencil, Star, X, MessageSquareQuote } from 'lucide-react';
import { BillingCard } from '../components/BillingCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

import {
  CURRENCY_FALLBACK,
  TIMEZONE_FALLBACK,
  currencyName,
  intlSupported,
  withPreferred,
} from '../lib/locale-options';

const SELECT_CLS =
  'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors disabled:opacity-60';

const DEFAULT_TZ = 'Europe/Berlin';
const DEFAULT_CURRENCY = 'EUR';

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
            <NotificationsSection
              data={tenantQ.data}
              ownerEmail={meQ.data?.user?.email ?? null}
              disabled={!isAdmin}
              onSaved={() => utils.settings.tenant.invalidate()}
            />
            <TeammatesSection disabled={!isAdmin} />
            <ReviewTemplatesSection disabled={!isAdmin} />
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
        intlSupported('timeZone', TIMEZONE_FALLBACK),
        DEFAULT_TZ,
        data.defaultTimezone,
      ),
    [data.defaultTimezone],
  );
  const curOptions = useMemo(
    () =>
      withPreferred(
        intlSupported('currency', CURRENCY_FALLBACK),
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

function NotifyToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <div className="min-w-0">
        <div className="text-[13.5px] text-ink">{label}</div>
        <div className="text-[12px] text-muted">{desc}</div>
      </div>
      <Switch
        size="sm"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function NotificationsSection({
  data,
  ownerEmail,
  disabled,
  onSaved,
}: {
  data: TenantData;
  ownerEmail: string | null;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(data.notifyEmail ?? '');
  const [newBooking, setNewBooking] = useState(data.notifyNewBooking);
  const [cancellation, setCancellation] = useState(data.notifyCancellation);
  const [modification, setModification] = useState(data.notifyModification);
  const [syncError, setSyncError] = useState(data.notifySyncError);

  // Re-seed if the query refetches with new values.
  useEffect(() => {
    setEmail(data.notifyEmail ?? '');
    setNewBooking(data.notifyNewBooking);
    setCancellation(data.notifyCancellation);
    setModification(data.notifyModification);
    setSyncError(data.notifySyncError);
  }, [data]);

  const save = trpc.settings.setNotifications.useMutation({
    onSuccess: () => {
      toast.success('Benachrichtigungen gespeichert');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const trimmed = email.trim();
  const noEmail = trimmed === '';
  const emailValid = noEmail || EMAIL_RE.test(trimmed);
  const dirty =
    trimmed !== (data.notifyEmail ?? '') ||
    newBooking !== data.notifyNewBooking ||
    cancellation !== data.notifyCancellation ||
    modification !== data.notifyModification ||
    syncError !== data.notifySyncError;

  return (
    <SectionCard
      title="Benachrichtigungen"
      desc="E-Mail-Benachrichtigungen bei wichtigen Ereignissen. Leeres Adressfeld = deaktiviert."
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="notify-email">Ziel-E-Mail-Adresse</Label>
          <Input
            id="notify-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={ownerEmail ?? 'name@beispiel.de'}
            disabled={disabled}
            className="max-w-[360px]"
            aria-invalid={!emailValid}
          />
          {!emailValid ? (
            <p className="text-[11.5px] text-negative">
              Bitte eine gültige E-Mail-Adresse eingeben.
            </p>
          ) : noEmail ? (
            <p className="text-[11.5px] text-whisper">
              Keine Adresse hinterlegt — es werden keine Benachrichtigungen
              versendet.
              {ownerEmail && !disabled && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="text-brand hover:underline"
                    onClick={() => setEmail(ownerEmail)}
                  >
                    {ownerEmail} übernehmen
                  </button>
                </>
              )}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-line divide-y divide-line">
          <NotifyToggleRow
            label="Neue Buchung"
            desc="Wenn eine neue OTA-Buchung eingeht."
            checked={newBooking}
            onChange={setNewBooking}
            disabled={disabled}
          />
          <NotifyToggleRow
            label="Stornierung"
            desc="Wenn eine Buchung storniert wird."
            checked={cancellation}
            onChange={setCancellation}
            disabled={disabled}
          />
          <NotifyToggleRow
            label="Buchungsänderung"
            desc="Wenn sich Daten einer bestehenden Buchung ändern."
            checked={modification}
            onChange={setModification}
            disabled={disabled}
          />
          <NotifyToggleRow
            label="Technische Fehler / Sync"
            desc="Wenn die Synchronisierung mit Channex fehlschlägt."
            checked={syncError}
            onChange={setSyncError}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="brand"
            size="sm"
            loading={save.isPending}
            disabled={disabled || !dirty || !emailValid}
            onClick={() =>
              save.mutate({
                notifyEmail: trimmed,
                notifyNewBooking: newBooking,
                notifyCancellation: cancellation,
                notifyModification: modification,
                notifySyncError: syncError,
              })
            }
          >
            Speichern
          </Button>
        </div>
      </div>
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

// ─── Review Templates (Auto-Review) ──────────────────────────────────────────

type ReviewTemplate = inferRouterOutputs<AppRouter>['reviewTemplates']['list'][number];

function ReviewTemplatesSection({ disabled }: { disabled: boolean }) {
  const utils = trpc.useUtils();
  const q = trpc.reviewTemplates.list.useQuery();
  const [editing, setEditing] = useState<ReviewTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  const del = trpc.reviewTemplates.delete.useMutation({
    onSuccess: () => {
      toast.success('Template gelöscht');
      void utils.reviewTemplates.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const list = q.data ?? [];

  return (
    <SectionCard
      title="Bewertungs-Templates (Auto-Review)"
      desc="Vorgeschriebene Texte, die 3 Tage nach Checkout automatisch an deine Gäste gesendet werden. Variablen wie {{guestName}}, {{propertyName}}, {{nights}} werden mit den echten Buchungsdaten ersetzt."
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-[12.5px] text-muted leading-relaxed">
          Pro Sprache (DE / EN) kann ein Template als <span className="font-medium text-ink">Standard</span>{' '}
          markiert werden — das wird automatisch genommen.
        </p>
        <Button
          variant="brand"
          size="sm"
          iconLeft={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setCreating(true)}
          disabled={disabled}
        >
          Neues Template
        </Button>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-6 text-center">
          <MessageSquareQuote className="h-5 w-5 mx-auto text-muted" strokeWidth={1.75} />
          <p className="mt-2 text-[13px] text-muted">
            Noch keine Bewertungs-Templates. Leg eins an, damit Auto-Review starten kann.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((t) => (
            <ReviewTemplateRow
              key={t.id}
              template={t}
              disabled={disabled}
              onEdit={() => setEditing(t)}
              onDelete={() => {
                if (
                  confirm(
                    `Template "${t.name}" wirklich löschen? Auto-Review zieht dann das nächste verfügbare Template (oder pausiert, wenn keins mehr da ist).`,
                  )
                ) {
                  del.mutate({ id: t.id });
                }
              }}
            />
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <ReviewTemplateEditor
          template={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            void utils.reviewTemplates.list.invalidate();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </SectionCard>
  );
}

function ReviewTemplateRow({
  template,
  disabled,
  onEdit,
  onDelete,
}: {
  template: ReviewTemplate;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="rounded-lg border border-line bg-canvas/60 px-4 py-3 flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-medium text-ink truncate">
            {template.name}
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sunken text-[10.5px] uppercase tracking-wider text-muted font-semibold">
            {template.language.toUpperCase()}
          </span>
          {template.isDefault && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-brand-soft text-brand text-[10.5px] uppercase tracking-wider font-semibold border border-brand/30">
              Standard
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 text-brand">
            {Array.from({ length: template.starRating }).map((_, i) => (
              <Star key={i} className="h-3 w-3 fill-current" strokeWidth={0} />
            ))}
          </span>
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted leading-relaxed line-clamp-2">
          {template.body}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Pencil className="h-3.5 w-3.5" />}
          onClick={onEdit}
          disabled={disabled}
        >
          <span className="hidden sm:inline">Bearbeiten</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Trash2 className="h-3.5 w-3.5" />}
          onClick={onDelete}
          disabled={disabled}
        >
          <span className="hidden sm:inline">Löschen</span>
        </Button>
      </div>
    </li>
  );
}

const REVIEW_VARS = [
  { key: 'guestName', label: 'Gastname' },
  { key: 'propertyName', label: 'Apartment' },
  { key: 'nights', label: 'Nächte' },
  { key: 'checkinDate', label: 'Anreise' },
  { key: 'checkoutDate', label: 'Abreise' },
  { key: 'guestCount', label: 'Anzahl Gäste' },
];

function ReviewTemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: ReviewTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!template;
  const [name, setName] = useState(template?.name ?? '');
  const [language, setLanguage] = useState<'de' | 'en'>(
    (template?.language as 'de' | 'en') ?? 'de',
  );
  const [body, setBody] = useState(template?.body ?? '');
  const [starRating, setStarRating] = useState<number>(
    template?.starRating ?? 5,
  );
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = trpc.reviewTemplates.create.useMutation({
    onSuccess: () => {
      toast.success('Template erstellt');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.reviewTemplates.update.useMutation({
    onSuccess: () => {
      toast.success('Änderungen gespeichert');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !body.trim()) return;
    const payload = {
      name: name.trim(),
      language,
      body: body.trim(),
      starRating,
      isDefault,
    };
    if (isEdit && template) {
      update.mutate({ id: template.id, ...payload });
    } else {
      create.mutate(payload);
    }
  }

  function insertVar(key: string) {
    setBody((b) => b + `{{${key}}}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-[560px] bg-surface rounded-t-2xl sm:rounded-xl shadow-lg border border-line animate-fade-up max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4">
          <div>
            <h2 className="display text-[22px] font-medium text-ink">
              {isEdit ? 'Template bearbeiten' : 'Neues Bewertungs-Template'}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              Klicke unten auf eine Variable, um sie in den Text einzufügen.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink p-1"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="rt-name">Name (intern)</Label>
              <Input
                id="rt-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. DE Standard 5 Sterne"
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rt-lang">Sprache</Label>
              <select
                id="rt-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'de' | 'en')}
                className={SELECT_CLS}
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rt-body">Bewertungs-Text</Label>
            <textarea
              id="rt-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={2000}
              placeholder="Vielen Dank an {{guestName}} für den entspannten Aufenthalt in {{propertyName}}. Die Übergabe war problemlos und das Apartment wurde sauber hinterlassen — gerne wieder."
              className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink focus:border-ink focus:outline-none transition-colors leading-relaxed"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {REVIEW_VARS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVar(v.key)}
                  className="text-[11px] px-2 py-1 rounded-md border border-line bg-canvas hover:bg-sunken text-ink-soft hover:text-ink transition-colors"
                  title={`Fügt {{${v.key}}} ein`}
                >
                  {`{{${v.key}}}`} <span className="text-muted">· {v.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Sterne-Bewertung</Label>
              <div className="h-10 flex items-center gap-1.5 px-3 rounded-md border border-line bg-surface">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStarRating(n)}
                    className="p-0.5"
                    aria-label={`${n} Sterne`}
                  >
                    <Star
                      className={cn(
                        'h-4 w-4 transition-colors',
                        n <= starRating
                          ? 'text-brand fill-current'
                          : 'text-line-strong',
                      )}
                      strokeWidth={n <= starRating ? 0 : 1.75}
                    />
                  </button>
                ))}
                <span className="ml-2 text-[12px] text-muted">
                  {starRating} / 5
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Standard für diese Sprache</Label>
              <div className="h-10 flex items-center justify-between px-3 rounded-md border border-line bg-surface">
                <span className="text-[12.5px] text-muted">
                  Auto-Pick für Auto-Review
                </span>
                <Switch checked={isDefault} onChange={setIsDefault} />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={pending}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="brand"
              loading={pending}
              disabled={!name.trim() || !body.trim() || pending}
            >
              {isEdit ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
