/**
 * Public marketing landing page. Lives at `/` for logged-out visitors.
 * Logged-in users get redirected to /calendar by the LandingPage itself
 * (so a bookmark to `rentaro.cloud` keeps working as an app entry point).
 *
 * Editorial Workshop look — Fraunces display, terracotta accent,
 * paper-warm canvas. No generic SaaS gradients. Photography does the
 * emotional work; copy stays confident and short.
 *
 * Image assets live in apps/web/public/landing/ and are referenced as
 *   /landing/hero.jpg   /landing/guests.jpg   /landing/operator.jpg
 *   /landing/channels.jpg   /landing/key.jpg
 */
import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  BarChart3,
  Building2,
  Calendar as CalendarIcon,
  Check,
  Coins,
  Cog,
  Globe2,
  MessageSquare,
  Receipt,
  ShieldCheck,
  Sparkles,
  SprayCan,
  Star,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@cm/ui';

import { Brand } from '../components/Brand';
import { Button } from '../components/ui/Button';
import { Gauge, Sparkline, ComboChart, CHART_COLORS, type ComboPoint } from '../components/charts';
import { useAuth } from '../lib/auth';

export function LandingPage() {
  const auth = useAuth();
  const nav = useNavigate();

  // Bookmark to rentaro.cloud keeps working as an app entry for signed-in users
  useEffect(() => {
    if (auth.user) void nav({ to: '/calendar' });
  }, [auth.user, nav]);

  return (
    <div className="min-h-dvh bg-canvas grain text-ink antialiased">
      <SiteNav />
      <Hero />
      <TrustStrip />
      <WhyRentaro />
      <StatistikShowcase />
      <Features />
      <ComingSoon />
      <Pricing />
      <FinalCta />
      <Footer />
    </div>
  );
}

// ─── Top navigation ─────────────────────────────────────────────────────────

function SiteNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 py-3.5 flex items-center justify-between">
        <Brand />
        <nav className="flex items-center gap-1 sm:gap-3">
          <a
            href="#funktionen"
            className="hidden sm:inline-flex px-3 py-2 text-[13px] text-ink-soft hover:text-ink"
          >
            Funktionen
          </a>
          <a
            href="#preise"
            className="hidden sm:inline-flex px-3 py-2 text-[13px] text-ink-soft hover:text-ink"
          >
            Preise
          </a>
          <Link
            to="/login"
            className="px-3 py-2 text-[13px] text-ink-soft hover:text-ink"
          >
            Anmelden
          </Link>
          <Link to="/login">
            <Button variant="brand" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
              Kostenlos testen
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Layered radial tints — paper-warm, no flat gradients */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(80% 60% at 18% 18%, rgb(250 231 221 / 0.55), transparent 60%), ' +
            'radial-gradient(60% 50% at 90% 10%, rgb(244 215 197 / 0.35), transparent 65%)',
        }}
      />
      <div className="mx-auto max-w-6xl px-6 lg:px-10 pt-16 sm:pt-24 pb-16 sm:pb-24 grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[11.5px] uppercase tracking-[0.15em] text-ink-soft">
            <Sparkles className="h-3 w-3 text-brand" strokeWidth={2.5} />
            Channel Manager · Made in Germany
          </span>
          <h1 className="display mt-5 text-[44px] sm:text-[56px] lg:text-[64px] leading-[1.04] tracking-[-0.025em] text-ink">
            Vermieten,<br />
            <span className="text-brand">ohne Tool-Stress.</span>
          </h1>
          <p className="mt-5 text-[16px] sm:text-[17px] leading-[1.7] text-ink-soft max-w-prose">
            Rentaro hält Booking.com, Airbnb &amp; Vrbo in einem einzigen Kalender
            synchron, verschickt Gast-Nachrichten automatisch, sagt der Putzkraft
            per&nbsp;SMS Bescheid — und zeigt dir auf einen Blick, was deine
            Wohnungen verdienen. Schlank gebaut, fair bepreist — für Vermieter,
            nicht für Hotels.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/login">
              <Button
                variant="brand"
                size="lg"
                iconRight={<ArrowRight className="h-4 w-4" />}
              >
                14 Tage kostenlos starten
              </Button>
            </Link>
            <a
              href="#funktionen"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-[14px] text-ink-soft hover:text-ink"
            >
              Funktionen ansehen
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="mt-5 flex items-center gap-3 text-[12.5px] text-muted">
            <Check className="h-3.5 w-3.5 text-positive" strokeWidth={2.5} />
            Keine Kreditkarte nötig · Cancellation jederzeit · DSGVO-konform
          </div>
        </div>

        {/* Editorial photo block */}
        <div className="relative">
          <div className="aspect-[4/5] relative rounded-2xl overflow-hidden ring-1 ring-line shadow-lg">
            <img
              src="/landing/guests.jpg"
              alt="Gäste kommen in einer Ferienwohnung an"
              className="absolute inset-0 h-full w-full object-cover"
              loading="eager"
            />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, transparent 50%, rgb(42 38 34 / 0.18) 100%)',
              }}
            />
          </div>
          {/* Floating editorial caption — inset on mobile, peeking out on sm+ */}
          <div className="absolute bottom-4 left-4 sm:-bottom-6 sm:-left-6 max-w-[240px] sm:max-w-[260px] rounded-xl bg-surface border border-line shadow-md p-3.5 sm:p-4">
            <div className="text-[11px] uppercase tracking-[0.14em] text-brand font-medium">
              Live im Kalender
            </div>
            <div className="mt-1 text-[13px] sm:text-[13.5px] text-ink leading-snug">
              "Neue Buchung von Airbnb · Apartment 3 · 14.–17. Juni"
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
              vor 12 Sekunden synchronisiert
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Trust strip (channels) ─────────────────────────────────────────────────

function TrustStrip() {
  return (
    <section className="border-y border-line/70 bg-sunken/30">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 py-6 flex items-center justify-center gap-4 sm:gap-10 flex-wrap text-ink-soft">
        <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
          Synchron mit
        </span>
        <span className="display text-[16px] text-ink/70">Booking.com</span>
        <span className="text-line-strong">·</span>
        <span className="display text-[16px] text-ink/70">Airbnb</span>
        <span className="text-line-strong">·</span>
        <span className="display text-[16px] text-ink/70">Vrbo</span>
        <span className="text-line-strong">·</span>
        <span className="display text-[16px] text-ink/70">Expedia</span>
        <span className="text-line-strong hidden sm:inline">·</span>
        <span className="display text-[16px] text-ink/70 hidden sm:inline">+ 30 weitere</span>
      </div>
    </section>
  );
}

// ─── Why Rentaro ────────────────────────────────────────────────────────────

function WhyRentaro() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-20 items-center">
        <div className="order-2 lg:order-1 relative">
          <div className="aspect-[5/4] rounded-2xl overflow-hidden ring-1 ring-line shadow-md">
            <img
              src="/landing/operator.jpg"
              alt="Vermieter verwaltet Apartments remote"
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="absolute -top-5 -right-5 rounded-lg bg-brand text-white px-4 py-3 shadow-md max-w-[200px]">
            <div className="display text-[28px] leading-none">3 Min</div>
            <div className="mt-1 text-[11.5px] opacity-90 leading-snug">
              vom Sign-up bis zur ersten verbundenen Buchungsplattform
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <div className="text-[11.5px] uppercase tracking-[0.18em] text-brand font-medium">
            Warum Rentaro
          </div>
          <h2 className="display mt-3 text-[34px] sm:text-[42px] leading-[1.08] tracking-[-0.02em] text-ink">
            Channel Manager, der dir <em>nicht</em> im Weg steht.
          </h2>
          <p className="mt-5 text-[15.5px] leading-[1.7] text-ink-soft max-w-prose">
            Andere Plattformen wollen Hotelketten zufriedenstellen. Wir wurden
            für Vermieter mit 1 bis 50 Ferienwohnungen gebaut. Schlanke
            Funktionalität, klare Sprache, faire Preise.
          </p>

          <ul className="mt-8 space-y-4 text-[14.5px]">
            <BulletPoint
              icon={CalendarIcon}
              title="Ein Kalender für alle Plattformen"
              text="Jede Buchung von Booking.com, Airbnb, Vrbo &amp; Co. landet live im selben Kalender."
            />
            <BulletPoint
              icon={MessageSquare}
              title="Automatische Gastnachrichten"
              text="Welcome-Mails, Check-in-Anweisungen, Bewertungsbitten — schaltet sich nach Buchung selbst."
            />
            <BulletPoint
              icon={SprayCan}
              title="Putz- und Hausmeister-Workflows"
              text="Per SMS Bescheid geben, wenn Check-out durch ist. Mehrere Teammates pro Apartment."
            />
            <BulletPoint
              icon={TrendingUp}
              title="Dynamische Preisgestaltung"
              text="PriceLabs-Anbindung optional — wir pushen die Restriktionen, PriceLabs den Preis."
            />
          </ul>
        </div>
      </div>
    </section>
  );
}

function BulletPoint({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <li className="flex items-start gap-4">
      <span className="flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-brand-soft text-brand">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <div>
        <div className="font-medium text-ink leading-snug">{title}</div>
        <div className="mt-0.5 text-[13.5px] text-ink-soft leading-relaxed">{text}</div>
      </div>
    </li>
  );
}

// ─── Statistik showcase (built from the real chart components) ──────────────

function StatistikShowcase() {
  const points = useMemo<ComboPoint[]>(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const rev = 540 + 430 * (Math.sin(i / 3.2) * 0.5 + 0.5) + 110 * Math.sin(i / 1.4);
        const occ = 55 + 42 * (Math.sin(i / 3.2 + 0.7) * 0.5 + 0.5);
        return {
          label: `${i + 1}`,
          full: `Tag ${i + 1}`,
          revenueCents: Math.round(rev) * 100,
          occPct: Math.min(100, Math.round(occ)),
        };
      }),
    [],
  );
  const money = (c: number) => `€${Math.round(c / 100).toLocaleString('de-DE')}`;
  const moneyAxis = (c: number) => {
    const v = c / 100;
    return v >= 1000 ? `€${(v / 1000).toFixed(1)}k` : `€${Math.round(v)}`;
  };
  const revSpark = points.map((p) => p.revenueCents);
  const occSpark = points.map((p) => p.occPct);
  const adrSpark = points.map((_, i) => 56 + Math.round(8 * Math.sin(i / 2.5)));
  const bookSpark = points.map((_, i) => 2 + Math.round(2 * (Math.sin(i / 2) * 0.5 + 0.5)));

  return (
    <section className="py-20 sm:py-28 bg-surface border-y border-line/70">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="max-w-2xl">
          <div className="text-[11.5px] uppercase tracking-[0.18em] text-brand font-medium">
            Neu · Statistik
          </div>
          <h2 className="display mt-3 text-[34px] sm:text-[42px] leading-[1.08] tracking-[-0.02em] text-ink">
            Sieh auf einen Blick, was deine Wohnungen verdienen.
          </h2>
          <p className="mt-5 text-[15.5px] leading-[1.7] text-ink-soft">
            Umsatz, Auslastung, ADR, RevPAR, Stornoquote und der Kanal-Mix — über
            jeden Zeitraum, mit Vergleich zur Vorperiode. Netto und pro
            Übernachtung verbucht, damit die Zahlen stimmen.
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-line bg-canvas p-2.5 shadow-lg ring-1 ring-line/50">
          <div className="flex items-center gap-1.5 px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <span className="ml-3 text-[11px] text-muted">rentaro.cloud/statistik</span>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-lg border border-line bg-canvas p-4">
                <div className="text-[12px] font-semibold text-ink">Umsatz &amp; Auslastung</div>
                <div className="mt-1">
                  <ComboChart points={points} money={money} moneyAxis={moneyAxis} />
                </div>
              </div>
              <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-canvas p-4">
                <Gauge pct={87} />
                <p className="mt-1 text-center text-[11px] text-whisper">
                  Auslastung · letzte 30 Tage
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label="Umsatz (netto)" value="28.705 €" spark={revSpark} />
              <MiniStat label="Auslastung" value="87 %" spark={occSpark} color={CHART_COLORS.positive} />
              <MiniStat label="ADR" value="60 €" spark={adrSpark} />
              <MiniStat label="Buchungen" value="98" spark={bookSpark} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniStat({
  label,
  value,
  spark,
  color = CHART_COLORS.brand,
}: {
  label: string;
  value: string;
  spark: number[];
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="num mt-1 text-[18px] leading-none text-ink">{value}</div>
      <div className="mt-1.5">
        <Sparkline values={spark} color={color} height={28} />
      </div>
    </div>
  );
}

// ─── Features grid ──────────────────────────────────────────────────────────

function Features() {
  return (
    <section id="funktionen" className="py-20 sm:py-28 bg-surface border-y border-line/70">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="max-w-2xl">
          <div className="text-[11.5px] uppercase tracking-[0.18em] text-brand font-medium">
            Was schon drin ist
          </div>
          <h2 className="display mt-3 text-[34px] sm:text-[42px] leading-[1.08] tracking-[-0.02em] text-ink">
            Vom Kalender bis zur Auswertung.
          </h2>
          <p className="mt-5 text-[15.5px] leading-[1.7] text-ink-soft">
            Keine Sektion ist halbgar. Wir haben uns für weniger Features mit
            sauberer Umsetzung entschieden statt 50 mittelmäßiger Module.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <FeatureCard
            icon={Globe2}
            title="Channel-Sync"
            text="Booking.com, Airbnb, Vrbo, Expedia &amp; 30+ — ein Quellzustand, sekundengenau verteilt: Verfügbarkeit, Preise, Restriktionen."
          />
          <FeatureCard
            icon={MessageSquare}
            title="Auto-Gastnachrichten"
            text="Vorlagen pro Apartment &amp; Kanal mit Variablen. Trigger relativ zu Reservierung, Check-in/-out — von „sofort bei Buchung&ldquo; bis „1 Tag vorher&ldquo;. Pro Buchung siehst du, was geplant/gesendet ist — mit Vorschau und „Jetzt senden&ldquo;."
          />
          <FeatureCard
            icon={BarChart3}
            title="Statistik &amp; Auswertungen"
            text="Umsatz, Auslastung, ADR, RevPAR, Stornoquote, Kanal-Mix und Top-Apartments — über jeden Zeitraum, mit Vorperioden-Vergleich."
          />
          <FeatureCard
            icon={SprayCan}
            title="Putz- &amp; Team-Workflows"
            text="Reinigungs-Reminder per SMS, pro Lauf gebündelt (eine SMS je Kraft). Mehrere Teammates pro Apartment. Teilbarer Reinigungs-Kalender-Link fürs Handy der Putzkraft."
          />
          <FeatureCard
            icon={Coins}
            title="Faire SMS-Abrechnung"
            text="SMS pro Land freischalten, Endkundenpreis transparent je Segment. Nicht freigeschaltete Länder werden sauber übersprungen — keine Überraschungskosten."
          />
          <FeatureCard
            icon={Star}
            title="Bewertungs-Automatik"
            text="Automatische Bewertungs-Anfrage nach dem Check-out — pro Buchung abschaltbar für schwierige Gäste."
          />
          <FeatureCard
            icon={TrendingUp}
            title="PriceLabs-Anbindung"
            text="Wenn du PriceLabs nutzt: wir ziehen uns aus dem Preis-Push zurück und überlassen es deren Algorithmus. Restriktionen bleiben PMS-driven."
          />
          <FeatureCard
            icon={Building2}
            title="Multi-Apartment &amp; Listing-Links"
            text="1–50 Wohnungen, nach Gebäuden/Gruppen sortiert, Drag-and-drop. Pro Wohnung eigene Defaults &amp; Währung — plus Airbnb-/Booking-Links zum schnellen Teilen per WhatsApp."
          />
          <FeatureCard
            icon={ShieldCheck}
            title="DSGVO &amp; Made in EU"
            text="Server in der EU. Datenschutz und Impressum eingebaut. Open-Source-Stack ohne dunkle Vendor-Locks."
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div
      className={cn(
        'group rounded-xl border border-line bg-canvas p-6',
        'transition-[transform,box-shadow,border-color] duration-150 ease-out-snap',
        'hover:-translate-y-[2px] hover:shadow-md hover:border-line-strong',
      )}
    >
      <span className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-brand-soft text-brand">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <h3 className="display mt-4 text-[19px] font-medium text-ink leading-snug">
        {title}
      </h3>
      <p
        className="mt-2 text-[13.5px] text-ink-soft leading-relaxed"
        dangerouslySetInnerHTML={{ __html: text }}
      />
    </div>
  );
}

// ─── Coming soon ────────────────────────────────────────────────────────────

function ComingSoon() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-12 items-start">
          <div className="lg:sticky lg:top-28">
            <div className="text-[11.5px] uppercase tracking-[0.18em] text-brand font-medium">
              Bald an Bord
            </div>
            <h2 className="display mt-3 text-[34px] sm:text-[42px] leading-[1.08] tracking-[-0.02em] text-ink">
              KI, die wirklich für dich arbeitet.
            </h2>
            <p className="mt-5 text-[15.5px] leading-[1.7] text-ink-soft">
              Wir bauen Funktionen, die deinen Arbeitstag verkürzen — nicht
              welche, die in Demos hübsch aussehen.
            </p>
            <div className="mt-7 relative rounded-2xl overflow-hidden ring-1 ring-line shadow-sm aspect-[4/3]">
              <img
                src="/landing/channels.jpg"
                alt="Buchungs-Plattformen auf einem Smartphone"
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          </div>

          <div className="space-y-4">
            <RoadmapItem
              icon={MessageSquare}
              eta="In Arbeit"
              title="KI-Chatbot für Gast-Anfragen"
              text="Beantwortet typische Gastfragen automatisch — WLAN-Passwort, Anreise-Infos, Tipps in der Nähe. Lernt aus deinen Apartment-Profilen. Du wirst nur gepingt wenn's wirklich nötig ist."
            />
            <RoadmapItem
              icon={Users}
              eta="In Arbeit"
              title="KI-Manager für dein Team"
              text="Koordiniert Putzkräfte und Hausmeister automatisch. Erkennt überlappende Aufgaben, sendet SMS, eskaliert nur bei echten Konflikten."
            />
            <RoadmapItem
              icon={Receipt}
              eta="Q3 2026"
              title="Automatische Rechnungserstellung"
              text="Rechnungen pro Buchung, mit deinem Layout, sofort versandbereit. Verbindung zu DATEV / lexoffice / SevDesk."
            />
            <RoadmapItem
              icon={Cog}
              eta="laufend"
              title="Was DU willst"
              text="Wir bauen mit unseren ersten 50 Kunden direkt am Telefon. Was am wichtigsten ist, kommt zuerst."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function RoadmapItem({
  icon: Icon,
  eta,
  title,
  text,
}: {
  icon: LucideIcon;
  eta: string;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-sunken text-ink-soft">
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="display text-[19px] font-medium text-ink leading-snug">{title}</h3>
            <span className="inline-block text-[11px] uppercase tracking-[0.14em] text-brand font-medium border border-brand/30 bg-brand-soft px-1.5 py-0.5 rounded">
              {eta}
            </span>
          </div>
          <p className="mt-2 text-[13.5px] text-ink-soft leading-relaxed">{text}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Pricing ────────────────────────────────────────────────────────────────

function Pricing() {
  return (
    <section id="preise" className="py-20 sm:py-28 bg-surface border-y border-line/70">
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-[11.5px] uppercase tracking-[0.18em] text-brand font-medium">
            Pricing
          </div>
          <h2 className="display mt-3 text-[34px] sm:text-[42px] leading-[1.08] tracking-[-0.02em] text-ink">
            Fair, transparent, einfach zu rechnen.
          </h2>
          <p className="mt-5 text-[15.5px] leading-[1.7] text-ink-soft">
            Eine Basis-Gebühr plus ein kleiner Betrag pro Apartment. Keine
            versteckten Provisionen, keine Pro-Buchung-Anteile. SMS sind ein
            optionales Add-on, fair pro Segment abgerechnet. Jährlich zahlen
            spart 10 %.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6 max-w-4xl mx-auto">
          <PricingCard
            label="Monatlich"
            note="Flexibel — jederzeit kündbar"
            basePrice="29 €"
            perPropertyPrice="4 €"
            highlight={false}
          />
          <PricingCard
            label="Jährlich"
            note="−10 % Rabatt aufs Jahr"
            basePrice="26 €"
            perPropertyPrice="3,60 €"
            highlight
          />
        </div>

        <div className="mt-10 max-w-2xl mx-auto rounded-xl border border-line bg-canvas p-6 text-center">
          <div className="display text-[20px] text-ink">
            14 Tage kostenlos testen — keine Kreditkarte nötig.
          </div>
          <p className="mt-2 text-[13.5px] text-ink-soft leading-relaxed">
            Probiere alle Funktionen für 14 Tage in Ruhe aus. Erst danach
            wählst du, ob du monatlich oder jährlich zahlen willst.
          </p>
          <div className="mt-5">
            <Link to="/login">
              <Button variant="brand" size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
                Jetzt loslegen
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingCard({
  label,
  note,
  basePrice,
  perPropertyPrice,
  highlight,
}: {
  label: string;
  note: string;
  basePrice: string;
  perPropertyPrice: string;
  highlight: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-6 sm:p-7 transition-[transform,box-shadow] duration-200',
        highlight
          ? 'border-brand/40 bg-brand-soft/40 shadow-md ring-1 ring-brand/20'
          : 'border-line bg-canvas',
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] uppercase tracking-[0.18em] text-brand font-medium">
          {label}
        </span>
        {highlight && (
          <span className="inline-flex items-center gap-1 bg-brand text-white text-[10.5px] uppercase tracking-[0.14em] font-semibold px-2 py-0.5 rounded-full">
            Beliebt
          </span>
        )}
      </div>

      <div className="mt-5 flex items-baseline gap-2">
        <span className="display num text-[44px] font-medium text-ink leading-none">
          {basePrice}
        </span>
        <span className="text-[13.5px] text-ink-soft">/ Monat Basis</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="display num text-[22px] font-medium text-ink leading-none">
          + {perPropertyPrice}
        </span>
        <span className="text-[13.5px] text-ink-soft">pro Apartment / Monat</span>
      </div>

      <div className="mt-3 text-[12.5px] text-muted">{note}</div>

      <ul className="mt-6 space-y-2.5 text-[13.5px] text-ink">
        <PriceFeature>Channel-Sync alle Plattformen</PriceFeature>
        <PriceFeature>Auto-Gastnachrichten &amp; Bewertungen</PriceFeature>
        <PriceFeature>Statistik &amp; Auswertungen</PriceFeature>
        <PriceFeature>Putz- &amp; Team-Workflows</PriceFeature>
        <PriceFeature>PriceLabs-Anbindung</PriceFeature>
        <PriceFeature>Unbegrenzte Buchungen</PriceFeature>
        <PriceFeature>Support per E-Mail</PriceFeature>
      </ul>
    </div>
  );
}

function PriceFeature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="h-4 w-4 mt-0.5 text-positive flex-shrink-0" strokeWidth={2.5} />
      <span>{children}</span>
    </li>
  );
}

// ─── Final CTA ──────────────────────────────────────────────────────────────

function FinalCta() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-6 lg:px-10">
        <div className="relative overflow-hidden rounded-2xl ring-1 ring-line shadow-md">
          <img
            src="/landing/key.jpg"
            alt="Hausschlüssel im Schloss"
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(105deg, rgb(42 38 34 / 0.75) 0%, rgb(42 38 34 / 0.55) 45%, rgb(42 38 34 / 0.15) 100%)',
            }}
          />
          <div className="relative px-8 sm:px-14 py-16 sm:py-20 max-w-xl text-white">
            <h2 className="display text-[34px] sm:text-[44px] leading-[1.08] tracking-[-0.02em]">
              Bereit für sauberes
              <br />
              Vermieten?
            </h2>
            <p className="mt-4 text-[15px] leading-[1.7] text-white/85">
              14 Tage gratis. Volle Funktionalität. Keine Kreditkarte.
              In drei Minuten ist deine erste Wohnung verbunden.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/login">
                <Button variant="brand" size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
                  Kostenlos starten
                </Button>
              </Link>
              <a
                href="#preise"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-[14px] text-white/85 hover:text-white"
              >
                Preise nochmal ansehen
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-line bg-sunken/30">
      <div className="mx-auto max-w-6xl px-6 lg:px-10 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
          <div>
            <Brand />
            <p className="mt-4 text-[13px] text-ink-soft leading-relaxed max-w-xs">
              Channel Manager für Ferienwohnungen — schlank, fair, in Deutsch.
              Gebaut von Vermietern, für Vermieter.
            </p>
          </div>
          <div>
            <div className="text-[11.5px] uppercase tracking-[0.18em] text-muted font-medium">
              Produkt
            </div>
            <ul className="mt-3 space-y-2 text-[13.5px]">
              <li>
                <a href="#funktionen" className="text-ink-soft hover:text-ink">
                  Funktionen
                </a>
              </li>
              <li>
                <a href="#preise" className="text-ink-soft hover:text-ink">
                  Preise
                </a>
              </li>
              <li>
                <Link to="/login" className="text-ink-soft hover:text-ink">
                  Anmelden
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-[11.5px] uppercase tracking-[0.18em] text-muted font-medium">
              Rechtliches
            </div>
            <ul className="mt-3 space-y-2 text-[13.5px]">
              <li>
                <Link to="/impressum" className="text-ink-soft hover:text-ink">
                  Impressum
                </Link>
              </li>
              <li>
                <Link to="/datenschutz" className="text-ink-soft hover:text-ink">
                  Datenschutz
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-line/70 text-[12px] text-muted">
          © {new Date().getFullYear()} Leopards GmbH · Alle Rechte vorbehalten.
        </div>
      </div>
    </footer>
  );
}
