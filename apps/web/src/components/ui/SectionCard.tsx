import type { ReactNode } from 'react';
import { Card } from './Card';

/**
 * A titled settings card: heading + optional description + content. Shared by
 * the Settings page and the standalone pages split out of it (Notifications,
 * Teammates, Reviews) so they render identically.
 */
export function SectionCard({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="mb-3">
        <h2 className="display text-[16px] font-medium text-ink">{title}</h2>
        {desc && <p className="text-[12.5px] text-muted mt-0.5">{desc}</p>}
      </div>
      {children}
    </Card>
  );
}
