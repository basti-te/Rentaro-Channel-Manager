import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  MessageSquare,
  AlertTriangle,
  Inbox,
  FileText,
  Plus,
  Pencil,
  Trash2,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

type RouterOutput = inferRouterOutputs<AppRouter>;
type Template = RouterOutput['messageTemplates']['list'][number];

type Tab = 'inbox' | 'templates';

const CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS',
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  email: 'E-Mail',
};

const TRIGGER_PRESETS = [
  'booking_created',
  'checkin:-1d@18:00',
  'checkin:+0d@10:00',
  'checkout:+0d@10:00',
];

export function MessagesPage() {
  const [tab, setTab] = useState<Tab>('inbox');

  return (
    <>
      <PageHeader
        title="Nachrichten"
        subtitle="Gast-Inbox (über Channex) und automatische Nachrichten-Vorlagen."
        action={
          <div
            className="inline-flex rounded-lg border border-line bg-surface p-0.5"
            role="tablist"
            aria-label="Nachrichten-Ansicht"
          >
            {(
              [
                { id: 'inbox' as const, label: 'Inbox', icon: Inbox },
                { id: 'templates' as const, label: 'Vorlagen', icon: FileText },
              ]
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px]',
                  'text-[13px] font-medium transition-colors',
                  tab === id
                    ? 'bg-brand text-white shadow-sm'
                    : 'text-muted hover:text-ink hover:bg-sunken',
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                {label}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'inbox' ? <InboxView /> : <TemplatesView />}
    </>
  );
}

// ─── Inbox (embedded Channex chat) ──────────────────────────────────────────

function InboxView() {
  const propsQ = trpc.properties.list.useQuery();
  const connected = useMemo(
    () => (propsQ.data ?? []).filter((p) => !!p.channexPropertyRef),
    [propsQ.data],
  );
  const [propertyId, setPropertyId] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId && connected.length > 0) setPropertyId(connected[0]!.id);
  }, [connected, propertyId]);

  const sessionQ = trpc.messages.iframeSession.useQuery(
    { propertyId: propertyId! },
    {
      enabled: !!propertyId,
      refetchOnWindowFocus: false,
      staleTime: 10 * 60_000,
      retry: false,
    },
  );
  const selectedName = connected.find((p) => p.id === propertyId)?.name ?? null;

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6">
      {connected.length > 0 && (
        <div className="mb-4">
          <select
            value={propertyId ?? ''}
            onChange={(e) => setPropertyId(e.target.value)}
            className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            aria-label="Apartment auswählen"
          >
            {connected.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {propsQ.isLoading ? (
        <Skeleton className="h-[70vh] w-full rounded-xl" />
      ) : connected.length === 0 ? (
        <InfoCard
          title="Kein verbundenes Apartment"
          body="Verbinde zuerst ein Apartment mit Channex (Seite „Apartments“), dann erscheint hier die Gast-Inbox."
        />
      ) : sessionQ.isLoading ? (
        <Skeleton className="h-[70vh] w-full rounded-xl" />
      ) : sessionQ.isError ? (
        <InfoCard
          variant="error"
          title="Inbox nicht verfügbar"
          body={
            sessionQ.error.message ||
            'Die Channex-Messaging-Session konnte nicht erstellt werden.'
          }
        />
      ) : sessionQ.data ? (
        <div className="rounded-xl border border-line overflow-hidden bg-surface shadow-sm">
          <iframe
            key={sessionQ.data.url}
            src={sessionQ.data.url}
            title={`Gast-Inbox ${selectedName ?? ''}`}
            className="w-full h-[calc(100dvh-260px)] min-h-[480px] block"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}
    </div>
  );
}

// ─── Templates ──────────────────────────────────────────────────────────────

function TemplatesView() {
  const utils = trpc.useUtils();
  const listQ = trpc.messageTemplates.list.useQuery();
  const [editing, setEditing] = useState<Template | 'new' | null>(null);

  const toggleActive = trpc.messageTemplates.update.useMutation({
    onSuccess: () => utils.messageTemplates.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.messageTemplates.delete.useMutation({
    onSuccess: () => {
      toast.success('Vorlage gelöscht');
      utils.messageTemplates.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 max-w-4xl">
      <div className="flex justify-between items-center mb-4">
        <p className="text-[13px] text-muted">
          Mehrere Vorlagen je Buchung möglich — jede mit festem Kanal. Der
          automatische Versand per Trigger folgt als nächster Schritt.
        </p>
        <Button
          variant="brand"
          size="sm"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setEditing('new')}
        >
          Neue Vorlage
        </Button>
      </div>

      <SmsSenderConfig />

      {listQ.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (listQ.data?.length ?? 0) === 0 ? (
        <InfoCard
          title="Noch keine Vorlagen"
          body="Lege eine Vorlage an (z. B. Check-in-Infos per SMS). Platzhalter wie {{guestName}} werden beim Versand ersetzt."
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {listQ.data!.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-ink truncate">
                      {t.name}
                    </span>
                    <span className="text-[10.5px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-brand-soft text-brand">
                      {CHANNEL_LABEL[t.channel] ?? t.channel}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted truncate mt-0.5">
                    <span className="num">{t.trigger}</span> · {t.language} ·{' '}
                    {t.body.slice(0, 70)}
                    {t.body.length > 70 ? '…' : ''}
                  </div>
                </div>
                <Switch
                  size="sm"
                  checked={t.active}
                  onChange={(next) =>
                    toggleActive.mutate({ id: t.id, active: next })
                  }
                  aria-label="Aktiv"
                />
                <button
                  type="button"
                  className="text-whisper hover:text-ink p-1.5 rounded hover:bg-sunken transition-colors"
                  onClick={() => setEditing(t)}
                  aria-label="Bearbeiten"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="text-whisper hover:text-negative p-1.5 rounded hover:bg-negative-soft transition-colors"
                  onClick={() => {
                    if (confirm(`Vorlage „${t.name}“ löschen?`)) del.mutate({ id: t.id });
                  }}
                  aria-label="Löschen"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <TemplateDialog
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            utils.messageTemplates.list.invalidate();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SmsSenderConfig() {
  const utils = trpc.useUtils();
  const tenantQ = trpc.settings.tenant.useQuery();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const save = trpc.settings.setSmsSenderId.useMutation({
    onSuccess: () => {
      toast.success('SMS-Absender gespeichert');
      utils.settings.tenant.invalidate();
      setEditing(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const current = tenantQ.data?.smsSenderId ?? null;

  return (
    <Card className="px-4 py-3 mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="text-[12px] uppercase tracking-wider text-muted font-medium">
            SMS-Absender
          </div>
          {!editing ? (
            <div className="text-[14px] text-ink mt-0.5">
              {current ? (
                <span className="font-medium">{current}</span>
              ) : (
                <span className="text-muted italic">
                  Standard (Konto-Vorgabe)
                </span>
              )}
              <span className="text-[12px] text-muted ml-2">
                — gilt für alle SMS dieses Workspaces
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1.5">
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="z. B. Information (≤11, Buchstaben/Ziffern)"
                maxLength={11}
                className="max-w-[260px]"
                autoFocus
              />
              <Button
                size="sm"
                variant="brand"
                loading={save.isPending}
                onClick={() => save.mutate({ smsSenderId: value.trim() })}
              >
                Speichern
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Abbrechen
              </Button>
              {current && (
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
        </div>
        {!editing && (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => {
              setValue(current ?? '');
              setEditing(true);
            }}
          >
            Ändern
          </Button>
        )}
      </div>
    </Card>
  );
}

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!template;
  const [name, setName] = useState(template?.name ?? '');
  const [chan, setChan] = useState<Template['channel']>(template?.channel ?? 'sms');
  const [trigger, setTrigger] = useState(template?.trigger ?? 'checkin:-1d@18:00');
  const [language, setLanguage] = useState(template?.language ?? 'de');
  const [body, setBody] = useState(template?.body ?? '');
  const [active, setActive] = useState(template?.active ?? true);
  const [testPhone, setTestPhone] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const varsQ = trpc.messageTemplates.vars.useQuery();

  const create = trpc.messageTemplates.create.useMutation({
    onSuccess: () => {
      toast.success('Vorlage erstellt');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.messageTemplates.update.useMutation({
    onSuccess: () => {
      toast.success('Vorlage gespeichert');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const sendTest = trpc.messageTemplates.sendTest.useMutation({
    onSuccess: (r) => {
      setPreview(r.preview);
      if (r.sent) toast.success(r.info ?? 'Test gesendet');
      else if (r.info) toast.message(r.info);
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !body.trim() || !trigger.trim()) return;
    if (isEdit && template) {
      update.mutate({ id: template.id, name, channel: chan, trigger, language, body, active });
    } else {
      create.mutate({ name, channel: chan, trigger, language, body, active });
    }
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
        <div className="px-6 pt-6 pb-2">
          <h2 className="display text-[20px] font-medium text-ink">
            {isEdit ? 'Vorlage bearbeiten' : 'Neue Vorlage'}
          </h2>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-3 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">Name</Label>
              <Input
                id="t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Check-in-Infos"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-chan">Kanal</Label>
              <select
                id="t-chan"
                value={chan}
                onChange={(e) => setChan(e.target.value as Template['channel'])}
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
              >
                <option value="sms">SMS</option>
                <option value="airbnb">Airbnb</option>
                <option value="booking_com">Booking.com</option>
                <option value="email">E-Mail</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-trigger">Trigger</Label>
              <Input
                id="t-trigger"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                required
              />
              <div className="flex flex-wrap gap-1 pt-1">
                {TRIGGER_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setTrigger(p)}
                    className="num text-[10.5px] px-1.5 py-0.5 rounded bg-sunken text-muted hover:text-ink"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-lang">Sprache</Label>
              <Input
                id="t-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="de"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-body">Nachricht</Label>
            <textarea
              id="t-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              required
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none transition-colors resize-y"
              placeholder="Hallo {{guestName}}, dein Check-in in {{propertyName}} ist am {{checkinDate}} ab {{checkinTime}} Uhr."
            />
            <div className="flex flex-wrap gap-1 pt-0.5">
              {(varsQ.data ?? []).map((v) => (
                <button
                  key={v.key}
                  type="button"
                  title={v.label}
                  onClick={() => setBody((b) => `${b}{{${v.key}}}`)}
                  className="num text-[10.5px] px-1.5 py-0.5 rounded bg-sunken text-muted hover:text-ink"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-line px-3.5 py-2.5">
            <div className="text-[13px] font-medium text-ink">Aktiv</div>
            <Switch checked={active} onChange={setActive} />
          </div>

          {/* Vorschau & Test */}
          <div className="rounded-lg border border-line p-3.5 space-y-2.5">
            <div className="text-[12px] font-medium text-muted uppercase tracking-wider">
              Vorschau &amp; Test
            </div>
            {preview != null && (
              <div className="text-[13px] text-ink whitespace-pre-wrap bg-sunken/60 rounded p-2.5">
                {preview}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+49170… (nur SMS-Test)"
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={sendTest.isPending}
                iconLeft={<Send className="h-3.5 w-3.5" />}
                onClick={() =>
                  sendTest.mutate({
                    body,
                    channel: chan,
                    toPhone: testPhone.trim() || undefined,
                  })
                }
                disabled={!body.trim()}
              >
                Test senden
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="brand"
              loading={create.isPending || update.isPending}
            >
              {isEdit ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── shared ─────────────────────────────────────────────────────────────────

function InfoCard({
  title,
  body,
  variant = 'default',
}: {
  title: string;
  body: string;
  variant?: 'default' | 'error';
}) {
  const isError = variant === 'error';
  return (
    <Card className="p-10 text-center max-w-[52ch] mx-auto">
      <div
        className={cn(
          'mx-auto h-12 w-12 rounded-md flex items-center justify-center mb-4',
          isError ? 'bg-negative-soft text-negative' : 'bg-brand-soft text-brand',
        )}
      >
        {isError ? (
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
        ) : (
          <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
        )}
      </div>
      <h3 className="display text-[20px] font-medium text-ink">{title}</h3>
      <p className="mt-2 text-[13px] text-muted leading-relaxed">{body}</p>
    </Card>
  );
}
