import { SprayCan } from 'lucide-react';
import { PageHeader } from './_dashboard';
import { Card, CardBody } from '../components/ui/Card';

export function CleaningPage() {
  return (
    <>
      <PageHeader
        title="Reinigung"
        subtitle="Reinigungspläne zwischen Check-outs und Check-ins. Cleaner zuweisen, Status verfolgen."
      />
      <div className="px-4 sm:px-6 md:px-8 py-7 max-w-3xl space-y-4">
        <Card className="p-10 text-center">
          <div className="mx-auto h-12 w-12 rounded-md bg-brand-soft text-brand flex items-center justify-center mb-4">
            <SprayCan className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h3 className="display text-[20px] font-medium text-ink">
            Bald verfügbar
          </h3>
          <p className="mt-2 text-[13px] text-muted leading-relaxed max-w-[50ch] mx-auto">
            Dieses Modul automatisiert die Reinigungsplanung: Aus jedem
            Check-out + folgendem Check-in entsteht ein Reinigungs-Slot mit
            Datum und Zeitfenster. Du weist Cleaner per Drag-and-Drop zu, sie
            bekommen Push/SMS und melden den Status zurück.
          </p>
        </Card>

        <Card>
          <CardBody>
            <div className="text-[11px] uppercase tracking-widest text-whisper mb-3">
              Geplant
            </div>
            <ul className="space-y-2 text-[13.5px] text-ink-soft leading-relaxed">
              <li>• Auto-Slots zwischen Buchungen mit Check-out- und Check-in-Zeiten</li>
              <li>• Cleaner-Profile + Verfügbarkeit + Stundensatz</li>
              <li>• Status: geplant / im Gange / fertig / Problem gemeldet</li>
              <li>• Mängel-Foto-Upload mit Notizen</li>
              <li>• Optional: Auto-Zuweisung nach Apartment-Gruppe und Cleaner-Präferenzen</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
