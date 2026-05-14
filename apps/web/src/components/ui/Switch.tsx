import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@cm/ui';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Optional label rendered to the right of the track. */
  label?: string;
  size?: 'sm' | 'md';
}

/**
 * Accessible toggle switch. Use for boolean settings where the change takes
 * effect immediately (no save button). For form fields, prefer a checkbox.
 */
export const Switch = forwardRef<HTMLButtonElement, Props>(function Switch(
  { checked, onChange, label, size = 'md', disabled, className, ...rest },
  ref,
) {
  const dims = size === 'sm'
    ? { track: 'h-4 w-7', dot: 'h-3 w-3', dotTx: 'translate-x-3', dotIdle: 'translate-x-0.5' }
    : { track: 'h-[22px] w-10', dot: 'h-[18px] w-[18px]', dotTx: 'translate-x-[20px]', dotIdle: 'translate-x-0.5' };

  const button = (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex items-center rounded-full flex-shrink-0',
        'transition-colors duration-200 ease-out-snap',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        disabled && 'opacity-50 cursor-not-allowed',
        checked ? 'bg-brand' : 'bg-line-strong',
        dims.track,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-out-snap',
          dims.dot,
          checked ? dims.dotTx : dims.dotIdle,
        )}
      />
    </button>
  );

  if (label) {
    return (
      <label className={cn('inline-flex items-center gap-2.5 cursor-pointer', className)}>
        {button}
        <span className="text-[13px] text-ink">{label}</span>
      </label>
    );
  }

  return button;
});
