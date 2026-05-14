import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Building2, Calendar, Plug, type LucideIcon } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import { PageHeader } from './_dashboard';
import { trpc } from '../lib/trpc';

export function OverviewPage() {
  const propsQ = trpc.properties.list.useQuery();
  const groupsQ = trpc.propertyGroups.list.useQuery();

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Welcome back. Here's the current state of your workspace."
      />
      <div className="px-8 py-7 max-w-5xl space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={Building2}
            label="Apartments"
            value={propsQ.data?.length ?? '—'}
            href="/apartments"
          />
          <StatCard
            icon={Plug}
            label="Channels connected"
            value="0"
            note="Configure in Phase 7"
          />
          <StatCard
            icon={Calendar}
            label="Bookings this month"
            value="—"
            note="Available in Phase 6"
          />
        </div>

        {(propsQ.data?.length ?? 0) === 0 && (
          <Card>
            <CardBody>
              <div className="flex items-start gap-4 py-2">
                <div className="h-10 w-10 rounded-md bg-brand-soft text-brand flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="flex-1">
                  <h3 className="text-[15px] font-semibold text-ink">
                    Add your first apartments
                  </h3>
                  <p className="mt-1 text-[13px] text-muted leading-relaxed max-w-[60ch]">
                    Group them by building or city, set up rates, and connect
                    Airbnb / Booking.com via Channex when you&rsquo;re ready.
                  </p>
                  <Link
                    to="/apartments"
                    className="inline-flex items-center gap-1.5 mt-3 text-[13px] font-medium text-brand hover:text-brand-deep transition-colors"
                  >
                    Open apartments
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Phase progress note */}
        <Card>
          <CardBody>
            <div className="text-[11px] uppercase tracking-widest text-whisper mb-2">
              Build status
            </div>
            <div className="text-[14px] text-ink-soft leading-relaxed">
              Foundation and apartments are live (Phase 1).
              The calendar arrives in Phase 2; Channex sync in Phase 5;
              messaging in Phase 8.
            </div>
            <div className="mt-3 text-[12px] num text-muted">
              Groups: {groupsQ.data?.length ?? '—'} · Apartments:{' '}
              {propsQ.data?.length ?? '—'}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  note,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  note?: string;
  href?: string;
}) {
  const inner = (
    <Card className="hover:border-line-strong transition-colors h-full">
      <CardBody className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-widest text-muted">
            {label}
          </div>
          <Icon className="h-4 w-4 text-whisper" strokeWidth={1.75} />
        </div>
        <div className="mt-3 num text-[28px] text-ink leading-none">{value}</div>
        {note && <div className="mt-2 text-[12px] text-whisper">{note}</div>}
      </CardBody>
    </Card>
  );
  return href ? <Link to={href}>{inner}</Link> : inner;
}
