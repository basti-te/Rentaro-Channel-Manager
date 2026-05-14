import { cn } from '@cm/ui';
import { GripVertical, RefreshCw } from 'lucide-react';
import { ROW_H, RAIL_W } from './utils';

export type SyncState = 'idle' | 'running' | 'success' | 'error';

interface PropertyRailProps {
  name: string;
  groupColor?: string | null;
  syncState?: SyncState;
  /** Human label like "vor 2 Min." for the tooltip. */
  lastSyncRelative?: string | null;
  /** When set, the tooltip shows this on error state. */
  lastError?: string | null;
  /** Disabled while a sync is in flight or trigger mutation pending. */
  syncDisabled?: boolean;
  onSyncClick?: () => void;
}

export function PropertyRail({
  name,
  groupColor,
  syncState = 'idle',
  lastSyncRelative,
  lastError,
  syncDisabled,
  onSyncClick,
}: PropertyRailProps) {
  return (
    <div
      className={cn(
        'sticky left-0 z-20 flex items-center gap-1 pl-1.5 pr-1',
        'bg-surface border-r border-line-strong border-b border-line',
        'group/rail',
      )}
      style={{ width: RAIL_W, height: ROW_H }}
    >
      {/* Group color marker — vertical bar */}
      <span
        aria-hidden
        className="flex-shrink-0 h-7 w-[3px] rounded-sm"
        style={{ background: groupColor ?? 'rgb(var(--line-strong))' }}
      />

      {/* Drag handle — visible on row hover. Hidden below md (no hover on touch). */}
      <button
        type="button"
        className={cn(
          'hidden md:inline-flex flex-shrink-0 text-whisper opacity-0',
          'group-hover/rail:opacity-100 transition-opacity hover:text-muted',
          'cursor-grab active:cursor-grabbing',
        )}
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {/* Apartment name */}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-ink leading-none truncate">
          {name}
        </div>
      </div>

      {/* Sync button */}
      <SyncButton
        state={syncState}
        disabled={syncDisabled}
        lastSyncRelative={lastSyncRelative}
        lastError={lastError}
        onClick={onSyncClick}
      />
    </div>
  );
}

function SyncButton({
  state,
  disabled,
  lastSyncRelative,
  lastError,
  onClick,
}: {
  state: SyncState;
  disabled?: boolean;
  lastSyncRelative?: string | null;
  lastError?: string | null;
  onClick?: () => void;
}) {
  const title = (() => {
    if (state === 'running') return 'Synchronisiere…';
    if (state === 'error') return `Fehler: ${lastError ?? 'unbekannt'}`;
    if (state === 'success' && lastSyncRelative) return `Synchronisiert · ${lastSyncRelative}`;
    return 'Jetzt synchronisieren';
  })();

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick?.();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={disabled || state === 'running'}
      className={cn(
        'flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center',
        'transition-[background-color,color] duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        state === 'idle' && 'text-muted hover:text-ink hover:bg-sunken',
        state === 'running' && 'text-brand bg-brand-soft cursor-wait',
        state === 'success' && 'text-positive bg-positive-soft hover:bg-positive-soft/80',
        state === 'error' && 'text-danger bg-danger-soft hover:bg-danger-soft/80',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
      aria-label={title}
      title={title}
    >
      <RefreshCw
        className={cn('h-3.5 w-3.5', state === 'running' && 'animate-spin')}
        strokeWidth={2}
      />
    </button>
  );
}

interface GroupHeaderProps {
  name: string;
  color: string;
  count: number;
  rightFill?: number;
}

export function GroupHeader({ name, color, count, rightFill }: GroupHeaderProps) {
  return (
    <div className="flex border-b border-line bg-canvas/80 backdrop-blur-[2px]">
      <div
        className="sticky left-0 z-20 flex items-center gap-2 bg-canvas/95 border-r border-line"
        style={{ width: RAIL_W, height: 32, paddingLeft: 10 }}
      >
        <span
          aria-hidden
          className="flex-shrink-0 h-2 w-2 rounded-[2px]"
          style={{ background: color }}
        />
        <h3 className="display text-[12px] font-medium text-ink tracking-tight truncate min-w-0">
          {name}
        </h3>
        <span className="num text-[10px] text-whisper flex-shrink-0">{count}</span>
      </div>
      <div
        aria-hidden
        className="flex-1 h-[32px]"
        style={{ width: rightFill ? `${rightFill}px` : undefined }}
      />
    </div>
  );
}
