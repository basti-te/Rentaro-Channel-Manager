import { cn } from '@cm/ui';

/**
 * Wordmark — sets in Fraunces with a small terracotta paper-stamp dot.
 * "CM" because the working title is `channel-manager`; replace with brand
 * once the product has a real name.
 */
export function Brand({
  className,
  showText = true,
  size = 'md',
}: {
  className?: string;
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dot = {
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
    lg: 'h-3 w-3',
  }[size];
  const text = {
    sm: 'text-[15px]',
    md: 'text-[17px]',
    lg: 'text-[22px]',
  }[size];

  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn('rounded-[2px] bg-brand', dot)}
        style={{
          boxShadow:
            '0 1px 0 rgba(255,255,255,0.4) inset, 0 1px 2px rgba(176,67,28,0.3)',
        }}
      />
      {showText && (
        <span
          className={cn(
            'display font-medium leading-none tracking-tight text-ink',
            text,
          )}
          style={{ fontVariationSettings: "'opsz' 14, 'SOFT' 30" }}
        >
          ChannelManager
        </span>
      )}
    </div>
  );
}
