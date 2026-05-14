import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@cm/ui';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'brand' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium ' +
  'transition-[transform,background-color,color,border-color,box-shadow] ' +
  'duration-150 ease-out-snap disabled:opacity-50 disabled:cursor-not-allowed ' +
  'active:scale-[.985] focus-visible:outline-2 focus-visible:outline-offset-2';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-canvas border border-accent ' +
    'hover:bg-accent-soft hover:border-accent-soft ' +
    'shadow-sm hover:shadow-md',
  brand:
    'bg-brand text-white border border-brand ' +
    'hover:bg-brand-deep hover:border-brand-deep ' +
    'shadow-sm hover:shadow-md',
  secondary:
    'bg-surface text-ink border border-line ' +
    'hover:bg-sunken hover:border-line-strong ' +
    'shadow-sm',
  ghost:
    'bg-transparent text-ink-soft border border-transparent ' +
    'hover:bg-sunken hover:text-ink',
  danger:
    'bg-surface text-danger border border-line ' +
    'hover:bg-danger-soft hover:border-danger',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-md',
  md: 'h-10 px-4 text-sm rounded-md',
  lg: 'h-11 px-5 text-[15px] rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', loading, iconLeft, iconRight, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : iconLeft}
      {children}
      {iconRight}
    </button>
  );
});
