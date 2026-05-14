import { MessageSquare } from 'lucide-react';
import { PageHeader } from './_dashboard';
import { Card, CardBody } from '../components/ui/Card';

export function MessagesPage() {
  return (
    <>
      <PageHeader
        title="Nachrichten"
        subtitle="Gast-Inbox: Airbnb, Booking.com und SMS in einem Verlauf."
      />
      <div className="px-4 sm:px-6 md:px-8 py-7 max-w-3xl">
        <Card className="p-10 text-center">
          <div className="mx-auto h-12 w-12 rounded-md bg-brand-soft text-brand flex items-center justify-center mb-4">
            <MessageSquare className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <h3 className="display text-[20px] font-medium text-ink">
            Bald verfügbar
          </h3>
          <p className="mt-2 text-[13px] text-muted leading-relaxed max-w-[46ch] mx-auto">
            Dieses Modul kommt in Phase 8. Es bündelt Plattform-Nachrichten
            (via Channex Inbox) und SMS (via Twilio) in einem Verlauf pro
            Buchung, mit Auto-Nachrichten zu bestimmten Uhrzeiten.
          </p>
        </Card>
      </div>
    </>
  );
}
