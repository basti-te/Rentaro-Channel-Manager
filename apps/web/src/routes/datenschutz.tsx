import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { Brand } from '../components/Brand';

/**
 * Privacy policy (Datenschutzerklärung) — DSGVO disclosure. Public route,
 * reachable without authentication (linked from the login screen).
 *
 * Standard German boilerplate for sections 1/3/4; the hosting + service
 * sections reflect the actual stack (Vercel, Railway, Supabase, Stripe,
 * Twilio, Channex, Inngest). Provider addresses/links should be verified
 * before relying on this in production.
 */
export function DatenschutzPage() {
  return (
    <div className="grain min-h-dvh flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-[680px] animate-fade-up">
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

          <h1 className="display text-[28px] font-medium text-ink mt-4 mb-1">
            Datenschutzerklärung
          </h1>
          <p className="text-[12px] text-whisper mb-2">Stand: Mai 2026</p>

          {/* 1 ───────────────────────────────────────────────────────── */}
          <H2>1. Datenschutz auf einen Blick</H2>

          <H3>Allgemeine Hinweise</H3>
          <P>
            Die folgenden Hinweise geben einen einfachen Überblick darüber,
            was mit Ihren personenbezogenen Daten passiert, wenn Sie diese
            Website besuchen. Personenbezogene Daten sind alle Daten, mit
            denen Sie persönlich identifiziert werden können. Ausführliche
            Informationen zum Thema Datenschutz entnehmen Sie unserer unter
            diesem Text aufgeführten Datenschutzerklärung.
          </P>

          <H3>Datenerfassung auf dieser Website</H3>
          <P>
            <b>Wer ist verantwortlich für die Datenerfassung auf dieser
            Website?</b> Die Datenverarbeitung auf dieser Website erfolgt
            durch den Websitebetreiber. Dessen Kontaktdaten können Sie dem
            Abschnitt „Hinweis zur verantwortlichen Stelle" in dieser
            Datenschutzerklärung entnehmen.
          </P>
          <P>
            <b>Wie erfassen wir Ihre Daten?</b> Ihre Daten werden zum einen
            dadurch erhoben, dass Sie uns diese mitteilen. Hierbei kann es
            sich z. B. um Daten handeln, die Sie bei der Registrierung oder
            in eine Anfrage eingeben. Andere Daten werden automatisch oder
            nach Ihrer Einwilligung beim Besuch der Website durch unsere
            IT-Systeme erfasst. Das sind vor allem technische Daten (z. B.
            Internetbrowser, Betriebssystem oder Uhrzeit des Seitenaufrufs).
            Die Erfassung dieser Daten erfolgt automatisch, sobald Sie diese
            Website betreten.
          </P>
          <P>
            <b>Wofür nutzen wir Ihre Daten?</b> Ein Teil der Daten wird
            erhoben, um eine fehlerfreie Bereitstellung der Website zu
            gewährleisten. Andere Daten werden zur Erbringung der von Ihnen
            in Anspruch genommenen Dienste (Verwaltung von Unterkünften,
            Buchungen, Nachrichten) verarbeitet.
          </P>
          <P>
            <b>Welche Rechte haben Sie bezüglich Ihrer Daten?</b> Sie haben
            jederzeit das Recht, unentgeltlich Auskunft über Herkunft,
            Empfänger und Zweck Ihrer gespeicherten personenbezogenen Daten
            zu erhalten. Sie haben außerdem ein Recht, die Berichtigung oder
            Löschung dieser Daten zu verlangen. Wenn Sie eine Einwilligung
            zur Datenverarbeitung erteilt haben, können Sie diese
            Einwilligung jederzeit für die Zukunft widerrufen. Außerdem haben
            Sie das Recht, unter bestimmten Umständen die Einschränkung der
            Verarbeitung Ihrer personenbezogenen Daten zu verlangen. Des
            Weiteren steht Ihnen ein Beschwerderecht bei der zuständigen
            Aufsichtsbehörde zu.
          </P>

          {/* 2 ───────────────────────────────────────────────────────── */}
          <H2>2. Hosting</H2>
          <P>
            Wir hosten die Inhalte unserer Website und die zugehörige
            Anwendung bei den nachfolgend genannten Anbietern. Das externe
            Hosting erfolgt zum Zwecke der Vertragserfüllung gegenüber
            unseren potenziellen und bestehenden Kunden (Art. 6 Abs. 1 lit. b
            DSGVO) und im Interesse einer sicheren, schnellen und effizienten
            Bereitstellung unseres Online-Angebots durch professionelle
            Anbieter (Art. 6 Abs. 1 lit. f DSGVO). Mit den eingesetzten
            Anbietern haben wir, soweit erforderlich, Verträge über
            Auftragsverarbeitung (AVV) geschlossen. Unsere Hoster verarbeiten
            Ihre Daten nur insoweit, wie dies zur Erfüllung ihrer
            Leistungspflichten erforderlich ist, und befolgen unsere
            Weisungen in Bezug auf diese Daten.
          </P>

          <H3>Vercel (Frontend-Hosting)</H3>
          <P>
            Anbieter ist die Vercel Inc., 340 S Lemon Ave #4133, Walnut,
            CA 91789, USA (nachfolgend „Vercel"). Vercel stellt das im
            Browser ausgelieferte Frontend dieser Anwendung bereit. Beim
            Aufruf der Website werden technische Zugriffsdaten (u. a.
            IP-Adresse) verarbeitet. Details:{' '}
            <Ext href="https://vercel.com/legal/privacy-policy" />. Die
            Datenübertragung in die USA wird auf die Standardvertragsklauseln
            der EU-Kommission gestützt.
          </P>

          <H3>Railway (Anwendungsserver / Backend)</H3>
          <P>
            Anbieter ist die Railway Corporation, USA (nachfolgend
            „Railway"). Railway hostet unsere serverseitige Anwendung
            (API/Worker). Hierbei werden personenbezogene Daten wie
            IP-Adressen sowie Zugriffs-, Kommunikations- und Vertragsdaten
            verarbeitet. Details:{' '}
            <Ext href="https://railway.com/legal/privacy" />. Die
            Datenübertragung in die USA wird auf die Standardvertragsklauseln
            der EU-Kommission gestützt.
          </P>

          <H3>Supabase (Datenbank &amp; Authentifizierung)</H3>
          <P>
            Anbieter ist die Supabase, Inc., USA (nachfolgend „Supabase").
            Wir nutzen Supabase für die Speicherung von Anwendungsdaten in
            einer Datenbank sowie für die passwortlose Anmeldung
            (Authentifizierung). Verarbeitet werden u. a. E-Mail-Adressen,
            Anmelde- und Sitzungsdaten sowie die von Ihnen in der Anwendung
            erfassten Inhalte. Die Datenbank-Server befinden sich in der
            Europäischen Union (Region Irland). Details:{' '}
            <Ext href="https://supabase.com/privacy" />. Soweit eine
            Verarbeitung außerhalb der EU stattfindet, wird diese auf die
            Standardvertragsklauseln der EU-Kommission gestützt.
          </P>

          {/* 3 ───────────────────────────────────────────────────────── */}
          <H2>3. Allgemeine Hinweise und Pflichtinformationen</H2>

          <H3>Datenschutz</H3>
          <P>
            Die Betreiber dieser Seiten nehmen den Schutz Ihrer persönlichen
            Daten sehr ernst. Wir behandeln Ihre personenbezogenen Daten
            vertraulich und entsprechend den gesetzlichen
            Datenschutzvorschriften sowie dieser Datenschutzerklärung. Wenn
            Sie diese Website benutzen, werden verschiedene personenbezogene
            Daten erhoben. Die vorliegende Datenschutzerklärung erläutert,
            welche Daten wir erheben und wofür wir sie nutzen. Wir weisen
            darauf hin, dass die Datenübertragung im Internet (z. B. bei der
            Kommunikation per E-Mail) Sicherheitslücken aufweisen kann. Ein
            lückenloser Schutz der Daten vor dem Zugriff durch Dritte ist
            nicht möglich.
          </P>

          <H3>Hinweis zur verantwortlichen Stelle</H3>
          <P>
            Die verantwortliche Stelle für die Datenverarbeitung auf dieser
            Website ist:
          </P>
          <P>
            Leopards GmbH
            <br />
            Am Schlangenberg 3
            <br />
            45136 Essen
          </P>
          <P>
            Telefon:{' '}
            <a href="tel:+4917641880498" className="text-brand hover:underline">
              +49 (0) 176 41 880498
            </a>
            <br />
            E-Mail:{' '}
            <a
              href="mailto:leopardsgmbh@gmail.com"
              className="text-brand hover:underline"
            >
              leopardsgmbh@gmail.com
            </a>
          </P>
          <P>
            Verantwortliche Stelle ist die natürliche oder juristische
            Person, die allein oder gemeinsam mit anderen über die Zwecke und
            Mittel der Verarbeitung von personenbezogenen Daten entscheidet.
          </P>

          <H3>Speicherdauer</H3>
          <P>
            Soweit innerhalb dieser Datenschutzerklärung keine speziellere
            Speicherdauer genannt wurde, verbleiben Ihre personenbezogenen
            Daten bei uns, bis der Zweck für die Datenverarbeitung entfällt.
            Wenn Sie ein berechtigtes Löschersuchen geltend machen oder eine
            Einwilligung zur Datenverarbeitung widerrufen, werden Ihre Daten
            gelöscht, sofern wir keine anderen rechtlich zulässigen Gründe
            für die Speicherung Ihrer personenbezogenen Daten haben (z. B.
            steuer- oder handelsrechtliche Aufbewahrungsfristen); im
            letztgenannten Fall erfolgt die Löschung nach Fortfall dieser
            Gründe.
          </P>

          <H3>Allgemeine Hinweise zu den Rechtsgrundlagen</H3>
          <P>
            Sofern Sie in die Datenverarbeitung eingewilligt haben,
            verarbeiten wir Ihre personenbezogenen Daten auf Grundlage von
            Art. 6 Abs. 1 lit. a DSGVO bzw. Art. 9 Abs. 2 lit. a DSGVO.
            Sofern Sie in die Übertragung personenbezogener Daten in
            Drittstaaten eingewilligt haben, erfolgt die Verarbeitung
            zusätzlich auf Grundlage von Art. 49 Abs. 1 lit. a DSGVO. Sind
            Ihre Daten zur Vertragserfüllung oder zur Durchführung
            vorvertraglicher Maßnahmen erforderlich, verarbeiten wir Ihre
            Daten auf Grundlage des Art. 6 Abs. 1 lit. b DSGVO. Des Weiteren
            verarbeiten wir Ihre Daten, sofern diese zur Erfüllung einer
            rechtlichen Verpflichtung erforderlich sind, auf Grundlage von
            Art. 6 Abs. 1 lit. c DSGVO. Die Datenverarbeitung kann ferner auf
            Grundlage unseres berechtigten Interesses nach Art. 6 Abs. 1
            lit. f DSGVO erfolgen.
          </P>

          <H3>Empfänger von personenbezogenen Daten</H3>
          <P>
            Im Rahmen unserer Geschäftstätigkeit arbeiten wir mit
            verschiedenen externen Stellen zusammen. Dabei ist teilweise auch
            eine Übermittlung von personenbezogenen Daten an diese externen
            Stellen erforderlich. Wir geben personenbezogene Daten nur dann
            an externe Stellen weiter, wenn dies im Rahmen einer
            Vertragserfüllung erforderlich ist, wenn wir gesetzlich hierzu
            verpflichtet sind, wenn wir ein berechtigtes Interesse nach
            Art. 6 Abs. 1 lit. f DSGVO an der Weitergabe haben oder wenn eine
            sonstige Rechtsgrundlage die Datenweitergabe erlaubt. Beim
            Einsatz von Auftragsverarbeitern geben wir personenbezogene Daten
            unserer Kunden nur auf Grundlage eines gültigen Vertrags über
            Auftragsverarbeitung weiter.
          </P>

          <H3>Widerruf Ihrer Einwilligung zur Datenverarbeitung</H3>
          <P>
            Viele Datenverarbeitungsvorgänge sind nur mit Ihrer
            ausdrücklichen Einwilligung möglich. Sie können eine bereits
            erteilte Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit
            der bis zum Widerruf erfolgten Datenverarbeitung bleibt vom
            Widerruf unberührt.
          </P>

          <H3>
            Widerspruchsrecht gegen die Datenerhebung in besonderen Fällen
            sowie gegen Direktwerbung (Art. 21 DSGVO)
          </H3>
          <P>
            WENN DIE DATENVERARBEITUNG AUF GRUNDLAGE VON ART. 6 ABS. 1 LIT. E
            ODER F DSGVO ERFOLGT, HABEN SIE JEDERZEIT DAS RECHT, AUS GRÜNDEN,
            DIE SICH AUS IHRER BESONDEREN SITUATION ERGEBEN, GEGEN DIE
            VERARBEITUNG IHRER PERSONENBEZOGENEN DATEN WIDERSPRUCH
            EINZULEGEN; DIES GILT AUCH FÜR EIN AUF DIESE BESTIMMUNGEN
            GESTÜTZTES PROFILING. DIE JEWEILIGE RECHTSGRUNDLAGE, AUF DENEN
            EINE VERARBEITUNG BERUHT, ENTNEHMEN SIE DIESER
            DATENSCHUTZERKLÄRUNG. WENN SIE WIDERSPRUCH EINLEGEN, WERDEN WIR
            IHRE BETROFFENEN PERSONENBEZOGENEN DATEN NICHT MEHR VERARBEITEN,
            ES SEI DENN, WIR KÖNNEN ZWINGENDE SCHUTZWÜRDIGE GRÜNDE FÜR DIE
            VERARBEITUNG NACHWEISEN, DIE IHRE INTERESSEN, RECHTE UND
            FREIHEITEN ÜBERWIEGEN ODER DIE VERARBEITUNG DIENT DER
            GELTENDMACHUNG, AUSÜBUNG ODER VERTEIDIGUNG VON RECHTSANSPRÜCHEN
            (WIDERSPRUCH NACH ART. 21 ABS. 1 DSGVO).
          </P>
          <P>
            WERDEN IHRE PERSONENBEZOGENEN DATEN VERARBEITET, UM
            DIREKTWERBUNG ZU BETREIBEN, SO HABEN SIE DAS RECHT, JEDERZEIT
            WIDERSPRUCH GEGEN DIE VERARBEITUNG SIE BETREFFENDER
            PERSONENBEZOGENER DATEN ZUM ZWECKE DERARTIGER WERBUNG
            EINZULEGEN; DIES GILT AUCH FÜR DAS PROFILING, SOWEIT ES MIT
            SOLCHER DIREKTWERBUNG IN VERBINDUNG STEHT. WENN SIE
            WIDERSPRECHEN, WERDEN IHRE PERSONENBEZOGENEN DATEN ANSCHLIESSEND
            NICHT MEHR ZUM ZWECKE DER DIREKTWERBUNG VERWENDET (WIDERSPRUCH
            NACH ART. 21 ABS. 2 DSGVO).
          </P>

          <H3>Beschwerderecht bei der zuständigen Aufsichtsbehörde</H3>
          <P>
            Im Falle von Verstößen gegen die DSGVO steht den Betroffenen ein
            Beschwerderecht bei einer Aufsichtsbehörde zu, insbesondere in
            dem Mitgliedstaat ihres gewöhnlichen Aufenthalts, ihres
            Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes. Das
            Beschwerderecht besteht unbeschadet anderweitiger
            verwaltungsrechtlicher oder gerichtlicher Rechtsbehelfe.
          </P>

          <H3>Recht auf Datenübertragbarkeit</H3>
          <P>
            Sie haben das Recht, Daten, die wir auf Grundlage Ihrer
            Einwilligung oder in Erfüllung eines Vertrags automatisiert
            verarbeiten, an sich oder an einen Dritten in einem gängigen,
            maschinenlesbaren Format aushändigen zu lassen. Sofern Sie die
            direkte Übertragung der Daten an einen anderen Verantwortlichen
            verlangen, erfolgt dies nur, soweit es technisch machbar ist.
          </P>

          <H3>Auskunft, Berichtigung und Löschung</H3>
          <P>
            Sie haben im Rahmen der geltenden gesetzlichen Bestimmungen
            jederzeit das Recht auf unentgeltliche Auskunft über Ihre
            gespeicherten personenbezogenen Daten, deren Herkunft und
            Empfänger und den Zweck der Datenverarbeitung und ggf. ein Recht
            auf Berichtigung oder Löschung dieser Daten. Hierzu sowie zu
            weiteren Fragen zum Thema personenbezogene Daten können Sie sich
            jederzeit an uns wenden.
          </P>

          <H3>Recht auf Einschränkung der Verarbeitung</H3>
          <P>
            Sie haben das Recht, die Einschränkung der Verarbeitung Ihrer
            personenbezogenen Daten zu verlangen. Hierzu können Sie sich
            jederzeit an uns wenden. Das Recht auf Einschränkung der
            Verarbeitung besteht in folgenden Fällen: Wenn Sie die
            Richtigkeit Ihrer bei uns gespeicherten personenbezogenen Daten
            bestreiten, benötigen wir in der Regel Zeit, um dies zu
            überprüfen. Für die Dauer der Prüfung haben Sie das Recht, die
            Einschränkung der Verarbeitung zu verlangen. Wenn die
            Verarbeitung Ihrer personenbezogenen Daten unrechtmäßig
            geschah/geschieht, können Sie statt der Löschung die
            Einschränkung der Datenverarbeitung verlangen. Wenn wir Ihre
            personenbezogenen Daten nicht mehr benötigen, Sie sie jedoch zur
            Ausübung, Verteidigung oder Geltendmachung von Rechtsansprüchen
            benötigen, haben Sie das Recht, statt der Löschung die
            Einschränkung der Verarbeitung zu verlangen. Wenn Sie einen
            Widerspruch nach Art. 21 Abs. 1 DSGVO eingelegt haben, muss eine
            Abwägung zwischen Ihren und unseren Interessen vorgenommen
            werden. Solange noch nicht feststeht, wessen Interessen
            überwiegen, haben Sie das Recht, die Einschränkung der
            Verarbeitung zu verlangen.
          </P>

          <H3>SSL- bzw. TLS-Verschlüsselung</H3>
          <P>
            Diese Seite nutzt aus Sicherheitsgründen und zum Schutz der
            Übertragung vertraulicher Inhalte eine SSL- bzw.
            TLS-Verschlüsselung. Eine verschlüsselte Verbindung erkennen Sie
            daran, dass die Adresszeile des Browsers von „http://" auf
            „https://" wechselt und an dem Schloss-Symbol in Ihrer
            Browserzeile. Wenn die SSL- bzw. TLS-Verschlüsselung aktiviert
            ist, können die Daten, die Sie an uns übermitteln, nicht von
            Dritten mitgelesen werden.
          </P>

          {/* 4 ───────────────────────────────────────────────────────── */}
          <H2>4. Datenerfassung auf dieser Website</H2>

          <H3>Server-Log-Dateien</H3>
          <P>
            Der Provider der Seiten erhebt und speichert automatisch
            Informationen in so genannten Server-Log-Dateien, die Ihr
            Browser automatisch an uns übermittelt. Dies sind: Browsertyp und
            Browserversion, verwendetes Betriebssystem, Referrer URL,
            Hostname des zugreifenden Rechners, Uhrzeit der Serveranfrage und
            IP-Adresse. Eine Zusammenführung dieser Daten mit anderen
            Datenquellen wird nicht vorgenommen. Die Erfassung dieser Daten
            erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Der
            Websitebetreiber hat ein berechtigtes Interesse an der technisch
            fehlerfreien Darstellung und der Optimierung seiner Website.
          </P>

          <H3>Registrierung auf dieser Website</H3>
          <P>
            Sie können sich auf dieser Website registrieren, um die
            Funktionen der Anwendung zu nutzen. Die Anmeldung erfolgt
            passwortlos über einen per E-Mail zugesandten Anmeldelink
            („Magic Link") oder über Ihr Google-Konto (Anbieter: Google
            Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland).
            Die dazu eingegebenen Daten – insbesondere Ihre E-Mail-Adresse –
            verwenden wir ausschließlich zum Zweck der Bereitstellung des
            Nutzerkontos und der damit verbundenen Dienste. Die Verarbeitung
            der bei der Registrierung eingegebenen Daten erfolgt zum Zwecke
            der Durchführung des durch die Registrierung begründeten
            Nutzungsverhältnisses und ggf. zur Anbahnung weiterer Verträge
            (Art. 6 Abs. 1 lit. b DSGVO). Die bei der Registrierung erfassten
            Daten werden von uns gespeichert, solange Sie auf dieser Website
            registriert sind, und anschließend gelöscht. Gesetzliche
            Aufbewahrungsfristen bleiben unberührt.
          </P>

          <H3>Anfrage per E-Mail oder Telefon</H3>
          <P>
            Wenn Sie uns per E-Mail oder Telefon kontaktieren, wird Ihre
            Anfrage inklusive aller daraus hervorgehenden personenbezogenen
            Daten (Name, Anfrage) zum Zwecke der Bearbeitung Ihres Anliegens
            bei uns gespeichert und verarbeitet. Diese Daten geben wir nicht
            ohne Ihre Einwilligung weiter. Die Verarbeitung dieser Daten
            erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO, sofern Ihre
            Anfrage mit der Erfüllung eines Vertrags zusammenhängt oder zur
            Durchführung vorvertraglicher Maßnahmen erforderlich ist. In
            allen übrigen Fällen beruht die Verarbeitung auf unserem
            berechtigten Interesse an der effektiven Bearbeitung der an uns
            gerichteten Anfragen (Art. 6 Abs. 1 lit. f DSGVO) oder auf Ihrer
            Einwilligung (Art. 6 Abs. 1 lit. a DSGVO).
          </P>

          {/* 5 ───────────────────────────────────────────────────────── */}
          <H2>5. Eingesetzte Dienste und Auftragsverarbeiter</H2>
          <P>
            Zur Erbringung unserer Leistungen setzen wir die folgenden
            Dienste ein. Soweit dabei personenbezogene Daten verarbeitet
            werden, geschieht dies auf Grundlage von Verträgen über
            Auftragsverarbeitung (Art. 28 DSGVO) bzw. der jeweils genannten
            Rechtsgrundlage.
          </P>

          <H3>Stripe (Zahlungsabwicklung)</H3>
          <P>
            Für die Abwicklung von Abonnement-Zahlungen nutzen wir den Dienst
            Stripe. Anbieter für Kunden innerhalb der EU ist die Stripe
            Payments Europe, Ltd., 1 Grand Canal Street Lower, Grand Canal
            Dock, Dublin, Irland (nachfolgend „Stripe"). Im Rahmen des
            Bezahlvorgangs werden die zur Zahlungsabwicklung erforderlichen
            Daten (z. B. Name, E-Mail-Adresse, Rechnungsanschrift,
            Zahlungsbetrag, Zahlungsmittel) verarbeitet. Die Eingabe der
            Kreditkarten-/Zahlungsdaten erfolgt direkt bei Stripe; wir
            speichern keine vollständigen Zahlungsdaten. Rechtsgrundlage ist
            Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) sowie Art. 6
            Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer
            reibungslosen Zahlungsabwicklung). Details:{' '}
            <Ext href="https://stripe.com/de/privacy" />.
          </P>

          <H3>Twilio (SMS-Versand)</H3>
          <P>
            Für den Versand von SMS-Benachrichtigungen (z. B. an Gäste oder
            an Reinigungskräfte) nutzen wir den Dienst Twilio. Anbieter ist
            die Twilio Inc., 375 Beale Street, Suite 300, San Francisco,
            CA 94105, USA (nachfolgend „Twilio"). Zum Versand werden die
            jeweilige Telefonnummer sowie der Nachrichteninhalt an Twilio
            übermittelt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO bzw.
            Art. 6 Abs. 1 lit. f DSGVO. Die Datenübertragung in die USA wird
            auf die Standardvertragsklauseln der EU-Kommission gestützt.
            Details: <Ext href="https://www.twilio.com/en-us/legal/privacy" />
            .
          </P>

          <H3>Channex (Channel-Management)</H3>
          <P>
            Für die Anbindung von Buchungsportalen (Channel-Management)
            nutzen wir den Dienst Channex. Anbieter ist die Channex LTD,
            Vereinigtes Königreich (nachfolgend „Channex"). Über Channex
            werden Verfügbarkeits-, Preis- und Buchungsdaten sowie ggf.
            Gästedaten (Name, Kontaktdaten, Buchungszeitraum) verarbeitet und
            mit angebundenen Buchungsportalen synchronisiert.
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Für das
            Vereinigte Königreich liegt ein Angemessenheitsbeschluss der
            EU-Kommission vor. Details:{' '}
            <Ext href="https://channex.io/" />.
          </P>

          <H3>Inngest (Hintergrund-Verarbeitung)</H3>
          <P>
            Zur Steuerung und Ausführung von Hintergrundprozessen (z. B.
            Synchronisierungs- und Versand-Jobs) nutzen wir den Dienst
            Inngest. Anbieter ist die Inngest, Inc., USA (nachfolgend
            „Inngest"). Dabei werden technische Ereignis- und Auftragsdaten
            verarbeitet, die personenbezogene Bezüge enthalten können.
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Die
            Datenübertragung in die USA wird auf die Standardvertragsklauseln
            der EU-Kommission gestützt. Details:{' '}
            <Ext href="https://www.inngest.com/privacy" />.
          </P>
        </div>

        <div className="mt-6 flex justify-center gap-4 text-[12px]">
          <Link
            to="/impressum"
            className="text-muted hover:text-ink transition-colors"
          >
            Impressum
          </Link>
          <Link
            to="/login"
            className="text-muted hover:text-ink transition-colors"
          >
            Login
          </Link>
        </div>
        <p className="mt-4 text-center text-[12px] text-whisper">
          Rentaro — Leopards GmbH
        </p>
      </div>
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="display text-[18px] font-medium text-ink mt-8 mb-1 pt-6 border-t border-line/70">
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="display text-[14.5px] font-medium text-ink mt-4 mb-0.5">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-ink-soft leading-relaxed mt-1.5">
      {children}
    </p>
  );
}

/** External link — opens in a new tab, label defaults to the href. */
function Ext({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-brand hover:underline break-words"
    >
      {children ?? href}
    </a>
  );
}
