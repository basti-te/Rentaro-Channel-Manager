import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { SectionCard } from '../components/ui/SectionCard';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

type TenantData = inferRouterOutputs<AppRouter>['settings']['tenant'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NotificationsPage() {
  const utils = trpc.useUtils();
  const meQ = trpc.me.current.useQuery();
  const tenantQ = trpc.settings.tenant.useQuery();

  const role = meQ.data?.memberships?.[0]?.role;
  const isAdmin = role === 'owner' || role === 'admin';

  return (
    <>
      <PageHeader
        title="Benachrichtigungen"
        subtitle="E-Mail-Benachrichtigungen bei wichtigen Ereignissen."
      />
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-5">
        {!isAdmin && meQ.data && (
          <Card className="px-4 py-3 bg-warning-soft/40 border-warning/30">
            <p className="text-[12.5px] text-ink-soft">
              Nur Owner/Admin können Einstellungen ändern — du kannst sie ansehen.
            </p>
          </Card>
        )}

        {tenantQ.isLoading || !tenantQ.data ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : (
          <NotificationsSection
            data={tenantQ.data}
            ownerEmail={meQ.data?.user?.email ?? null}
            disabled={!isAdmin}
            onSaved={() => utils.settings.tenant.invalidate()}
          />
        )}
      </div>
    </>
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
