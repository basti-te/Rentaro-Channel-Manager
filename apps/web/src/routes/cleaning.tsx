import { useState, type FormEvent } from 'react';
import {
  SprayCan,
  ListChecks,
  Plus,
  Pencil,
  Trash2,
  Send,
  AlertTriangle,
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

type Tab = 'rules' | 'checklists';

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
      {tab === 'rules' ? <RulesView /> : <ChecklistsView />}
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
