import { cn } from '@cm/ui';
import { GripVertical, RefreshCw } from 'lucide-react';
import { ROW_H, RAIL_W } from './utils';

interface PropertyRailProps {
  name: string;
  groupColor?: string | null;
  syncState?: 'idle' | 'running' | 'success' | 'error';
  lastSyncRelative?: string | null;
}

export function PropertyRail({
  name,
  groupColor,
  syncState = 'idle',
  lastSyncRelative: _lastSyncRelative,
}: PropertyRailProps) {
  return (
    <div
      className={cn(
        'sticky left-0 z-10 flex items-center gap-1 pl-1.5 pr-1',
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
      <SyncButton state={syncState} />
    </div>
  );
}

function SyncButton({ state }: { state: 'idle' | 'running' | 'success' | 'error' }) {
  return (
    <button
      type="button"
      className={cn(
        'flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center',
        'transition-[background-color,color] duration-150',
        state === 'idle' && 'text-muted hover:text-ink hover:bg-sunken',
        state === 'running' && 'text-brand bg-brand-soft',
        state === 'success' && 'text-positive bg-positive-soft',
        state === 'error' && 'text-danger bg-danger-soft',
      )}
      aria-label="Synchronize"
      title="Synchronize availability"
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
  rightFill?: number; // width of the day rail to fill
}

export function GroupHeader({ name, color, count, rightFill }: GroupHeaderProps) {
  return (
    <div className="flex border-b border-line bg-canvas/80 backdrop-blur-[2px]">
      <div
        className="sticky left-0 z-10 flex items-center gap-2 bg-canvas/95 border-r border-line"
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
      {/* Visual continuation rule across the scroll area */}
      <div
        aria-hidden
        className="flex-1 h-[32px]"
        style={{ width: rightFill ? `${rightFill}px` : undefined }}
      />
    </div>
  );
}
