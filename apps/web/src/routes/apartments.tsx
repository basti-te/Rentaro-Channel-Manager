import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
  Check,
  Link2,
  Plus,
  GripVertical,
  FlaskConical,
  RefreshCw,
  Copy,
  MoreVertical,
  Pencil,
  Trash2,
  AlertTriangle,
  FolderPlus,
  Plug,
  X,
} from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@cm/api';
import { cn } from '@cm/ui';

import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Card, CardBody } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { PageHeader } from './_dashboard';
import { ChannelMappingFrame } from '../components/ChannelMappingFrame';
import {
  CURRENCY_FALLBACK,
  currencyName,
  intlSupported,
  withPreferred,
} from '../lib/locale-options';
import { trpc } from '../lib/trpc';

type RouterOutput = inferRouterOutputs<AppRouter>;
type PropertyRow = RouterOutput['properties']['list'][number];
type FullSyncRow = RouterOutput['sync']['fullSyncStatus'][number];
type GroupRow = RouterOutput['propertyGroups']['list'][number];

/** Preset swatches for group colors (matches the calendar left-rail palette). */
const GROUP_COLORS = [
  '#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#807A6E',
];

export function ApartmentsPage() {
  const utils = trpc.useUtils();
  const nav = useNavigate();
  const propsQ = trpc.properties.list.useQuery();
  const groupsQ = trpc.propertyGroups.list.useQuery();
  // Dev-only: which connected properties can receive a simulated booking
  // (have a CRS app connected in the Channex sandbox).
  const crsQ = trpc.bookings.crsCapableProperties.useQuery(undefined, {
    enabled: import.meta.env.DEV,
    staleTime: 5 * 60_000,
  });
  const crsCapable = new Set(crsQ.data ?? []);

  // Latest Full Sync result per property. Polled — the worker writes the
  // row asynchronously, and a "sync all" trickles in over a few minutes.
  const fullSyncQ = trpc.sync.fullSyncStatus.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const fullSyncByProp = new Map<string, FullSyncRow>(
    (fullSyncQ.data ?? []).flatMap((r) =>
      r.propertyId ? [[r.propertyId, r]] : [],
    ),
  );

  const fullSyncAll = trpc.sync.fullSyncAll.useMutation({
    onSuccess: (r) =>
      toast.success(
        r.count > 0
          ? `Full Sync für ${r.count} Apartment${r.count === 1 ? '' : 's'} gestartet`
          : 'Keine verbundenen Apartments für einen Full Sync',
      ),
    onError: (e) => toast.error(e.message),
  });

  const [showNew, setShowNew] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);

  return (
    <>
      <PageHeader
        title="Apartments"
        subtitle="Your inventory. Group by building or city, then connect channels per apartment."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              iconLeft={<RefreshCw className="h-4 w-4" />}
              loading={fullSyncAll.isPending}
              onClick={() => fullSyncAll.mutate()}
            >
              Alle synchronisieren
            </Button>
            <Button
              variant="secondary"
              iconLeft={<Plug className="h-4 w-4" />}
              onClick={() => nav({ to: '/channels' })}
            >
              Kanäle
            </Button>
            <Button
              variant="secondary"
              iconLeft={<FolderPlus className="h-4 w-4" />}
              onClick={() => setShowNewGroup(true)}
            >
              Neue Gruppe
            </Button>
            <Button
              variant="brand"
              iconLeft={<Plus className="h-4 w-4" />}
              onClick={() => setShowNew(true)}
            >
              New apartment
            </Button>
          </div>
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
            crsCapable={crsCapable}
            fullSyncByProp={fullSyncByProp}
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

      {showNewGroup && (
        <GroupDialog
          onClose={() => setShowNewGroup(false)}
          onSaved={() => {
            utils.propertyGroups.list.invalidate();
            setShowNewGroup(false);
          }}
        />
      )}
    </>
  );
}

/** Stable section key — real group id or a sentinel for the ungrouped bucket. */
const UNGROUPED = '__ungrouped__';

function Grouped({
  groups,
  properties,
  crsCapable,
  fullSyncByProp,
}: {
  groups: GroupRow[];
  properties: PropertyRow[];
  crsCapable: Set<string>;
  fullSyncByProp: Map<string, FullSyncRow>;
}) {
  const utils = trpc.useUtils();

  // ── Drag-to-reorder (native HTML5 DnD, within a group only) ──────────────
  // `armedId` gates which row may start a drag — set on grip mousedown so a
  // plain text-select on the row doesn't initiate a drag.
  const [armedId, setArmedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reorder = trpc.properties.reorder.useMutation({
    onMutate: async ({ orderedIds }) => {
      await utils.properties.list.cancel();
      const prev = utils.properties.list.getData();
      if (prev) {
        // Group items are contiguous in the list (ordered group→sortOrder), so
        // fill each of this group's slots with the new order, leave others put.
        const idSet = new Set(orderedIds);
        const byId = new Map(prev.map((p) => [p.id, p]));
        const inOrder = orderedIds.map((id) => byId.get(id)!).filter(Boolean);
        let k = 0;
        const next = prev.map((p) => (idSet.has(p.id) ? inOrder[k++]! : p));
        utils.properties.list.setData(undefined, next);
      }
      return { prev };
    },
    onError: (e, _vars, context) => {
      if (context?.prev) utils.properties.list.setData(undefined, context.prev);
      toast.error(e.message);
    },
    onSettled: () => utils.properties.list.invalidate(),
  });

  // Bucket properties by group
  const grouped = new Map<string | null, PropertyRow[]>();
  for (const p of properties) {
    const key = p.groupId ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  const sections: Array<{
    key: string;
    group: GroupRow | null;
    name: string;
    color: string;
    items: PropertyRow[];
  }> = [];
  for (const g of groups) {
    sections.push({
      key: g.id,
      group: g,
      name: g.name,
      color: g.color,
      items: grouped.get(g.id) ?? [],
    });
  }
  const ungrouped = grouped.get(null);
  if (ungrouped && ungrouped.length > 0) {
    sections.push({ key: UNGROUPED, group: null, name: 'Ohne Gruppe', color: '#807A6E', items: ungrouped });
  }

  function resetDrag() {
    setArmedId(null);
    setDragId(null);
    setDragKey(null);
    setOverId(null);
  }

  function handleDrop(sectionKey: string, items: PropertyRow[], targetId: string) {
    if (!dragId || dragKey !== sectionKey || dragId === targetId) {
      resetDrag();
      return;
    }
    const ids = items.map((p) => p.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) {
      resetDrag();
      return;
    }
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    reorder.mutate({ orderedIds: ids });
    resetDrag();
  }

  return (
    <div className="space-y-7">
      {sections.map((s) => (
        <section key={s.key} className="animate-fade-up">
          <GroupHeader
            group={s.group}
            name={s.name}
            color={s.color}
            count={s.items.length}
          />
          {s.items.length === 0 ? (
            <div className="text-[13px] text-whisper italic px-1">
              Noch keine Apartments in dieser Gruppe.
            </div>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {s.items.map((p) => (
                  <PropertyRowItem
                    key={p.id}
                    property={p}
                    groups={groups}
                    crsCapable={crsCapable.has(p.id)}
                    fullSync={fullSyncByProp.get(p.id)}
                    drag={{
                      draggable: armedId === p.id,
                      canDrop: dragId !== null && dragKey === s.key,
                      isOver: overId === p.id && dragId !== p.id && dragKey === s.key,
                      isDragging: dragId === p.id,
                      onArm: () => setArmedId(p.id),
                      onDisarm: () => {
                        if (!dragId) setArmedId(null);
                      },
                      onDragStart: () => {
                        setDragId(p.id);
                        setDragKey(s.key);
                      },
                      onDragEnterRow: () => {
                        if (dragId && dragKey === s.key) setOverId(p.id);
                      },
                      onDrop: () => handleDrop(s.key, s.items, p.id),
                      onDragEnd: resetDrag,
                    }}
                  />
                ))}
              </ul>
            </Card>
          )}
        </section>
      ))}
    </div>
  );
}

interface RowDragProps {
  draggable: boolean;
  /** A drag is active within this row's group → this row is a valid drop target. */
  canDrop: boolean;
  isOver: boolean;
  isDragging: boolean;
  onArm: () => void;
  onDisarm: () => void;
  onDragStart: () => void;
  onDragEnterRow: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

/**
 * Group section header. Real groups get a kebab (rename/color, delete). The
 * synthetic "Ohne Gruppe" bucket (group === null) is read-only.
 */
function GroupHeader({
  group,
  name,
  color,
  count,
}: {
  group: GroupRow | null;
  name: string;
  color: string;
  count: number;
}) {
  const utils = trpc.useUtils();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const del = trpc.propertyGroups.delete.useMutation({
    onSuccess: () => {
      toast.success(`Gruppe „${name}" gelöscht`);
      void utils.propertyGroups.list.invalidate();
      setShowDelete(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const empty = count === 0;

  return (
    <div className="flex items-center gap-3 mb-3 px-1">
      <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />
      <h2 className="display text-[18px] font-medium text-ink">{name}</h2>
      <span className="num text-[12px] text-muted">{count}</span>
      <div className="flex-1 border-b border-line ml-2" />

      {group && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className={cn(
              'inline-flex items-center justify-center h-7 w-7 rounded-md',
              'text-muted hover:text-ink hover:bg-sunken transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            )}
            aria-label={`Aktionen für Gruppe ${name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical className="h-4 w-4" strokeWidth={1.75} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className={cn(
                'absolute right-0 top-full mt-1 z-20 min-w-[180px]',
                'rounded-lg border border-line bg-surface shadow-lg py-1 animate-fade-up',
              )}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setShowEdit(true);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-ink hover:bg-sunken text-left"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                Bearbeiten
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!empty}
                onClick={() => {
                  if (!empty) return;
                  setMenuOpen(false);
                  setShowDelete(true);
                }}
                title={empty ? undefined : 'Gruppe muss leer sein, um sie zu löschen'}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-left',
                  empty
                    ? 'text-danger hover:bg-danger-soft'
                    : 'text-whisper cursor-not-allowed',
                )}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Löschen
              </button>
              {!empty && (
                <p className="px-3 pt-1 pb-1 text-[11px] text-whisper leading-snug">
                  Erst alle Apartments entfernen oder verschieben.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {showEdit && group && (
        <GroupDialog
          group={group}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            utils.propertyGroups.list.invalidate();
            setShowEdit(false);
          }}
        />
      )}

      {showDelete && group && (
        <ConfirmDeleteGroupDialog
          name={name}
          pending={del.isPending}
          onClose={() => setShowDelete(false)}
          onConfirm={() => del.mutate({ id: group.id })}
        />
      )}
    </div>
  );
}

function PropertyRowItem({
  property,
  groups,
  crsCapable,
  fullSync,
  drag,
}: {
  property: PropertyRow;
  groups: GroupRow[];
  crsCapable: boolean;
  fullSync: FullSyncRow | undefined;
  drag: RowDragProps;
}) {
  const utils = trpc.useUtils();
  const onboard = trpc.properties.onboardToChannex.useMutation({
    onSuccess: () => {
      toast.success(`${property.name} mit Channex verbunden`);
      void utils.properties.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const fullSyncMut = trpc.sync.fullSync.useMutation({
    onSuccess: () => {
      toast.success(`Full Sync für ${property.name} gestartet`);
      void utils.sync.fullSyncStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const editMut = trpc.properties.update.useMutation({
    onSuccess: () => {
      toast.success(`${property.name} aktualisiert`);
      void utils.properties.list.invalidate();
      setShowEdit(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.properties.delete.useMutation({
    onSuccess: () => {
      toast.success(`${property.name} gelöscht`);
      void utils.properties.list.invalidate();
      setShowDelete(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const [showSimulate, setShowSimulate] = useState(false);
  const [showChannels, setShowChannels] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close kebab dropdown on outside click or ESC.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const connected = !!property.channexPropertyRef;
  // Only offer the simulator where Channex will actually accept a CRS
  // booking (property has a CRS app connected). Avoids a confusing 403.
  const canSimulate = import.meta.env.DEV && crsCapable;

  const fs = (fullSync?.result ?? null) as {
    availabilityTaskIds?: string[];
    restrictionTaskIds?: string[];
  } | null;

  return (
    <li
      draggable={drag.draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        // Firefox needs data set for drag to start.
        e.dataTransfer.setData('text/plain', property.id);
        drag.onDragStart();
      }}
      onDragEnter={(e) => {
        if (drag.canDrop) e.preventDefault();
        drag.onDragEnterRow();
      }}
      onDragOver={(e) => {
        // Must preventDefault on every dragover for the drop to be accepted.
        if (drag.canDrop) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        drag.onDrop();
      }}
      onDragEnd={drag.onDragEnd}
      className={cn(
        'px-4 py-3 hover:bg-sunken/40 transition-colors',
        drag.isDragging && 'opacity-40',
        drag.isOver && 'border-t-2 border-brand',
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onMouseDown={drag.onArm}
          onMouseUp={drag.onDisarm}
          onBlur={drag.onDisarm}
          className="text-whisper hover:text-muted cursor-grab active:cursor-grabbing touch-none"
          aria-label="Zum Sortieren ziehen"
          title="Zum Sortieren ziehen"
          tabIndex={-1}
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[14px] font-medium text-ink truncate">
              {property.name}
            </span>
            {property.currency && (
              <span
                className={cn(
                  'inline-flex items-center text-[10px] uppercase tracking-wider font-semibold',
                  'px-1.5 py-0.5 rounded bg-sunken text-muted flex-shrink-0',
                )}
                title="Apartment-spezifische Währung (überschreibt den Workspace-Default)"
              >
                {property.currency}
              </span>
            )}
          </div>
          {property.description && (
            <div className="text-[12px] text-muted truncate mt-0.5">
              {property.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {connected ? (
            <>
              {canSimulate && (
                <button
                  type="button"
                  onClick={() => setShowSimulate(true)}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded-md',
                    'text-whisper hover:text-ink hover:bg-sunken',
                    'text-[11px] transition-colors',
                  )}
                  title="Sandbox: OTA-Buchung simulieren"
                >
                  <FlaskConical className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Simulieren
                </button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                iconLeft={<Plug className="h-3.5 w-3.5" />}
                onClick={() => setShowChannels(true)}
                title="Airbnb / Booking.com / Vrbo Listings verbinden"
              >
                Kanäle
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={fullSyncMut.isPending}
                iconLeft={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => fullSyncMut.mutate({ propertyId: property.id })}
                title="500 Tage Verfügbarkeit + Raten an Channex senden (2 Calls)"
              >
                Full Sync
              </Button>
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
            </>
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

          {/* Kebab menu — rename / delete. Available regardless of connection. */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className={cn(
                'inline-flex items-center justify-center h-7 w-7 rounded-md',
                'text-muted hover:text-ink hover:bg-sunken transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              )}
              aria-label={`Aktionen für ${property.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreVertical className="h-4 w-4" strokeWidth={1.75} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className={cn(
                  'absolute right-0 top-full mt-1 z-20 min-w-[160px]',
                  'rounded-lg border border-line bg-surface shadow-lg',
                  'py-1 animate-fade-up',
                )}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowEdit(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-ink hover:bg-sunken text-left"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Bearbeiten
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowDelete(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-danger hover:bg-danger-soft text-left"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Löschen
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {connected && fs && (
        <FullSyncResult
          finishedAt={fullSync?.finishedAt ?? null}
          availability={fs.availabilityTaskIds ?? []}
          restrictions={fs.restrictionTaskIds ?? []}
        />
      )}

      {showSimulate && (
        <SimulateBookingDialog
          propertyId={property.id}
          propertyName={property.name}
          onClose={() => setShowSimulate(false)}
        />
      )}

      {showChannels && (
        <ChannelsDialog
          propertyId={property.id}
          propertyName={property.name}
          onClose={() => setShowChannels(false)}
        />
      )}

      {showEdit && (
        <EditApartmentDialog
          currentName={property.name}
          currentGroupId={property.groupId ?? null}
          groups={groups}
          pending={editMut.isPending}
          onClose={() => setShowEdit(false)}
          onSubmit={(name, groupId) =>
            editMut.mutate({ id: property.id, name, groupId })
          }
        />
      )}

      {showDelete && (
        <DeleteApartmentDialog
          name={property.name}
          connected={connected}
          pending={deleteMut.isPending}
          onClose={() => setShowDelete(false)}
          onConfirm={() => deleteMut.mutate({ id: property.id })}
        />
      )}
    </li>
  );
}

/**
 * Edit an apartment's name + group. Changing the group here is how you move an
 * apartment between groups (drag only reorders within a group). The Channex
 * side is left as-is — a UI label/group change never triggers a Channex call.
 */
function EditApartmentDialog({
  currentName,
  currentGroupId,
  groups,
  pending,
  onClose,
  onSubmit,
}: {
  currentName: string;
  currentGroupId: string | null;
  groups: GroupRow[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string, groupId: string | null) => void;
}) {
  const [name, setName] = useState(currentName);
  const [groupId, setGroupId] = useState<string>(currentGroupId ?? '');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 80;
  const changed = trimmed !== currentName.trim() || (groupId || null) !== currentGroupId;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || !changed) return;
    onSubmit(trimmed, groupId || null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-[420px] bg-surface rounded-t-2xl sm:rounded-xl shadow-lg border border-line animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-brand" strokeWidth={1.75} />
            <h2 className="display text-[20px] font-medium text-ink">
              Apartment bearbeiten
            </h2>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            Name und Gruppe ändern. Der Name in Channex bleibt unverändert.
          </p>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
              invalid={!valid}
            />
            {!valid && (
              <p className="text-[12px] text-negative">
                Name muss zwischen 1 und 80 Zeichen lang sein.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-group">Gruppe</Label>
            <select
              id="edit-group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            >
              <option value="">Ohne Gruppe</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="brand"
              loading={pending}
              disabled={!valid || !changed || pending}
            >
              Speichern
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Create or edit a property group (name + color). `group` undefined = create.
 */
function GroupDialog({
  group,
  onClose,
  onSaved,
}: {
  group?: GroupRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [color, setColor] = useState(group?.color ?? GROUP_COLORS[0]!);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = trpc.propertyGroups.create.useMutation({
    onSuccess: () => {
      toast.success('Gruppe erstellt');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.propertyGroups.update.useMutation({
    onSuccess: () => {
      toast.success('Gruppe gespeichert');
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const pending = create.isPending || update.isPending;
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 80;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    if (group) update.mutate({ id: group.id, name: trimmed, color });
    else create.mutate({ name: trimmed, color });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-[420px] bg-surface rounded-t-2xl sm:rounded-xl shadow-lg border border-line animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-brand" strokeWidth={1.75} />
            <h2 className="display text-[20px] font-medium text-ink">
              {group ? 'Gruppe bearbeiten' : 'Neue Gruppe'}
            </h2>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            Gruppen bündeln Apartments (z. B. nach Gebäude oder Stadt).
          </p>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="z. B. Vorrathstraße"
              autoFocus
              invalid={!!name && !valid}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Farbe</Label>
            <div className="flex flex-wrap gap-2">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Farbe ${c}`}
                  aria-pressed={color === c}
                  className={cn(
                    'h-7 w-7 rounded-md transition-transform',
                    color === c
                      ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink scale-105'
                      : 'hover:scale-105',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" variant="brand" loading={pending} disabled={!valid || pending}>
              {group ? 'Speichern' : 'Erstellen'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Confirm dialog for deleting an (already empty) group. */
function ConfirmDeleteGroupDialog({
  name,
  pending,
  onClose,
  onConfirm,
}: {
  name: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-[420px] bg-surface rounded-t-2xl sm:rounded-xl shadow-lg border border-line animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger" strokeWidth={1.75} />
            <h2 className="display text-[20px] font-medium text-ink">Gruppe löschen</h2>
          </div>
          <p className="mt-3 text-[13px] text-ink">
            Möchtest du die Gruppe <span className="font-medium">{name}</span> wirklich löschen?
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            Die Gruppe ist leer — es werden keine Apartments gelöscht.
          </p>
        </div>
        <div className="px-6 pb-6 pt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
            iconLeft={<Trash2 className="h-3.5 w-3.5" />}
          >
            Löschen
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Confirmation modal for destructive delete. Cascade rules in the schema
 * (`onDelete: 'cascade'` on the child tables) handle the cleanup of bookings,
 * rate overrides, ari_pending entries, messages, channex_properties etc.
 * Channex itself has no property-delete API, so the upstream record stays.
 */
function DeleteApartmentDialog({
  name,
  connected,
  pending,
  onClose,
  onConfirm,
}: {
  name: string;
  connected: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-[460px] bg-surface rounded-t-2xl sm:rounded-xl shadow-lg border border-line animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-danger" strokeWidth={1.75} />
            <h2 className="display text-[20px] font-medium text-ink">
              Apartment löschen
            </h2>
          </div>
          <p className="mt-3 text-[13px] text-ink">
            Möchtest du <span className="font-medium">{name}</span> wirklich löschen?
          </p>
          <ul className="mt-2 text-[12.5px] text-muted space-y-1 list-disc list-inside">
            <li>Alle Buchungen, Blöcke und Rate-Overrides werden mitgelöscht.</li>
            <li>Cleaning-Regeln und Sync-Verlauf für dieses Apartment werden entfernt.</li>
            {connected && (
              <li>
                Die Channex-Verknüpfung wird gelöst. Das Apartment in Channex selbst
                bleibt bestehen — dort musst du es ggf. separat archivieren.
              </li>
            )}
            <li>Diese Aktion kann nicht rückgängig gemacht werden.</li>
          </ul>
        </div>
        <div className="px-6 pb-6 pt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={pending}
            disabled={pending}
            onClick={onConfirm}
            iconLeft={<Trash2 className="h-3.5 w-3.5" />}
          >
            Endgültig löschen
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact Full Sync result line — shows the Channex task id(s) returned by
 * the last full sync. The ids are click-to-copy for the certification form.
 */
function FullSyncResult({
  finishedAt,
  availability,
  restrictions,
}: {
  finishedAt: Date | string | null;
  availability: string[];
  restrictions: string[];
}) {
  const when = finishedAt
    ? new Date(finishedAt).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="mt-2 ml-7 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
      <span className="inline-flex items-center gap-1 text-positive">
        <Check className="h-3 w-3" strokeWidth={2.5} />
        Full Sync{when ? ` · ${when}` : ''}
      </span>
      {availability.map((id) => (
        <TaskId key={id} label="Availability" id={id} />
      ))}
      {restrictions.map((id) => (
        <TaskId key={id} label="Restrictions" id={id} />
      ))}
      {availability.length === 0 && restrictions.length === 0 && (
        <span className="text-whisper italic">keine Task-ID zurückgegeben</span>
      )}
    </div>
  );
}

function TaskId({ label, id }: { label: string; id: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(id);
        toast.success(`${label}-Task-ID kopiert`);
      }}
      title="Klicken zum Kopieren"
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded',
        'bg-sunken text-muted hover:text-ink transition-colors',
      )}
    >
      <span className="text-whisper">{label}:</span>
      <span className="num">{id}</span>
      <Copy className="h-3 w-3" strokeWidth={1.75} />
    </button>
  );
}

/**
 * Per-apartment channel-mapping modal. Embeds the same Channex /channels
 * self-service screen as the dedicated Kanäle page, scoped to one apartment,
 * so the tenant can connect Airbnb / Booking.com / … right from the row.
 */
function ChannelsDialog({
  propertyId,
  propertyName,
  onClose,
}: {
  propertyId: string;
  propertyName: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-[920px] bg-surface rounded-t-2xl sm:rounded-xl shadow-lg border border-line animate-fade-up max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-brand" strokeWidth={1.75} />
              <h2 className="display text-[20px] font-medium text-ink">Kanäle</h2>
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              Verbinde Airbnb / Booking.com / Vrbo mit{' '}
              <span className="font-medium text-ink">{propertyName}</span>.
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
        <div className="px-6 pb-6">
          <ChannelMappingFrame
            propertyId={propertyId}
            propertyName={propertyName}
            heightClass="h-[68dvh] min-h-[420px]"
          />
        </div>
      </div>
    </div>
  );
}

function SimulateBookingDialog({
  propertyId,
  propertyName,
  onClose,
}: {
  propertyId: string;
  propertyName: string;
  onClose: () => void;
}) {
  // Default to a stay 30 days out so it doesn't collide with existing bookings.
  const defaultArrival = new Date();
  defaultArrival.setUTCDate(defaultArrival.getUTCDate() + 30);
  const defaultDeparture = new Date(defaultArrival);
  defaultDeparture.setUTCDate(defaultDeparture.getUTCDate() + 2);

  const [arrival, setArrival] = useState(defaultArrival.toISOString().slice(0, 10));
  const [departure, setDeparture] = useState(defaultDeparture.toISOString().slice(0, 10));
  const [otaName, setOtaName] = useState<'Offline' | 'Airbnb' | 'BookingCom' | 'Expedia'>('Airbnb');
  const [nightlyRate, setNightlyRate] = useState('80.00');
  const [guestName, setGuestName] = useState('Sandbox');
  const [guestSurname, setGuestSurname] = useState('Tester');
  const [adults, setAdults] = useState(2);

  const simulate = trpc.bookings.simulateChannexBooking.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Buchung in Channex angelegt (${res.otaName}). Sync läuft – Anzeige im Kalender folgt.`,
      );
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    simulate.mutate({
      propertyId,
      arrivalDate: arrival,
      departureDate: departure,
      otaName,
      nightlyRate,
      guestName: guestName.trim() || 'Sandbox',
      guestSurname: guestSurname.trim() || 'Tester',
      adults,
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
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-brand" strokeWidth={1.75} />
            <h2 className="display text-[20px] font-medium text-ink">
              Sandbox-Buchung simulieren
            </h2>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">
            Legt eine OTA-Buchung für <span className="font-medium text-ink">{propertyName}</span>{' '}
            direkt in Channex an und triggert anschließend den Feed-Ingest.
          </p>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 pt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sim-ota">OTA</Label>
            <select
              id="sim-ota"
              value={otaName}
              onChange={(e) => setOtaName(e.target.value as typeof otaName)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            >
              <option value="Airbnb">Airbnb</option>
              <option value="BookingCom">Booking.com</option>
              <option value="Expedia">Expedia</option>
              <option value="Offline">Offline</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sim-arr">Anreise</Label>
              <Input
                id="sim-arr"
                type="date"
                value={arrival}
                onChange={(e) => setArrival(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-dep">Abreise</Label>
              <Input
                id="sim-dep"
                type="date"
                value={departure}
                onChange={(e) => setDeparture(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sim-rate">Preis / Nacht (EUR)</Label>
              <Input
                id="sim-rate"
                type="text"
                inputMode="decimal"
                value={nightlyRate}
                onChange={(e) => setNightlyRate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-adults">Erwachsene</Label>
              <Input
                id="sim-adults"
                type="number"
                min={1}
                max={20}
                value={adults}
                onChange={(e) => setAdults(Number(e.target.value) || 1)}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sim-name">Vorname Gast</Label>
              <Input
                id="sim-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sim-surname">Nachname Gast</Label>
              <Input
                id="sim-surname"
                value={guestSurname}
                onChange={(e) => setGuestSurname(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="brand"
              loading={simulate.isPending}
              iconLeft={<FlaskConical className="h-4 w-4" />}
            >
              Buchung anlegen
            </Button>
          </div>
        </form>
      </div>
    </div>
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
  const [currency, setCurrency] = useState<string>('');

  const currencyOptions = useMemo(
    () => withPreferred(intlSupported('currency', CURRENCY_FALLBACK), 'EUR', currency || 'EUR'),
    [currency],
  );

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
      currency: currency || undefined,
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
          <div className="space-y-1.5">
            <Label htmlFor="apt-currency">Currency</Label>
            <select
              id="apt-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-ink focus:outline-none transition-colors"
            >
              <option value="">Workspace default</option>
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {currencyName(c)}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-whisper">
              Leave on workspace default unless this apartment trades in a
              different currency (e.g. a USD test property).
            </p>
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
