import { useEffect, useState, type FormEvent } from 'react';
import {
  SprayCan,
  ListChecks,
  Link2,
  Plus,
  Pencil,
  Trash2,
  Send,
  AlertTriangle,
  Copy,
  RefreshCw,
  Check,
  X,
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
type Rule = RouterOutput['cleaningRules']['list'][number];
type Checklist = RouterOutput['cleaningChecklists']['list'][number];
type CleaningCalendar = RouterOutput['cleaningCalendars']['list'][number];

type Tab = 'rules' | 'checklists' | 'calendars';

export function CleaningPage() {
  const [tab, setTab] = useState<Tab>('rules');

  return (
    <>
      <PageHeader
        title="Reinigung"
        subtitle="Automatische SMS-Erinnerungen an Teammates — pro Apartment, mit Trigger und optionaler Checkliste."
        action={
          <div
            className="inline-flex rounded-lg border border-line bg-surface p-0.5"
            role="tablist"
            aria-label="Reinigungs-Ansicht"
          >
            {(
              [
                { id: 'rules' as const, label: 'Regeln', icon: SprayCan },
                {
                  id: 'checklists' as const,
                  label: 'Checklisten',
                  icon: ListChecks,
                },
                {
                  id: 'calendars' as const,
                  label: 'Kalender-Links',
                  icon: Link2,
                },
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
      {tab === 'rules' && <RulesView />}
      {tab === 'checklists' && <ChecklistsView />}
      {tab === 'calendars' && <CalendarsView />}
    </>
  );
}

// ─── Rules ──────────────────────────────────────────────────────────────────

function RulesView() {
  const utils = trpc.useUtils();
  const listQ = trpc.cleaningRules.list.useQuery();
  const teammatesQ = trpc.teammates.list.useQuery();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);

  const toggleActive = trpc.cleaningRules.update.useMutation({
    onSuccess: () => utils.cleaningRules.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.cleaningRules.delete.useMutation({
    onSuccess: () => {
      toast.success('Regel gelöscht');
      utils.cleaningRules.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const noTeammates = (teammatesQ.data?.length ?? 0) === 0;

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 max-w-4xl">
      <div className="flex justify-between items-center mb-4 gap-3">
        <p className="text-[13px] text-muted">
          Jede Regel schickt eine SMS an die gewählten Teammates — ausgelöst
          relativ zu Reservierung, Check-in oder Check-out.
        </p>
        <Button
          variant="brand"
          size="sm"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setEditing('new')}
        >
          Neue Regel
        </Button>
      </div>

      {noTeammates && !teammatesQ.isLoading && (
        <InfoCard
          variant="error"
          title="Noch keine Teammates"
          body="Lege zuerst unter Einstellungen → Teammates mindestens einen Cleaner mit Telefonnummer an. Ohne Empfänger wird keine Regel versendet."
        />
      )}

      {listQ.isLoading ? (
        <div className="space-y-2 mt-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (listQ.data?.length ?? 0) === 0 ? (
        !noTeammates && (
          <InfoCard
            title="Noch keine Regeln"
            body="Lege eine Regel an, z. B. „Am Check-out-Tag 09:00 — Reinigung Bescheid geben“. Platzhalter wie {{checkoutDate}} oder {{checklist}} werden beim Versand ersetzt."
          />
        )
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {listQ.data!.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-ink truncate">
                      {r.name}
                    </span>
                    <span className="text-[10.5px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-brand-soft text-brand">
                      {r.teammateIds.length} Teammate
                      {r.teammateIds.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted truncate mt-0.5">
                    <span className="num">{r.trigger}</span> ·{' '}
                    {r.listingIds.length} Apartment
                    {r.listingIds.length === 1 ? '' : 's'} · {r.body.slice(0, 56)}
                    {r.body.length > 56 ? '…' : ''}
                  </div>
                </div>
                <Switch
                  size="sm"
                  checked={r.active}
                  onChange={(next) =>
                    toggleActive.mutate({ id: r.id, active: next })
                  }
                  aria-label="Aktiv"
                />
                <button
                  type="button"
                  className="text-whisper hover:text-ink p-1.5 rounded hover:bg-sunken transition-colors"
                  onClick={() => setEditing(r)}
                  aria-label="Bearbeiten"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="text-whisper hover:text-negative p-1.5 rounded hover:bg-negative-soft transition-colors"
                  onClick={() => {
                    if (confirm(`Regel „${r.name}“ löschen?`))
                      del.mutate({ id: r.id });
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
        <RuleDialog
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            utils.cleaningRules.list.invalidate();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RuleDialog({
  rule,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!rule;
  const [name, setName] = useState(rule?.name ?? '');
  const [trig, setTrig] = useState(() =>
    parseTriggerDsl(rule?.trigger ?? 'checkout:+0d@09:00'),
  );
  const [body, setBody] = useState(rule?.body ?? '');
  const [active, setActive] = useState(rule?.active ?? true);
  const [checklistId, setChecklistId] = useState<string | null>(
    rule?.checklistId ?? null,
  );
  const [listingIds, setListingIds] = useState<Set<string>>(
    new Set(rule?.listingIds ?? []),
  );
  const [teammateIds, setTeammateIds] = useState<Set<string>>(
    new Set(rule?.teammateIds ?? []),
  );
  const [testPhone, setTestPhone] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const varsQ = trpc.cleaningRules.vars.useQuery();
  const propsQ = trpc.properties.list.useQuery();
  const teammatesQ = trpc.teammates.list.useQuery();
  const checklistsQ = trpc.cleaningChecklists.list.useQuery();

  const create = trpc.cleaningRules.create.useMutation({
    onSuccess: () => {
      toast.success('Regel erstellt');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.cleaningRules.update.useMutation({
    onSuccess: () => {
      toast.success('Regel gespeichert');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const sendTest = trpc.cleaningRules.sendTest.useMutation({
    onSuccess: (r) => {
      setPreview(r.preview);
      if (r.sent) toast.success(r.info ?? 'Test gesendet');
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !body.trim()) return;
    const payload = {
      name: name.trim(),
      trigger: buildTriggerDsl(trig),
      body,
      checklistId,
      active,
      listingIds: [...listingIds],
      teammateIds: [...teammateIds],
    };
    if (isEdit && rule) update.mutate({ id: rule.id, ...payload });
    else create.mutate(payload);
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
            {isEdit ? 'Regel bearbeiten' : 'Neue Regel'}
          </h2>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-3 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="r-name">Name</Label>
            <Input
              id="r-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Reinigung nach Check-out"
              required
              autoFocus
            />
          </div>

          <TriggerBuilder value={trig} onChange={setTrig} />

          {/* Apartment allow-list */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Apartments</Label>
              <div className="flex gap-2 text-[11px]">
                <button
                  type="button"
                  className="text-muted hover:text-ink"
                  onClick={() =>
                    setListingIds(new Set((propsQ.data ?? []).map((p) => p.id)))
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
                    <CheckRow
                      key={p.id}
                      on={on}
                      label={p.name}
                      onToggle={() =>
                        setListingIds((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        })
                      }
                    />
                  );
                })
              )}
            </div>
            <p className="text-[11px] text-whisper">
              {listingIds.size === 0
                ? 'Kein Apartment gewählt — diese Regel wird nicht versendet.'
                : `${listingIds.size} Apartment(s) aktiv.`}
            </p>
          </div>

          {/* Teammates (fan-out) */}
          <div className="space-y-1.5">
            <Label>Teammates (Empfänger)</Label>
            <div className="max-h-36 overflow-y-auto rounded-md border border-line divide-y divide-line">
              {(teammatesQ.data ?? []).length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-muted">
                  Keine Teammates — unter Einstellungen → Teammates anlegen.
                </div>
              ) : (
                (teammatesQ.data ?? []).map((tm) => {
                  const on = teammateIds.has(tm.id);
                  return (
                    <CheckRow
                      key={tm.id}
                      on={on}
                      label={`${tm.name} · ${tm.phone}`}
                      dim={!tm.active}
                      onToggle={() =>
                        setTeammateIds((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(tm.id);
                          else next.add(tm.id);
                          return next;
                        })
                      }
                    />
                  );
                })
              )}
            </div>
            <p className="text-[11px] text-whisper">
              {teammateIds.size === 0
                ? 'Kein Empfänger gewählt — diese Regel wird nicht versendet.'
                : `${teammateIds.size} Empfänger.`}
            </p>
          </div>

          {/* Checklist */}
          <div className="space-y-1.5">
            <Label htmlFor="r-checklist">Checkliste (optional)</Label>
            <select
              id="r-checklist"
              value={checklistId ?? ''}
              onChange={(e) => setChecklistId(e.target.value || null)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            >
              <option value="">— Keine —</option>
              {(checklistsQ.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.items.length})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-whisper">
              Wird über den Platzhalter{' '}
              <span className="num">{'{{checklist}}'}</span> als Liste in die
              SMS eingefügt.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r-body">Nachricht</Label>
            <textarea
              id="r-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              required
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none transition-colors resize-y"
              placeholder="Reinigung {{apartmentName}} nach Abreise am {{checkoutDate}} ({{checkoutTime}} Uhr). Nächster Check-in: {{nextCheckinDate}}.&#10;{{checklist}}"
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

          {/* Preview & test */}
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
                placeholder="+49170… (Test-SMS)"
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

function CheckRow({
  on,
  label,
  dim,
  onToggle,
}: {
  on: boolean;
  label: string;
  dim?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-sunken/50 transition-colors"
    >
      <span
        className={cn(
          'h-4 w-4 rounded border flex items-center justify-center flex-shrink-0',
          on ? 'bg-brand border-brand text-white' : 'border-line-strong',
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
      <span
        className={cn(
          'text-[13px] truncate',
          dim ? 'text-muted line-through' : 'text-ink',
        )}
      >
        {label}
      </span>
    </button>
  );
}

// ─── Checklists ─────────────────────────────────────────────────────────────

function ChecklistsView() {
  const utils = trpc.useUtils();
  const listQ = trpc.cleaningChecklists.list.useQuery();
  const [editing, setEditing] = useState<Checklist | 'new' | null>(null);

  const del = trpc.cleaningChecklists.delete.useMutation({
    onSuccess: () => {
      toast.success('Checkliste gelöscht');
      utils.cleaningChecklists.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="px-4 sm:px-6 md:px-8 py-6 max-w-4xl">
      <div className="flex justify-between items-center mb-4 gap-3">
        <p className="text-[13px] text-muted">
          Wiederverwendbare Checklisten — eine Regel hängt eine an, sie wird
          als Liste in die SMS gerendert.
        </p>
        <Button
          variant="brand"
          size="sm"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setEditing('new')}
        >
          Neue Checkliste
        </Button>
      </div>

      {listQ.isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (listQ.data?.length ?? 0) === 0 ? (
        <InfoCard
          title="Noch keine Checklisten"
          body="Lege z. B. „Standard-Reinigung“ mit den üblichen Aufgaben an und hänge sie an eine Regel."
        />
      ) : (
        <div className="space-y-2">
          {listQ.data!.map((c) => (
            <Card key={c.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-ink truncate">
                    {c.name}
                  </div>
                  <div className="text-[12px] text-muted truncate mt-0.5">
                    {c.items.length === 0
                      ? 'Keine Punkte'
                      : c.items.join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-whisper hover:text-ink p-1.5 rounded hover:bg-sunken transition-colors"
                  onClick={() => setEditing(c)}
                  aria-label="Bearbeiten"
                >
                  <Pencil className="h-4 w-4" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="text-whisper hover:text-negative p-1.5 rounded hover:bg-negative-soft transition-colors"
                  onClick={() => {
                    if (confirm(`Checkliste „${c.name}“ löschen?`))
                      del.mutate({ id: c.id });
                  }}
                  aria-label="Löschen"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <ChecklistDialog
          checklist={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            utils.cleaningChecklists.list.invalidate();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ChecklistDialog({
  checklist,
  onClose,
  onSaved,
}: {
  checklist: Checklist | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!checklist;
  const [name, setName] = useState(checklist?.name ?? '');
  const [text, setText] = useState((checklist?.items ?? []).join('\n'));

  const create = trpc.cleaningChecklists.create.useMutation({
    onSuccess: () => {
      toast.success('Checkliste erstellt');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.cleaningChecklists.update.useMutation({
    onSuccess: () => {
      toast.success('Checkliste gespeichert');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const items = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (isEdit && checklist)
      update.mutate({ id: checklist.id, name: name.trim(), items });
    else create.mutate({ name: name.trim(), items });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-[480px] bg-surface rounded-t-2xl sm:rounded-xl shadow-lg border border-line animate-fade-up max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-2">
          <h2 className="display text-[20px] font-medium text-ink">
            {isEdit ? 'Checkliste bearbeiten' : 'Neue Checkliste'}
          </h2>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-3 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Standard-Reinigung"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-items">Punkte (eine Zeile pro Punkt)</Label>
            <textarea
              id="c-items"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none transition-colors resize-y"
              placeholder={'Bad reinigen\nBettwäsche wechseln\nMüll rausbringen'}
            />
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
          isError
            ? 'bg-negative-soft text-negative'
            : 'bg-brand-soft text-brand',
        )}
      >
        {isError ? (
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
        ) : (
          <SprayCan className="h-5 w-5" strokeWidth={1.75} />
        )}
      </div>
      <h3 className="display text-[20px] font-medium text-ink">{title}</h3>
      <p className="mt-2 text-[13px] text-muted leading-relaxed">{body}</p>
    </Card>
  );
}

// ─── Cleaning Calendars (public read-only share links) ─────────────────────

function CalendarsView() {
  const utils = trpc.useUtils();
  const calsQ = trpc.cleaningCalendars.list.useQuery();
  const propsQ = trpc.properties.list.useQuery();

  const [editing, setEditing] = useState<CleaningCalendar | null>(null);
  const [creating, setCreating] = useState(false);

  const del = trpc.cleaningCalendars.delete.useMutation({
    onSuccess: () => {
      toast.success('Kalender-Link gelöscht');
      void utils.cleaningCalendars.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const regen = trpc.cleaningCalendars.regenerateSlug.useMutation({
    onSuccess: () => {
      toast.success('Neue URL erzeugt — alte ist sofort ungültig');
      void utils.cleaningCalendars.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const toggleActive = trpc.cleaningCalendars.update.useMutation({
    onSuccess: () => void utils.cleaningCalendars.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const properties = propsQ.data ?? [];
  const isLoading = calsQ.isLoading || propsQ.isLoading;

  return (
    <div className="px-8 py-7 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted leading-relaxed max-w-prose">
          Erzeuge anpassbare Read-Only-Kalender-Links für deine Putzkräfte. Pro
          Link wählst du welche Apartments und Felder sichtbar sind. Kein
          Login, keine Navigation in den Channel Manager.
        </p>
        <Button
          variant="brand"
          size="sm"
          iconLeft={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setCreating(true)}
        >
          Neuer Kalender-Link
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (calsQ.data ?? []).length === 0 ? (
        <Card className="p-8 text-center">
          <Link2 className="h-6 w-6 mx-auto text-muted" strokeWidth={1.75} />
          <h3 className="display text-[18px] mt-3 text-ink">
            Noch keine Kalender-Links
          </h3>
          <p className="mt-1 text-[13px] text-muted">
            Erstelle deinen ersten Link, um ihn an die Putzkraft weiterzugeben.
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {(calsQ.data ?? []).map((c) => (
            <CalendarRow
              key={c.id}
              calendar={c}
              properties={properties}
              onEdit={() => setEditing(c)}
              onToggleActive={(v) =>
                toggleActive.mutate({ id: c.id, isActive: v })
              }
              onRegenerate={() =>
                regen.mutate({ id: c.id })
              }
              onDelete={() => {
                if (
                  confirm(
                    `Kalender-Link "${c.name}" wirklich löschen? Die URL wird sofort ungültig.`,
                  )
                ) {
                  del.mutate({ id: c.id });
                }
              }}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <CalendarEditorDialog
          calendar={editing}
          properties={properties}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            void utils.cleaningCalendars.list.invalidate();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CalendarRow({
  calendar,
  properties,
  onEdit,
  onToggleActive,
  onRegenerate,
  onDelete,
}: {
  calendar: CleaningCalendar;
  properties: { id: string; name: string }[];
  onEdit: () => void;
  onToggleActive: (v: boolean) => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/cal/${calendar.slug}`
      : `/cal/${calendar.slug}`;

  const propCount =
    calendar.propertyIds.length === 0
      ? properties.length
      : calendar.propertyIds.length;
  const propsLabel =
    calendar.propertyIds.length === 0
      ? `Alle ${properties.length} Apartments`
      : `${propCount} Apartment${propCount === 1 ? '' : 's'}`;

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('URL kopiert');
    } catch {
      toast.error('Kopieren fehlgeschlagen');
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-[14.5px] font-medium text-ink truncate">
            {calendar.name}
          </h4>
          <span
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] uppercase tracking-wider font-semibold flex-shrink-0',
              calendar.isActive
                ? 'bg-positive-soft text-positive border border-positive/30'
                : 'bg-sunken text-muted border border-line',
            )}
          >
            {calendar.isActive ? (
              <>
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
                Online
              </>
            ) : (
              <>
                <X className="h-2.5 w-2.5" strokeWidth={3} />
                Offline
              </>
            )}
          </span>
        </div>
        <div className="mt-1 text-[12px] text-muted">{propsLabel}</div>
        <button
          type="button"
          onClick={copyUrl}
          className="mt-2 inline-flex items-center gap-1.5 max-w-full text-[11.5px] font-mono text-ink-soft hover:text-ink truncate"
          title="Klicken zum Kopieren"
        >
          <Copy className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{url}</span>
        </button>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Switch
          checked={calendar.isActive}
          onChange={onToggleActive}
        />
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={onRegenerate}
          title="Neue URL erzeugen (alte sofort ungültig)"
        >
          <span className="hidden sm:inline">Neue URL</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Pencil className="h-3.5 w-3.5" />}
          onClick={onEdit}
        >
          <span className="hidden sm:inline">Bearbeiten</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Trash2 className="h-3.5 w-3.5" />}
          onClick={onDelete}
        >
          <span className="hidden sm:inline">Löschen</span>
        </Button>
      </div>
    </div>
  );
}

function CalendarEditorDialog({
  calendar,
  properties,
  onClose,
  onSaved,
}: {
  calendar: CleaningCalendar | null;
  properties: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!calendar;
  const [name, setName] = useState(calendar?.name ?? '');
  const [allApartments, setAllApartments] = useState(
    calendar ? calendar.propertyIds.length === 0 : true,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    calendar?.propertyIds ?? [],
  );

  const [showGuestName, setShowGuestName] = useState(
    calendar?.showGuestName ?? true,
  );
  const [showGuestCount, setShowGuestCount] = useState(
    calendar?.showGuestCount ?? false,
  );
  const [showGuestPhone, setShowGuestPhone] = useState(
    calendar?.showGuestPhone ?? false,
  );
  const [showGuestEmail, setShowGuestEmail] = useState(
    calendar?.showGuestEmail ?? false,
  );
  const [showNotes, setShowNotes] = useState(calendar?.showNotes ?? false);
  const [showHostNotes, setShowHostNotes] = useState(
    calendar?.showHostNotes ?? false,
  );
  const [showPrice, setShowPrice] = useState(calendar?.showPrice ?? false);
  const [showBookingCode, setShowBookingCode] = useState(
    calendar?.showBookingCode ?? false,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = trpc.cleaningCalendars.create.useMutation({
    onSuccess: () => {
      toast.success('Kalender-Link erstellt');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.cleaningCalendars.update.useMutation({
    onSuccess: () => {
      toast.success('Änderungen gespeichert');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const payload = {
      name: name.trim(),
      propertyIds: allApartments ? [] : selectedIds,
      showGuestName,
      showGuestCount,
      showGuestPhone,
      showGuestEmail,
      showNotes,
      showHostNotes,
      showPrice,
      showBookingCode,
    };
    if (isEdit && calendar) {
      update.mutate({ id: calendar.id, ...payload });
    } else {
      create.mutate(payload);
    }
  }

  function toggleId(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const validApartmentChoice =
    allApartments || selectedIds.length > 0;

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
          <h2 className="display text-[22px] font-medium text-ink">
            {isEdit ? 'Kalender-Link bearbeiten' : 'Neuer Kalender-Link'}
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            {isEdit
              ? 'Änderungen wirken sofort auf die geteilte URL.'
              : 'Wähle Apartments und Felder. Die URL erzeugen wir beim Speichern.'}
          </p>
        </div>

        <form onSubmit={submit} className="px-6 pb-6 pt-3 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="cal-name">Name (intern)</Label>
            <Input
              id="cal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Putzkraft Team A, Frau Müller"
              maxLength={80}
              autoFocus
            />
          </div>

          <div>
            <Label>Welche Apartments?</Label>
            <div className="mt-2 rounded-lg border border-line p-3.5 space-y-2.5">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="apt-scope"
                  checked={allApartments}
                  onChange={() => setAllApartments(true)}
                  className="accent-brand"
                />
                <span className="text-[13px] text-ink">
                  Alle Apartments ({properties.length}) — auch neu angelegte erscheinen automatisch
                </span>
              </label>
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="apt-scope"
                  checked={!allApartments}
                  onChange={() => setAllApartments(false)}
                  className="accent-brand"
                />
                <span className="text-[13px] text-ink">
                  Nur ausgewählte Apartments
                </span>
              </label>
              {!allApartments && (
                <div className="ml-6 mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-[180px] overflow-y-auto pr-2">
                  {properties.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-1.5 text-[12.5px] text-ink cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(p.id)}
                        onChange={() => toggleId(p.id)}
                        className="accent-brand"
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <Label>Welche Felder sind sichtbar?</Label>
            <div className="mt-2 rounded-lg border border-line p-3.5 space-y-2.5">
              <FieldRow
                label="Gastname"
                value={showGuestName}
                onChange={setShowGuestName}
              />
              <FieldRow
                label="Anzahl Gäste"
                value={showGuestCount}
                onChange={setShowGuestCount}
              />
              <FieldRow
                label="Handynummer"
                value={showGuestPhone}
                onChange={setShowGuestPhone}
                muted="Datenschutz beachten"
              />
              <FieldRow
                label="E-Mail-Adresse"
                value={showGuestEmail}
                onChange={setShowGuestEmail}
                muted="Datenschutz beachten"
              />
              <FieldRow
                label="Buchungs-Notiz (vom Gast / OTA)"
                value={showNotes}
                onChange={setShowNotes}
              />
              <FieldRow
                label="Host-Notiz (deine interne)"
                value={showHostNotes}
                onChange={setShowHostNotes}
              />
              <FieldRow
                label="Preis"
                value={showPrice}
                onChange={setShowPrice}
              />
              <FieldRow
                label="Buchungs-Code (OTA-Referenz)"
                value={showBookingCode}
                onChange={setShowBookingCode}
              />
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
              disabled={!name.trim() || !validApartmentChoice || pending}
            >
              {isEdit ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  muted,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  muted?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[13px] text-ink">
        {label}
        {muted && (
          <span className="ml-1.5 text-[11px] text-muted">· {muted}</span>
        )}
      </div>
      <Switch checked={value} onChange={onChange} />
    </div>
  );
}
