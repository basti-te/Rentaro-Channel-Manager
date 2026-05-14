import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@cm/ui';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-md border bg-surface px-3 text-sm text-ink',
        'placeholder:text-whisper',
        'transition-[border-color,box-shadow] duration-150 ease-out-snap',
        'border-line hover:border-line-strong',
        'focus:border-ink focus:shadow-[0_0_0_3px_rgb(var(--ink)/0.08)] focus:outline-none',
        invalid && 'border-danger hover:border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgb(var(--danger)/0.12)]',
        'disabled:bg-sunken disabled:text-muted disabled:cursor-not-allowed',
        className,
      )}
      {...rest}
    />
  );
});
