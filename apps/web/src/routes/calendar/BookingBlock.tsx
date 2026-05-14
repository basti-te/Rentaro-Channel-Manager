import { cn } from '@cm/ui';
import { Lock } from 'lucide-react';
import { DAY_W } from './utils';

export type BookingSource =
  | 'internal'
  | 'airbnb'
  | 'booking_com'
  | 'expedia'
  | 'other_ota'
  | 'block';

interface Props {
  startCol: number; // 0-indexed day index in the viewport
  span: number; // number of nights (≥ 1)
  source: BookingSource;
  guestName?: string | null;
  priceCents?: bigint | number | null;
  currency?: string | null;
}

const sourceStyles: Record<
  BookingSource,
  { bg: string; border: string; text: string; mark: string; label: string }
> = {
  internal: {
    bg: 'bg-[rgb(176_67_28_/_0.10)]',
    border: 'border-[rgb(176_67_28_/_0.45)]',
    text: 'text-[rgb(140_47_16)]',
    mark: 'bg-brand',
    label: 'INT',
  },
  airbnb: {
    bg: 'bg-[rgb(229_70_70_/_0.10)]',
    border: 'border-[rgb(229_70_70_/_0.40)]',
    text: 'text-[rgb(162_37_37)]',
    mark: 'bg-[rgb(229_70_70)]',
    label: 'AIR',
  },
  booking_com: {
    bg: 'bg-[rgb(36_67_135_/_0.10)]',
    border: 'border-[rgb(36_67_135_/_0.40)]',
    text: 'text-[rgb(36_67_135)]',
    mark: 'bg-[rgb(36_67_135)]',
    label: 'BDC',
  },
  expedia: {
    bg: 'bg-[rgb(252_201_45_/_0.12)]',
    border: 'border-[rgb(176_135_30_/_0.45)]',
    text: 'text-[rgb(120_92_18)]',
    mark: 'bg-[rgb(220_170_40)]',
    label: 'EXP',
  },
  other_ota: {
    bg: 'bg-[rgb(120_122_135_/_0.10)]',
    border: 'border-[rgb(120_122_135_/_0.40)]',
    text: 'text-[rgb(70_72_85)]',
    mark: 'bg-[rgb(120_122_135)]',
    label: 'OTA',
  },
  block: {
    bg: 'bg-[repeating-linear-gradient(135deg,rgb(0_0_0_/_0.04)_0_6px,transparent_6px_12px)]',
    border: 'border-line-strong',
    text: 'text-muted',
    mark: 'bg-muted',
    label: 'BLK',
  },
};

export function BookingBlock({
  startCol,
  span,
  source,
  guestName,
  priceCents,
  currency,
}: Props) {
  const s = sourceStyles[source];
  const isBlock = source === 'block';
  const inset = 4; // gap between block and cell edges
  const left = startCol * DAY_W + inset;
  const width = span * DAY_W - inset * 2;

  const display =
    guestName ?? (isBlock ? 'Geblockt' : 'Buchung');
  const price =
    priceCents != null
      ? formatPrice(typeof priceCents === 'bigint' ? Number(priceCents) : priceCents, currency)
      : null;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'absolute top-[6px] bottom-[6px] flex items-center gap-2 px-2',
        'rounded-md border overflow-hidden cursor-pointer',
        'transition-[transform,box-shadow] duration-150 ease-out-snap',
        'hover:shadow-md hover:-translate-y-px',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        s.bg,
        s.border,
        s.text,
      )}
      style={{ left, width }}
      title={`${display}${price ? ` · ${price}` : ''}`}
    >
      {/* Source mark — small color tab on the left, editorial-stamp style */}
      <span aria-hidden className={cn('flex-shrink-0 h-3.5 w-[3px] rounded-sm', s.mark)} />

      {/* Channel chip — tiny letters identifying source */}
      {!isBlock ? (
        <span
          aria-hidden
          className={cn(
            'flex-shrink-0 text-[9px] font-semibold tracking-[0.08em]',
            s.text,
            'opacity-80',
          )}
        >
          {s.label}
        </span>
      ) : (
        <Lock className="h-3 w-3 flex-shrink-0 text-muted" strokeWidth={2} />
      )}

      {/* Guest name + (price if width allows) */}
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-none">
        {display}
      </span>
      {price && width > 140 && (
        <span className="num text-[10.5px] flex-shrink-0 opacity-70">{price}</span>
      )}
    </div>
  );
}

function formatPrice(cents: number, currency: string | null | undefined): string {
  const value = cents / 100;
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : (currency ?? '');
  if (value >= 1000) return `${symbol}${(value / 1000).toFixed(1)}k`;
  return `${symbol}${value.toFixed(0)}`;
}
