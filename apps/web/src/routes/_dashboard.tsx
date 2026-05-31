import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import {
  Building2,
  Calendar,
  LayoutGrid,
  MessageSquare,
  Plug,
  Settings,
  SprayCan,
  Star,
  Users,
  Bell,
  LogOut,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@cm/ui';

import { Brand } from '../components/Brand';
import { MobileTabBar, MOBILE_TAB_BAR_H } from '../components/MobileTabBar';
import { LockoutScreen } from '../components/LockoutScreen';
import { useAuth } from '../lib/auth';
import { trpc } from '../lib/trpc';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  /** If true, the link is non-navigable (route not built yet). Badge alone
   *  is just informational and doesn't disable. */
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { to: '/calendar',   label: 'Calendar',        icon: Calendar },
  { to: '/apartments', label: 'Apartments',      icon: Building2 },
  { to: '/channels',   label: 'Kanäle',          icon: Plug },
  { to: '/overview',   label: 'Overview',        icon: LayoutGrid },
  { to: '/messages',   label: 'Messages',        icon: MessageSquare },
  { to: '/cleaning',   label: 'Cleaning',        icon: SprayCan },
  { to: '/reviews',    label: 'Bewertungen',     icon: Star },
  { to: '/teammates',  label: 'Teammates',       icon: Users },
  { to: '/notifications', label: 'Benachrichtigungen', icon: Bell },
  { to: '/settings',   label: 'Settings',        icon: Settings },
];

export function DashboardLayout() {
  const auth = useAuth();
  const nav = useNavigate();
  const [bootstrapping, setBootstrapping] = useState(false);

  // Redirect to /login if not authed
  useEffect(() => {
    if (!auth.loading && !auth.user) {
      nav({ to: '/login' });
    }
  }, [auth.loading, auth.user, nav]);

  // Fetch current user + memberships; bootstrap a tenant if missing.
  const meQ = trpc.me.current.useQuery(undefined, {
    enabled: !!auth.user,
    retry: false,
  });
  const bootstrap = trpc.me.bootstrap.useMutation({
    onSuccess: () => meQ.refetch(),
  });

  useEffect(() => {
    if (
      auth.user &&
      meQ.data &&
      meQ.data.memberships.length === 0 &&
      !bootstrap.isPending &&
      !bootstrapping
    ) {
      setBootstrapping(true);
      bootstrap.mutate({});
    }
  }, [auth.user, meQ.data, bootstrap, bootstrapping]);

  // First-time wizard guard — if the tenant hasn't finished /onboarding yet,
  // push them there. Legacy tenants got onboarded_at backfilled by migration
  // 0017 so they sail through.
  useEffect(() => {
    const tenant = meQ.data?.memberships[0];
    if (tenant && !tenant.onboardedAt) {
      void nav({ to: '/onboarding' });
    }
  }, [meQ.data, nav]);

  // Plan / subscription gate — read regardless of route. Tenant context
  // available only after meQ resolves with at least one membership.
  const hasTenant = !!meQ.data?.memberships.length;
  const planQ = trpc.billing.currentPlan.useQuery(undefined, {
    enabled: hasTenant,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  if (auth.loading || !auth.user) {
    return <FullPageLoader label="Authenticating…" />;
  }
  if (meQ.isLoading || bootstrap.isPending) {
    return <FullPageLoader label="Setting up your workspace…" />;
  }

  const tenant = meQ.data?.memberships[0];
  const accessBlocked = hasTenant && planQ.data && !planQ.data.ok;

  return (
    <div
      className="grain min-h-dvh flex"
      style={
        // CSS variable used both for the mobile-only main padding and the
        // calendar viewport-height math (apps/web/src/routes/calendar.tsx).
        {
          ['--mobile-bar-h' as string]:
            `calc(${MOBILE_TAB_BAR_H}px + env(safe-area-inset-bottom, 0px))`,
        }
      }
    >
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar
          tenantName={tenant?.tenantName ?? 'Workspace'}
          userEmail={auth.user.email ?? ''}
          onSignOut={() => auth.signOut().then(() => nav({ to: '/login' }))}
        />
      </div>

      <main className="flex-1 min-w-0 pb-[var(--mobile-bar-h)] md:pb-0">
        {accessBlocked ? <LockoutScreen /> : <Outlet />}
      </main>

      {/* Mobile bottom tab bar — hidden on md+ */}
      <MobileTabBar />
    </div>
  );
}

function Sidebar({
  tenantName,
  userEmail,
  onSignOut,
}: {
  tenantName: string;
  userEmail: string;
  onSignOut: () => void;
}) {
  const location = useLocation();
  const path = location.pathname;

  return (
    <aside className="w-[244px] flex-shrink-0 border-r border-line bg-surface flex flex-col h-dvh sticky top-0">
      {/* Brand + tenant */}
      <div className="px-5 pt-6 pb-5">
        <Brand size="md" />
        <div className="mt-5 px-2 py-2 rounded-md bg-sunken/60 border border-line/60">
          <div className="text-[10px] uppercase tracking-widest text-whisper">
            Workspace
          </div>
          <div className="mt-0.5 text-[13px] font-medium text-ink truncate">
            {tenantName}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        <div className="text-[10px] uppercase tracking-widest text-whisper px-3 pb-2 pt-1">
          Workspace
        </div>
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active =
              item.to === '/'
                ? path === '/'
                : path === item.to || path.startsWith(item.to + '/');
            return (
              <li key={item.to}>
                <NavLink item={item} active={active} />
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User pill */}
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-md">
          <div className="h-8 w-8 rounded-full bg-accent text-canvas flex items-center justify-center text-[12px] font-semibold flex-shrink-0">
            {initials(userEmail)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-ink truncate font-medium">
              {userEmail}
            </div>
            <div className="text-[10px] text-whisper">Owner</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="text-muted hover:text-ink p-1.5 rounded transition-colors hover:bg-sunken"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const disabled = !!item.disabled;

  const className = cn(
    'group relative flex items-center gap-3 rounded-md px-3 py-2 text-[14px]',
    'transition-[background-color,color] duration-150 ease-out-snap',
    active
      ? 'bg-sunken text-ink font-medium'
      : 'text-ink-soft hover:bg-sunken hover:text-ink',
    disabled && 'cursor-default opacity-55 hover:bg-transparent hover:text-ink-soft',
  );

  const inner = (
    <>
      {/* Active indicator — terracotta editorial caret */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-brand transition-[height,opacity] duration-200 ease-out-snap',
          active ? 'h-5 opacity-100' : 'h-0 opacity-0',
        )}
      />
      <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.75} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && (
        <span className="text-[9px] uppercase tracking-wider text-whisper border border-line rounded px-1.5 py-0.5">
          {item.badge}
        </span>
      )}
    </>
  );

  if (disabled) {
    return <div className={className}>{inner}</div>;
  }
  return (
    <Link to={item.to} className={className}>
      {inner}
    </Link>
  );
}

function FullPageLoader({ label }: { label: string }) {
  return (
    <div className="grain min-h-dvh flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 animate-fade-up">
        <div className="h-7 w-7 rounded-full border-2 border-line border-t-brand animate-spin" />
        <div className="text-[13px] text-muted">{label}</div>
      </div>
    </div>
  );
}

/** Returns up to 2 initials from an email's local part. */
function initials(email: string): string {
  const local = email.split('@')[0] ?? '?';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

// Used by routes that want a consistent page header.
export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  action,
}: {
  title: import('react').ReactNode;
  subtitle?: import('react').ReactNode;
  breadcrumb?: string[];
  action?: import('react').ReactNode;
}) {
  return (
    <div className="px-4 sm:px-6 md:px-8 pt-5 md:pt-7 pb-5 md:pb-6 border-b border-line bg-canvas">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1.5 text-[12px] text-muted mb-3">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-whisper" />}
              <span className={i === breadcrumb.length - 1 ? 'text-ink' : ''}>
                {b}
              </span>
            </span>
          ))}
        </nav>
      )}
      <div className="flex items-end justify-between gap-4 md:gap-6 flex-wrap">
        <div className="min-w-0">
          <h1 className="display text-[26px] md:text-[34px] font-medium text-ink leading-none">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 md:mt-2 text-[13px] md:text-[14px] text-muted max-w-[60ch]">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  );
}
