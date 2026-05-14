import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@cm/ui';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ className, elevated, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-surface',
        elevated ? 'shadow-md' : 'shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface HeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, action, className }: HeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink leading-tight">{title}</h3>
        {subtitle && (
          <p className="mt-1 text-[13px] text-muted leading-relaxed">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-4', className)} {...rest}>
      {children}
    </div>
  );
}
