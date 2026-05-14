import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Check, Link2, Plus, GripVertical } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';
import { cn } from '@cm/ui';

import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Card, CardBody } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { PageHeader } from './_dashboard';
import { trpc } from '../lib/trpc';

type RouterOutput = inferRouterOutputs<AppRouter>;
type PropertyRow = RouterOutput['properties']['list'][number];

export function ApartmentsPage() {
  const utils = trpc.useUtils();
  const propsQ = trpc.properties.list.useQuery();
  const groupsQ = trpc.propertyGroups.list.useQuery();

  const [showNew, setShowNew] = useState(false);

  return (
    <>
      <PageHeader
        title="Apartments"
        subtitle="Your inventory. Group by building or city, then connect channels per apartment."
        action={
          <Button
            variant="brand"
            iconLeft={<Plus className="h-4 w-4" />}
            onClick={() => setShowNew(true)}
          >
            New apartment
          </Button>
        }
      />

      <div className="px-8 py-7 max-w-5xl">
        {propsQ.isLoading || groupsQ.isLoading ? (
          <ListSkeleton />
        ) : (propsQ.data?.length ?? 0) === 0 ? (
          <EmptyState onAdd={() => setShowNew(true)} />
        ) : (
          <Grouped
            groups={groupsQ.data ?? []}
            properties={propsQ.data ?? []}
          />
        )}
      </div>

      {showNew && (
        <NewApartmentDialog
          groups={groupsQ.data ?? []}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            utils.properties.list.invalidate();
            setShowNew(false);
          }}
        />
      )}
    </>
  );
}

function Grouped({
  groups,
  properties,
}: {
  groups: Array<{ id: string; name: string; color: string }>;
  properties: PropertyRow[];
}) {
  // Bucket properties by group
  const grouped = new Map<string | null, PropertyRow[]>();
  for (const p of properties) {
    const key = p.groupId ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  const sections: Array<{ id: string | null; name: string; color: string; items: PropertyRow[] }> = [];
  for (const g of groups) {
    sections.push({
      id: g.id,
      name: g.name,
      color: g.color,
      items: grouped.get(g.id) ?? [],
    });
  }
  const ungrouped = grouped.get(null);
  if (ungrouped && ungrouped.length > 0) {
    sections.push({ id: null, name: 'Ungrouped', color: '#807A6E', items: ungrouped });
  }

  return (
    <div className="space-y-7">
      {sections.map((s) => (
        <section key={s.id ?? 'ungrouped'} className="animate-fade-up">
          <div className="flex items-center gap-3 mb-3 px-1">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: s.color }}
            />
            <h2 className="display text-[18px] font-medium text-ink">
              {s.name}
            </h2>
            <span className="num text-[12px] text-muted">{s.items.length}</span>
            <div className="flex-1 border-b border-line ml-2" />
          </div>
          {s.items.length === 0 ? (
            <div className="text-[13px] text-whisper italic px-1">
              No apartments in this group yet.
            </div>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {s.items.map((p) => (
                  <PropertyRowItem key={p.id} property={p} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      ))}
    </div>
  );
}

function PropertyRowItem({ property }: { property: PropertyRow }) {
  const utils = trpc.useUtils();
  const onboard = trpc.properties.onboardToChannex.useMutation({
    onSuccess: () => {
      toast.success(`${property.name} mit Channex verbunden`);
      void utils.properties.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const connected = !!property.channexPropertyRef;

  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/40 transition-colors">
      <button
        type="button"
        className="text-whisper hover:text-muted cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
        tabIndex={-1}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-ink truncate">
          {property.name}
        </div>
        {property.description && (
          <div className="text-[12px] text-muted truncate mt-0.5">
            {property.description}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {connected ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
              'bg-positive-soft text-positive border border-positive/30',
              'text-[10.5px] uppercase tracking-wider font-semibold',
            )}
          >
            <Check className="h-3 w-3" strokeWidth={2.5} />
            Verbunden
          </span>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={onboard.isPending}
            iconLeft={<Link2 className="h-3.5 w-3.5" />}
            onClick={() => onboard.mutate({ propertyId: property.id })}
          >
            Verbinden
          </Button>
        )}
      </div>
    </li>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="p-12 text-center">
      <div className="mx-auto h-12 w-12 rounded-md bg-brand-soft text-brand flex items-center justify-center mb-4">
        <Plus className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h3 className="display text-[20px] font-medium text-ink">
        Add your first apartment
      </h3>
      <p className="mt-2 text-[13px] text-muted max-w-[44ch] mx-auto leading-relaxed">
        Start with a single apartment. You&rsquo;ll create groups (per building
        or city) and connect channels later.
      </p>
      <Button
        variant="brand"
        size="md"
        onClick={onAdd}
        className="mt-5"
        iconLeft={<Plus className="h-4 w-4" />}
      >
        New apartment
      </Button>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2].map((s) => (
        <div key={s} className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ))}
    </div>
  );
}

function NewApartmentDialog({
  groups,
  onClose,
  onCreated,
}: {
  groups: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState<string>('');

  const create = trpc.properties.create.useMutation({
    onSuccess: () => {
      toast.success('Apartment created');
      onCreated();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({
      name: name.trim(),
      groupId: groupId || null,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[460px] bg-surface rounded-xl shadow-lg border border-line animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-2">
          <h2 className="display text-[22px] font-medium text-ink">
            New apartment
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            You can change all of this later.
          </p>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="apt-name">Name</Label>
            <Input
              id="apt-name"
              placeholder="e.g. Whg 3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="apt-group">Group</Label>
            <select
              id="apt-group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            >
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              loading={create.isPending}
            >
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
