import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Trash2, Plus, Pencil, Star, X, MessageSquareQuote } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';
import { cn } from '@cm/ui';

import { PageHeader } from './_dashboard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Switch } from '../components/ui/Switch';
import { Card } from '../components/ui/Card';
import { SectionCard } from '../components/ui/SectionCard';
import { Skeleton } from '../components/ui/Skeleton';
import { trpc } from '../lib/trpc';

const SELECT_CLS =
  'h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors disabled:opacity-60';

type ReviewTemplate = inferRouterOutputs<AppRouter>['reviewTemplates']['list'][number];

export function ReviewsPage() {
  const meQ = trpc.me.current.useQuery();
  const role = meQ.data?.memberships?.[0]?.role;
  const isAdmin = role === 'owner' || role === 'admin';

  return (
    <>
      <PageHeader
        title="Bewertungen"
        subtitle="Auto-Review-Vorlagen, die nach dem Checkout automatisch gesendet werden."
      />
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-5">
        {!isAdmin && meQ.data && (
          <Card className="px-4 py-3 bg-warning-soft/40 border-warning/30">
            <p className="text-[12.5px] text-ink-soft">
              Nur Owner/Admin können Bewertungs-Vorlagen ändern — du kannst sie
              ansehen.
            </p>
          </Card>
        )}
        <ReviewTemplatesSection disabled={!isAdmin} />
      </div>
    </>
  );
}

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
