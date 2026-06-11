import { Link, useNavigate } from '@tanstack/react-router';
import {
  Building2,
  LayoutGrid,
  LogOut,
  Plug,
  Share2,
  Sparkles,
  Settings,
  Star,
  Users,
  Bell,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@cm/ui';

import { Brand } from '../components/Brand';
import { PageHeader } from './_dashboard';
import { Card } from '../components/ui/Card';
import { useAuth } from '../lib/auth';
import { trpc } from '../lib/trpc';

interface MenuLink {
  to: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  badge?: string;
  disabled?: boolean;
}

const LINKS: MenuLink[] = [
  { to: '/overview',   label: 'Übersicht',    icon: LayoutGrid, description: 'Stats und Schnellzugriffe' },
  { to: '/apartments', label: 'Apartments',   icon: Building2,  description: 'Inventar verwalten, Gruppen, Mapping' },
  { to: '/channels',   label: 'Kanäle',       icon: Plug,       description: 'Airbnb / Booking.com Listings verbinden' },
  { to: '/listing-links', label: 'Listing-Links', icon: Share2, description: 'Airbnb-/Booking-Links kopieren & teilen' },
  { to: '/reviews',    label: 'Bewertungen',  icon: Star,       description: 'Auto-Review-Vorlagen nach Checkout' },
  { to: '/teammates',  label: 'Teammates',    icon: Users,      description: 'Cleaner / interne SMS-Empfänger' },
  { to: '/ki-gastnachrichten', label: 'KI-Gastnachrichten', icon: Sparkles, description: 'KI-Antworten an Gäste + Apartment-Wissen' },
  { to: '/notifications', label: 'Benachrichtigungen', icon: Bell, description: 'E-Mail-Alerts bei Buchungen & Fehlern' },
  { to: '/settings',   label: 'Einstellungen',icon: Settings,   description: 'Account, Abo, Preis-Quelle, SMS' },
];

export function MenuPage() {
  const auth = useAuth();
  const nav = useNavigate();
  const meQ = trpc.me.current.useQuery();
  const tenant = meQ.data?.memberships[0];

  return (
    <>
      <PageHeader title="Menü" subtitle="Workspace, Inventar und Einstellungen." />
      <div className="px-4 sm:px-6 md:px-8 py-6 max-w-3xl space-y-4">
        {/* Workspace card */}
        <Card>
          <div className="px-5 py-4 flex items-center gap-3">
            <Brand size="sm" showText={false} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest text-whisper">
                Workspace
              </div>
              <div className="text-[14px] font-medium text-ink truncate">
                {tenant?.tenantName ?? 'Workspace'}
              </div>
              <div className="text-[11.5px] text-muted truncate">
                {auth.user?.email}
              </div>
            </div>
          </div>
        </Card>

        {/* Navigation list */}
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {LINKS.map((l) => (
              <li key={l.to}>
                {l.disabled ? (
                  <Row link={l} />
                ) : (
                  <Link to={l.to} className="block">
                    <Row link={l} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {/* Sign out */}
        <Card className="overflow-hidden">
          <button
            type="button"
            className={cn(
              'w-full flex items-center gap-3 px-4 py-4',
              'text-[14px] font-medium text-danger',
              'hover:bg-danger-soft/40 transition-colors',
            )}
            onClick={async () => {
              await auth.signOut();
              nav({ to: '/login' });
            }}
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
            <span className="flex-1 text-left">Abmelden</span>
          </button>
        </Card>
      </div>
    </>
  );
}

function Row({ link }: { link: MenuLink }) {
  const Icon = link.icon;
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3.5',
        link.disabled
          ? 'opacity-60 cursor-default'
          : 'cursor-pointer hover:bg-sunken/50 transition-colors',
      )}
    >
      <Icon className="h-[18px] w-[18px] flex-shrink-0 text-ink-soft" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-ink truncate">{link.label}</span>
          {link.badge && (
            <span className="text-[9px] uppercase tracking-wider text-whisper border border-line rounded px-1.5 py-0.5">
              {link.badge}
            </span>
          )}
        </div>
        {link.description && (
          <div className="text-[11.5px] text-muted truncate mt-0.5">
            {link.description}
          </div>
        )}
      </div>
      {!link.disabled && (
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-whisper" strokeWidth={1.75} />
      )}
    </div>
  );
}
