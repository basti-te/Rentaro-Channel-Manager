import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { Brand } from '../components/Brand';

/**
 * Legal notice (Impressum) — German § 5 TMG disclosure. Public route,
 * reachable without authentication (linked from the login screen).
 */
export function ImpressumPage() {
  return (
    <div className="grain min-h-dvh flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-[640px] animate-fade-up">
        <div className="flex justify-center mb-8">
          <Brand size="lg" />
        </div>

        <div className="rounded-xl border border-line bg-surface shadow-lg p-7 sm:p-9">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Zurück zum Login
          </Link>

          <h1 className="display text-[28px] font-medium text-ink mt-4 mb-6">
            Impressum
          </h1>

          <div className="text-[13.5px] text-ink-soft leading-relaxed">
            <p className="font-medium text-ink">Leopards GmbH</p>
            <p>Am Schlangenberg 3</p>
            <p>45136 Essen</p>
          </div>

          <Section title="Handelsregister">
            <p>HRB 32276</p>
            <p>Registergericht: Amtsgericht Essen</p>
          </Section>

          <Section title="Vertreten durch">
            <p>Sebastian Teufel</p>
          </Section>

          <Section title="Kontakt">
            <p>
              Telefon:{' '}
              <a
                href="tel:+4917641880498"
                className="text-brand hover:underline"
              >
                +49 (0) 176 41 880498
              </a>
            </p>
            <p>
              E-Mail:{' '}
              <a
                href="mailto:leopardsgmbh@gmail.com"
                className="text-brand hover:underline"
              >
                leopardsgmbh@gmail.com
              </a>
            </p>
          </Section>

          <Section title="Umsatzsteuer-ID">
            <p>
              Umsatzsteuer-Identifikationsnummer gemäß § 27 a
              Umsatzsteuergesetz: DE343901469
            </p>
          </Section>

          <Section title="EU-Streitschlichtung">
            <p>
              Die Europäische Kommission stellt eine Plattform zur
              Online-Streitbeilegung (OS) bereit:{' '}
              <a
                href="https://ec.europa.eu/consumers/odr/"
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand hover:underline"
              >
                https://ec.europa.eu/consumers/odr/
              </a>
              .
            </p>
            <p>Unsere E-Mail-Adresse finden Sie oben im Impressum.</p>
          </Section>

          <Section title="Verbraucherstreitbeilegung/Universalschlichtungsstelle">
            <p>
              Wir sind nicht bereit oder verpflichtet, an
              Streitbeilegungsverfahren vor einer
              Verbraucherschlichtungsstelle teilzunehmen.
            </p>
          </Section>
        </div>

        <p className="mt-8 text-center text-[12px] text-whisper">
          Rentaro — Leopards GmbH
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 pt-5 border-t border-line/70">
      <h2 className="display text-[15px] font-medium text-ink mb-1.5">
        {title}
      </h2>
      <div className="text-[13.5px] text-ink-soft leading-relaxed space-y-1">
        {children}
      </div>
    </div>
  );
}
