import { cn } from '@cm/ui';

/**
 * Brand lockup — the Rentaro "R" mark as a rounded-square badge next to
 * the "Rentaro" wordmark (Fraunces). The logo asset lives in
 * apps/web/public/logo.png and is also the favicon.
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
  const badge = {
    sm: 'h-6 w-6 rounded-md',
    md: 'h-7 w-7 rounded-md',
    lg: 'h-14 w-14 rounded-xl',
  }[size];
  const text = {
    sm: 'text-[15px]',
    md: 'text-[17px]',
    lg: 'text-[22px]',
  }[size];

  return (
    <div className={cn('inline-flex items-center gap-2.5', className)}>
      <img
        src="/logo.png"
        alt="Rentaro"
        width={64}
        height={64}
        className={cn('object-cover ring-1 ring-black/5', badge)}
        style={{ boxShadow: '0 1px 3px rgba(13,26,43,0.22)' }}
      />
      {showText && (
        <span
          className={cn(
            'display font-medium leading-none tracking-tight text-ink',
            text,
          )}
          style={{ fontVariationSettings: "'opsz' 14, 'SOFT' 30" }}
        >
          Rentaro
        </span>
      )}
    </div>
  );
}
