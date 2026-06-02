# Migration von einem bestehenden PMS zu Rentaro

Praxis-Anleitung für den Umzug eines Vermieters von einem bestehenden Property-
Management-System (z. B. Guesty, Smoobu, Hostaway, Lodgify) zu Rentaro — inkl.
der **Fehler und Gefahren**, die dabei real auftreten. Geschrieben aus der
Erfahrung der ersten Migration (Guesty → Rentaro, CITY APARTMENTS ESSEN).

> TL;DR der größten Gefahr: **Während des Umzugs darf nur EIN Channel-Manager
> die OTAs steuern.** Wenn altes PMS und Channex gleichzeitig Verfügbarkeit an
> Airbnb/Booking schreiben, drohen Doppelbuchungen. Reihenfolge einhalten
> (siehe „Cutover").

---

## 1. Grundprinzip (wer besitzt was)

- **Rentaro** ist die Quelle der Wahrheit für **Verfügbarkeit**. Jede Buchung/
  jeder Block setzt belegte Tage; der ARI-Flusher pusht das an Channex.
- **Channex** propagiert Verfügbarkeit/Raten an die **OTAs** (Airbnb, Booking.com, …)
  und liefert eingehende Buchungen über den **Booking-Feed** zurück.
- **PriceLabs** (optional) besitzt im PriceLabs-Modus **Preise + Aufenthalts-
  Restriktionen** (Min-Stay etc.) und schreibt sie direkt in Channex (ADR 0006).
  Rentaro behält dann nur Verfügbarkeit + Stop-Sell.
- Manuelle Buchungserstellung in Channex wird **nicht** unterstützt — eine
  Direkt-/Import-Buchung ist immer ein **Verfügbarkeits-Block**, kein Channex-
  Booking.

Daraus folgt die ganze Migrationslogik: erst Bestand in Rentaro, dann
Verfügbarkeit an Channex/OTAs, dann die OTA-Hoheit vom alten PMS übernehmen.

---

## 2. Vorbereitung

- [ ] **Inventarliste** aus dem alten PMS (Apartments, exakte Namen).
- [ ] **Buchungs-Export** aus dem alten PMS (zukünftige + aktive Buchungen; idealerweise auch jüngste Vergangenheit für die Historie).
- [ ] **Zugänge**: Channex-Account, OTA-Extranets (Airbnb, Booking.com), ggf. PriceLabs.
- [ ] **DB-Backup** der Rentaro-Datenbank (Supabase) — Rollback-Anker.
- [ ] **Wartungsfenster** in einer buchungsschwachen Zeit (Nebensaison/nachts).
- [ ] Klären: Welcher **Connectivity-Provider** ist an den OTAs aktuell aktiv? Booking.com erlaubt i. d. R. nur **einen** gleichzeitig.

---

## 3. Schritt für Schritt

1. **Apartments anlegen** (`/apartments`). Namen **exakt** wie im PMS-Export — der Importer matcht Buchungen über den Listing-Namen.
2. **Mit Channex verbinden** (`/apartments` → „Mit Channex verbinden"). Legt je Apartment 1 Room-Type + 1 Rate-Plan an (ADR 0007).
3. **OTA-Listings mappen** (`/channels`, Channex-Iframe). **Pro Listing genau EINE Rate** (ADR 0011) — sonst greifen Restriktionen nicht zuverlässig.
4. *(Optional)* **PriceLabs ↔ Channex** verbinden und in `/settings` `rateSource = pricelabs` setzen.
5. **Bestandsbuchungen importieren** — zuerst **Dry-Run**:
   ```bash
   pnpm db:import-guesty <export.xls> --dry-run --tenant=<TENANT_UUID>
   pnpm db:import-guesty <export.xls>           --tenant=<TENANT_UUID>
   ```
   Idempotent über `external_id = 'guesty:<Reservierungscode>'` — erneuter Lauf ist ein No-op. Schreibt **keine** ARI.
   > Hinweis: Aktuell existiert nur der **Guesty**-Importer (XLS „Check-in List"). Andere PMS brauchen entweder eine auf dieses Format gemappte CSV oder einen angepassten Importer.
6. **Full Sync** je Apartment (`/calendar` bzw. Sync-Aktion) → Channex erhält Verfügbarkeit + Raten. **Pflichtschritt** nach dem Import.
7. **Vorlagen & Automatik** einrichten (`/messages`, `/cleaning`, Variablen) — **noch nicht scharf** für Bestandsbuchungen (siehe Gefahr E).
8. **Cutover** (Abschnitt 5) — OTA-Hoheit vom alten PMS auf Channex umstellen.
9. **Verifizieren** (Abschnitt 6).

---

## 4. Die Fehler & Gefahren ⚠️ (Kern)

| # | Gefahr | Ursache | Symptom | Vermeidung |
|---|--------|---------|---------|------------|
| **A** | **Doppelbuchung im Übergang** | Altes PMS **und** Channex schreiben gleichzeitig Verfügbarkeit an dieselben OTAs | OTA verkauft einen bereits belegten Tag | Nur **ein** Channel-Manager an den OTAs; striktes Cutover-Timing; Bestand **vor** der Umstellung importieren + Full Sync |
| **B** | **Migrations-Naht (Duplikat/Storno greift nicht)** | Importierte Buchungen haben `channex_booking_id = NULL`; ein späteres Feed-Event derselben Reservierung (Verlängerung/Storno) findet die Zeile nur über den **OTA-Code** | Verlängerung legt 2. aktive Buchung an; Storno lässt die importierte Zeile **belegt** | Reservierungscode korrekt importieren (→ `ota_confirmation_code`). Rentaro gleicht jetzt zusätzlich per Code ab; trotzdem die **ersten** Verlängerungen/Stornos nach Umzug prüfen |
| **C** | **Verfügbarkeit nie gepusht** | Import schreibt **keine** ARI | OTAs kennen die importierte Belegung nicht → verkaufen belegte Tage | Nach Import **zwingend Full Sync**; danach Stichprobe: sind belegte Tage in Channex + OTA blockiert? |
| **D** | **Min-Stay/Restriktion greift nicht** | Mehrere OTA-Raten, alte PMS-Restriktionen, oder PriceLabs vs. Rentaro als Owner | Zu kurze Buchungen kommen trotz Mindestaufenthalt durch | Pro Listing **eine** Rate (ADR 0011); Owner klären (PriceLabs); nach Umzug PriceLabs-Sync + Kalender-Stichprobe im OTA-Extranet |
| **E** | **Nachrichten-Backfill-Spam** | Automatik feuert rückwirkend für Bestands-/Altbuchungen | Gäste bekommen verspätete „Bestätigungen"; laufende Gäste evtl. nichts | 2-Tage-Grace fängt Altes ab; Vorlagen **nach** dem Import scharf schalten; in der Buchungs-Detail-Timeline „Aktion nötig/Überfällig" prüfen, laufende Check-in-Codes via **„Jetzt senden"** |
| **F** | **Feed-Flut / blockierter Feed** | Beim Verbinden kommen viele Revisions; eine fehlerhafte (z. B. Storno ohne Daten) | Buchungen erscheinen verspätet/gar nicht; Channex schickt „unacked after 30 min"-Mails | Feed ist jetzt fehler-isoliert + 5-Min-Safety-Cron; **„unacked"-Mails ernst nehmen** und Mapping prüfen |
| **G** | **Geld/Währung falsch** | Brutto/Netto/Payout verwechselt; Währung je Apartment nicht gesetzt | Falsche Beträge, falsche City-Tax | Beträge sind **Cent + ISO-Währung**; Importspalten (Accommodation/Cleaning/Payout) bewusst mappen; Apartment-Währung prüfen |
| **H** | **Datum/Zeitzone** | `checkin`/`checkout` sind **DATE** (ohne Zeit/TZ); Confirmation-Date → `created_at` beeinflusst Trigger-Fälligkeit | Verschobene Tage; Nachrichten zur falschen Zeit | Daten als reines Datum importieren; Check-in/out-Zeit separat; Tenant-Zeitzone korrekt |
| **I** | **Doppelimport / falscher Tenant** | Re-Run ohne Verständnis der Idempotenz; `--tenant` vergessen (Default-Tenant!) | Daten im falschen Workspace; vermeintliche Dubletten | Immer erst `--dry-run`; `--tenant=<uuid>` **explizit** setzen; `external_id` ist der Idempotenz-Schlüssel |
| **J** | **Namens-Mismatch** | Importer matcht auf Listing-Namen | Buchungen landen nicht / am falschen Apartment | Namen exakt spiegeln; Dry-Run-Ausgabe auf „unmatched" prüfen |
| **K** | **Unmapptes Apartment** | Apartment nicht mit Channex verbunden/gemappt | Eingehende OTA-Buchung wird übersprungen (bleibt jetzt im Feed bis gemappt) | **Alle aktiven** Apartments vor Cutover verbinden **und** mappen |
| **L** | **Kein Rollback-Plan** | Kein Backup/Dry-Run | Schwer reparierbarer Fehlimport | DB-Backup vorher; mit **einem** Apartment starten + verifizieren, dann Rest |

---

## 5. Cutover-Reihenfolge (kritisch gegen Doppelbuchung)

Genau diese Reihenfolge minimiert das Überbuchungs-Fenster:

1. **Bestand importieren** (alle zukünftigen + aktiven Buchungen). Dry-Run → real.
2. **Apartments in Channex** anlegen/verbinden **und** OTA-Listings mappen (eine Rate je Listing).
3. **Full Sync je Apartment** → Channex kennt jetzt Belegung + Raten.
4. **Altes PMS von den OTAs trennen** (in den OTA-Extranets bzw. beim alten Connectivity-Provider), **Channex als alleinigen** Channel-Manager aktivieren. Das ist der **riskanteste Moment** — ggf. mit Channex-/OTA-Support koordinieren, da Booking.com nur einen Provider zulässt.
5. **Feed/Webhooks beobachten**; die ersten realen Buchungen, Änderungen und Stornos gezielt prüfen.
6. **Vorlagen scharf schalten**; Timeline „Aktion nötig" je laufender Buchung durchgehen.

---

## 6. Verifikations-Checkliste (nach dem Umzug)

- [ ] Belegte Tage sind in **Channex und in jeder OTA** blockiert (Stichprobe pro Apartment).
- [ ] **Testbuchung** je OTA landet in Rentaro (Feed) **und** blockt die anderen Kanäle — ohne manuellen Sync (Verfügbarkeit wird beim Ingest gepusht).
- [ ] **Min-Stay** greift (kurze Testbuchung wird abgelehnt / Kalender zeigt die Restriktion).
- [ ] Keine **Duplikate** (dieselbe Reservierung nicht zweimal aktiv).
- [ ] **Verlängerung + Storno** einer importierten Buchung greifen (dank Code-Abgleich).
- [ ] **Nachrichten-Timeline**: nichts grundlos „Überfällig" für laufende Gäste; Check-in-Codes versendet.
- [ ] **Preise** korrekt (PriceLabs/Channex) inkl. Reinigung + City-Tax.
- [ ] **Listing-Links** (`/listing-links`) hinterlegt — praktisch direkt nach dem Umzug.

---

## 7. Technischer Hintergrund (für Entwickler)

- Import: `packages/db/scripts/import-guesty.ts` — idempotent via `external_id`, kein ARI.
- Verfügbarkeit beim Ingest: `apps/worker/src/inngest/functions/ingest-bookings.ts` (Adopt/Storno per `ota_confirmation_code`, Fehler-Isolation, `enqueueAri`).
- ARI-Flusher: `apps/worker/src/inngest/functions/ari-flush.ts`.
- Relevante ADRs: **0006** (PriceLabs direkt), **0007** (1 Room-Type/Rate-Plan je Property), **0011** (eine Booking.com-Rate je Listing).
