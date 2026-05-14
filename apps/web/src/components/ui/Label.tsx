import type { LabelHTMLAttributes } from 'react';
import { cn } from '@cm/ui';

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'block text-[12px] font-medium tracking-wide uppercase text-muted',
        className,
      )}
      {...rest}
    />
  );
}
