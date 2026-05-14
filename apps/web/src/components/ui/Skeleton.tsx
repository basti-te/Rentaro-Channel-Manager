import type { HTMLAttributes } from 'react';
import { cn } from '@cm/ui';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-md',
        'bg-[linear-gradient(110deg,rgb(var(--sunken))_30%,rgb(var(--line))_50%,rgb(var(--sunken))_70%)]',
        'bg-[length:200%_100%] animate-shimmer',
        className,
      )}
      {...rest}
    />
  );
}
