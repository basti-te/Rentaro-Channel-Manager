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
  Braces,
} from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import {
  TriggerBuilder,
  buildTriggerDsl,
  parseTriggerDsl,
} from '../components/TriggerBuilder';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

type RouterOutput = inferRouterOutputs<AppRouter>;
type Template = RouterOutput['messageTemplates']['list'][number];

type Tab = 'inbox' | 'templates' | 'variables';

const CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS',
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  email: 'E-Mail',
};

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
                { id: 'variables' as const, label: 'Variablen', icon: Braces },
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
      {tab === 'inbox' ? (
        <InboxView />
      ) : tab === 'templates' ? (
        <TemplatesView />
      ) : (
        <VariablesView />
      )}
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
  const [trig, setTrig] = useState(() =>
    parseTriggerDsl(template?.trigger ?? 'checkin:-1d@18:00'),
  );
  const [language, setLanguage] = useState(template?.language ?? 'de');
  const [body, setBody] = useState(template?.body ?? '');
  const [active, setActive] = useState(template?.active ?? true);
  const [listingIds, setListingIds] = useState<Set<string>>(
    new Set(template?.listingIds ?? []),
  );
  const [testPhone, setTestPhone] = useState('');
  const [testPropertyId, setTestPropertyId] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const varsQ = trpc.messageTemplates.vars.useQuery();
  const propsQ = trpc.properties.list.useQuery();

  // Default the test apartment to the first one in the template's allow-list
  // (else the first apartment overall) so custom vars resolve out of the box.
  useEffect(() => {
    if (testPropertyId) return;
    const first = [...listingIds][0] ?? propsQ.data?.[0]?.id;
    if (first) setTestPropertyId(first);
  }, [listingIds, propsQ.data, testPropertyId]);

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
    if (!name.trim() || !body.trim()) return;
    const trigger = buildTriggerDsl(trig);
    const ids = [...listingIds];
    if (isEdit && template) {
      update.mutate({
        id: template.id,
        name,
        channel: chan,
        trigger,
        language,
        body,
        active,
        listingIds: ids,
      });
    } else {
      create.mutate({
        name,
        channel: chan,
        trigger,
        language,
        body,
        active,
        listingIds: ids,
      });
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

          <TriggerBuilder value={trig} onChange={setTrig} />

          {/* Listings (explicit allow-list) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Apartments</Label>
              <div className="flex gap-2 text-[11px]">
                <button
                  type="button"
                  className="text-muted hover:text-ink"
                  onClick={() =>
                    setListingIds(
                      new Set((propsQ.data ?? []).map((p) => p.id)),
                    )
                  }
                >
                  Alle
                </button>
                <button
                  type="button"
                  className="text-muted hover:text-ink"
                  onClick={() => setListingIds(new Set())}
                >
                  Keine
                </button>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-md border border-line divide-y divide-line">
              {(propsQ.data ?? []).length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-muted">
                  Keine Apartments.
                </div>
              ) : (
                (propsQ.data ?? []).map((p) => {
                  const on = listingIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setListingIds((prev) => {
                          const next = new Set(prev);
                          on ? next.delete(p.id) : next.add(p.id);
                          return next;
                        })
                      }
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-sunken/50 transition-colors"
                    >
                      <span
                        className={cn(
                          'h-4 w-4 rounded border flex items-center justify-center flex-shrink-0',
                          on
                            ? 'bg-brand border-brand text-white'
                            : 'border-line-strong',
                        )}
                      >
                        {on && (
                          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                            <path
                              d="M2.5 6.5l2.5 2.5 4.5-5"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      <span className="text-[13px] text-ink truncate">
                        {p.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <p className="text-[11px] text-whisper">
              {listingIds.size === 0
                ? 'Kein Apartment gewählt — diese Vorlage wird (ohne Buchungs-Override) nicht versendet.'
                : `${listingIds.size} Apartment(s) aktiv.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="t-lang">Sprache</Label>
            <Input
              id="t-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="de"
              className="max-w-[120px]"
            />
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
            <div className="space-y-1">
              <Label htmlFor="t-test-apt">Vorschau/Test für Apartment</Label>
              <select
                id="t-test-apt"
                value={testPropertyId}
                onChange={(e) => setTestPropertyId(e.target.value)}
                className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
              >
                {(propsQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-whisper">
                Eigene Variablen wie {`{{wifiCode}}`} werden mit den Werten
                dieses Apartments gefüllt.
              </p>
            </div>
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
                    propertyId: testPropertyId || undefined,
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

// ─── Variables ──────────────────────────────────────────────────────────────

function VariablesView() {
  const utils = trpc.useUtils();
  const listQ = trpc.messageVariables.list.useQuery();
  const propsQ = trpc.properties.list.useQuery();
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = () => {
    utils.messageVariables.list.invalidate();
    utils.messageTemplates.vars.invalidate();
  };
  const create = trpc.messageVariables.create.useMutation({
    onSuccess: () => {
      toast.success('Variable erstellt');
      setNewKey('');
      setNewLabel('');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.messageVariables.delete.useMutation({
    onSuccess: () => {
      toast.success('Variable gelöscht');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const setValue = trpc.messageVariables.setValue.useMutation({
    onSuccess: () => utils.messageVariables.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 max-w-4xl">
      <p className="text-[13px] text-muted mb-4">
        Eigene Platzhalter wie <span className="num">{'{{wifiCode}}'}</span> —
        pro Apartment befüllbar, im Vorlagen-Editor verwendbar. Fehlt ein
        Wert für ein Apartment, bleibt der Platzhalter im Text stehen.
      </p>

      {/* Create */}
      <Card className="px-4 py-3 mb-4">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="nv-key">Schlüssel</Label>
            <Input
              id="nv-key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="wifiCode"
              className="w-40"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[180px]">
            <Label htmlFor="nv-label">Bezeichnung</Label>
            <Input
              id="nv-label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="WLAN-Passwort"
            />
          </div>
          <Button
            variant="brand"
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            loading={create.isPending}
            disabled={!newKey.trim() || !newLabel.trim()}
            onClick={() =>
              create.mutate({ key: newKey.trim(), label: newLabel.trim() })
            }
          >
            Variable
          </Button>
        </div>
      </Card>

      {listQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (listQ.data?.length ?? 0) === 0 ? (
        <InfoCard
          title="Noch keine Variablen"
          body="Lege z. B. {{wifiCode}} an und befülle sie pro Apartment."
        />
      ) : (
        <div className="space-y-2">
          {listQ.data!.map((v) => {
            const isOpen = expanded === v.id;
            const valByProp = new Map(
              v.values.map((x) => [x.propertyId, x.value]),
            );
            const filled = v.values.length;
            return (
              <Card key={v.id} className="overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="num text-[13px] font-medium text-brand">
                    {`{{${v.key}}}`}
                  </span>
                  <span className="text-[13px] text-ink truncate flex-1">
                    {v.label}
                  </span>
                  <span className="text-[11px] text-muted">
                    {filled}/{propsQ.data?.length ?? 0} befüllt
                  </span>
                  <button
                    type="button"
                    className="text-[12px] text-brand hover:underline"
                    onClick={() => setExpanded(isOpen ? null : v.id)}
                  >
                    {isOpen ? 'Schließen' : 'Befüllen'}
                  </button>
                  <button
                    type="button"
                    className="text-whisper hover:text-negative p-1 rounded hover:bg-negative-soft transition-colors"
                    onClick={() => {
                      if (confirm(`Variable {{${v.key}}} löschen?`))
                        del.mutate({ id: v.id });
                    }}
                    aria-label="Löschen"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
                {isOpen && (
                  <ul className="border-t border-line divide-y divide-line">
                    {(propsQ.data ?? []).map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-3 px-4 py-2"
                      >
                        <span className="text-[12.5px] text-ink-soft w-32 truncate">
                          {p.name}
                        </span>
                        <Input
                          defaultValue={valByProp.get(p.id) ?? ''}
                          placeholder="(leer → Platzhalter bleibt)"
                          className="flex-1"
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            const cur = valByProp.get(p.id) ?? '';
                            if (next !== cur)
                              setValue.mutate({
                                variableId: v.id,
                                propertyId: p.id,
                                value: next,
                              });
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
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
