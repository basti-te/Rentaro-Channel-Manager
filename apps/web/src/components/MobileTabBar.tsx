import { Link, useLocation } from '@tanstack/react-router';
import { Calendar, MessageSquare, SprayCan, Menu, type LucideIcon } from 'lucide-react';
import { cn } from '@cm/ui';

interface Tab {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Routes that should also light up this tab when active. */
  matchPaths?: string[];
}

const TABS: Tab[] = [
  { to: '/calendar', label: 'Kalender',   icon: Calendar },
  { to: '/messages', label: 'Nachrichten',icon: MessageSquare },
  { to: '/cleaning', label: 'Reinigung',  icon: SprayCan },
  { to: '/menu',     label: 'Menü',       icon: Menu,
    matchPaths: ['/', '/overview', '/apartments', '/settings'] },
];

/**
 * Bottom tab bar — visible only on mobile. Desktop uses the sidebar in
 * `_dashboard.tsx`. Sits above the safe-area inset on iOS.
 */
export function MobileTabBar() {
  const { pathname } = useLocation();

  return (
    <nav
      className={cn(
        'md:hidden fixed inset-x-0 bottom-0 z-40',
        'bg-surface/95 backdrop-blur-md border-t border-line',
        'flex justify-around',
        // iOS home-bar safe area
        'pb-[max(0px,env(safe-area-inset-bottom))]',
      )}
      style={{ height: 'calc(64px + env(safe-area-inset-bottom, 0px))' }}
    >
      {TABS.map((tab) => {
        const active =
          pathname === tab.to ||
          (tab.matchPaths?.some((p) =>
            p === '/' ? pathname === '/' : pathname.startsWith(p),
          ) ??
            false);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1',
              'transition-colors duration-150',
              'tap-highlight-transparent',
              active ? 'text-brand' : 'text-muted hover:text-ink',
            )}
          >
            <span
              className={cn(
                'relative flex items-center justify-center',
                'h-7 w-12 rounded-full',
                active && 'bg-brand-soft',
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.75} />
            </span>
            <span className={cn('text-[10.5px] leading-none', active && 'font-semibold')}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** px reserved by the tab bar — for padding the main content. */
export const MOBILE_TAB_BAR_H = 64;
