import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Building2, Calendar, Plug, type LucideIcon } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import { PageHeader } from './_dashboard';
import { trpc } from '../lib/trpc';

/** Local YYYY-MM-DD (no UTC shift). */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function OverviewPage() {
  const propsQ = trpc.properties.list.useQuery();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const bookingsQ = trpc.bookings.listByRange.useQuery({
    from: isoDate(monthStart),
    to: isoDate(monthEnd),
  });

  const apartments = propsQ.data?.length ?? null;
  const connected = propsQ.data
    ? propsQ.data.filter((p) => !!p.channexPropertyRef).length
    : null;
  const monthKey = isoDate(now).slice(0, 7);
  const arrivalsThisMonth = bookingsQ.data
    ? bookingsQ.data.filter(
        (b) => b.source !== 'block' && b.checkin.slice(0, 7) === monthKey,
      ).length
    : null;

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
            value={apartments ?? '—'}
            href="/apartments"
          />
          <StatCard
            icon={Plug}
            label="Connected to Channex"
            value={connected ?? '—'}
            note={
              apartments != null && apartments > 0
                ? `of ${apartments} apartment${apartments === 1 ? '' : 's'}`
                : undefined
            }
            href="/apartments"
          />
          <StatCard
            icon={Calendar}
            label="Arrivals this month"
            value={arrivalsThisMonth ?? '—'}
            href="/calendar"
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
