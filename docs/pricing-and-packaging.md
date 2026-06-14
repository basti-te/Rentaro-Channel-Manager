# Rentaro — Pricing & Packaging

> **Quelle der Wahrheit** für Landing Page, Stripe-Produkte und Feature-Gating (Entitlements).
> Stand: Juni 2026 · Status: **v1 — eingefroren** (alle Preise bestätigt).
> Marktbenchmark, der diese Preise stützt: siehe Deep-Research-Ergebnis (Juni 2026) — Smoobu/Beds24/Uplisting/Hospitable u. a.

---

## 1. Positionierung

- **Founder-Operator-Story als Vertrauensanker:** gebaut von einem Vermieter, der selbst 16 Apartments in Berlin betreibt. Echte Screenshots, echte Zahlen.
- **Wedge: „All-in, transparent + Automatisierung".** Wir gewinnen 20+-Hosts NICHT über den niedrigsten Preis (Budget-Anbieter sind billiger), sondern über: keine versteckten Plattformgebühren, kein MwSt-Schock, planbare Preise — plus KI & Automatisierung.
- **Betriebsgeheimnis:** Das Backend (Sync-Infrastruktur) wird **nirgends** genannt — nicht auf der Seite, nicht in E-Mails, nicht im Quelltext sichtbar. Beworben wird immer nur das *Ergebnis* („verbunden mit Airbnb, Booking.com & 50+ Kanälen").

---

## 2. Funnel & Hook

```
Paid Ads  ──►  "1 JAHR GRATIS Channel Manager"  ──►  Pricing-Seite  ──►  Ziel: Basic / Premium
                                                            │
                                                            ├─ kleiner Host  → Free-Köder (Karte Pflicht)
                                                            └─ großer Host   → 14-Tage-Premium-Trial / Done-for-You
                                                                                    │
                                                            Checkout ──► One-Time-Service (deckt CAC)
```

- **Hook:** „1 Jahr gratis Channel Manager" lockt auf die Pricing-Seite. Dort zeigt sich, **wie viel mehr** Basic/Premium können.
- **Free = Köder.** Wer ihn wählt, bekommt nur das Nötigste (Kalender). Karte ist Pflicht zum Freischalten.
- **Nach 12 Monaten:** automatische Hochstufung auf **Basic** + Belastung der hinterlegten Karte, sofern nicht gekündigt. (→ Pflichttexte, Abschnitt 10.)
- **Große Hosts** steigen nicht über den Kalender-Köder ein (zeigt die Automatisierung nicht), sondern über einen **14-Tage-Premium-Trial** (voller Funktionsumfang) oder direkt das Done-for-You-Setup.

---

## 3. Die drei Pakete (Pricing-Cards)

### 🆓 Free — „Channel Manager"
- **1 Jahr gratis**, danach Basic
- **Bis zu 2 Listings**
- Verfügbarkeits-Sync über 50+ Kanäle
- Visueller 2-Wege-Kalender
- _Karte zum Freischalten erforderlich_
- **CTA: „Gratis starten"**

### ⭐ Basic — **9 € / Listing / Monat**
- **Alles aus Free, plus:**
- Unbegrenzte Listings
- Unified Inbox (alle OTA-Chats an einem Ort)
- Automatisierte Gastnachrichten
- Reinigungs-Kalender
- Auto-Bewertungen nach Checkout
- E-Mail-Benachrichtigungen
- **CTA: „Basic wählen"**

### 🏆 Premium — **19 € / Listing / Monat** · _Bestseller-Badge_
- **Alles aus Basic, plus:**
- KI-Gast-Chatbot (Auto-Antwort + Entwürfe) — inkl. Kontingent
- Dynamic Pricing (PriceLabs-Anbindung)
- Gäste- & Reinigungs-SMS
- Gäste-Rechnungen + Self-Service-Portal + Editor
- Statistiken & Reports
- Geld-zurück- & Zufriedenheitsgarantie
- **CTA: „Premium wählen" · „14 Tage gratis testen"**

> Unter den Cards: _„Preis pro Listing — je mehr Einheiten, desto günstiger. 2 Monate gratis bei Jahreszahlung."_ + **Ersparnis-Rechner** (Slider Einheiten → Monatspreis).

---

## 4. Preis-Mechanik

### Pro Listing + automatischer Mengenrabatt

| Einheiten | Rabatt | Basic/Einheit | Premium/Einheit |
|---|---|---|---|
| 1–4 | – | 9,00 € | 19,00 € |
| 5–9 | −10 % | 8,10 € | 17,10 € |
| 10–19 | −20 % | 7,20 € | 15,20 € |
| **20–49** | **−30 %** | **6,30 €** | **13,30 €** |
| 50+ | −35 % (ab 100 individuell) | 5,85 € | 12,35 € |

### Beispiel-Monatspreis (Monatszahlung, nach Rabatt)

| Portfolio | Basic | Premium (ohne Nutzung) |
|---|---|---|
| 1 Einheit | 9 € | 19 € |
| 5 Einheiten | ~40,50 € | ~85,50 € |
| 10 Einheiten | 72 € | 152 € |
| **20 Einheiten** | **126 €** | **266 €** |
| 50 Einheiten | ~293 € | ~618 € |

- **Jahreszahlung:** 2 Monate geschenkt (≈ −16,7 %). Stapelt sich mit dem Mengenrabatt.
- **Free-Regeln:** max. 2 Listings · Karte Pflicht · läuft nach 12 Monaten aus → Auto-Hochstufung auf Basic zum Standard-Listing-Preis der verbundenen Einheiten.
- **14-Tage-Premium-Trial:** voller Funktionsumfang, für direkte/große Hosts; danach Wahl Premium/Basic/Kündigung.

### Marge (intern, nicht öffentlich)
- Variable Kosten: Basic ~1,00 €/Listing, Free ~0,50 €/Listing, Premium ~1,00 € + durchgereichte Nutzung.
- Fix: ~137 €/Monat (Hosting + Infrastruktur + Domain).
- → Basic ~89 % Marge, Premium ~95 %. Fixkosten ab ~16–20 zahlenden Basic-Listings gedeckt.

---

## 5. Nutzungsbasierte Add-ons (nur Premium)

| Add-on | Abrechnung |
|---|---|
| KI-Gast-Antworten | **0,10 € / Antwort**, pro Listing nach tatsächlicher Nutzung (kein Inklusivkontingent) |
| Gäste- & Reinigungs-SMS | **0,12 € / SMS** (opt-in) · einzelne Länder höher |

- KI **rein nutzungsbasiert** pro Listing. **Große Portfolios (20+) laufen ohnehin über einen Sales-Call** — dort wird das KI-Volumen individuell verhandelt (löst das Planbarkeits-Thema für Vielnutzer).
- SMS ist reine Durchleitung (Carrier-Kosten + Marge). Ziel-Länder müssen freigeschaltet sein.

---

## 6. Einmalige Services (im Checkout)

**Strategie:** Einmalkäufe **decken nur die Lead-Kosten (CAC)** — der Gewinn kommt aus den wiederkehrenden Abos. Deshalb bewusst **niedrige Einstiegspreise** (maximale Kaufquote), nie verpflichtend. Da die Preise niedrig sind, zählt **hohe Attach-Rate + Stapeln mehrerer Bumps pro Bestellung**, um die CAC zu decken.

### Setup (in 2 Teilen + Bundle)
| Service | Preis | Inhalt |
|---|---|---|
| **Teil 1 — Kanal-Setup** | 49 € | Airbnb + Booking verbinden, Listings mappen, Verfügbarkeit live |
| **Teil 2 — Automatik-Setup** | 69 € | Reinigungs- + Gastnachrichten + Trigger einrichten |
| **Komplett-Setup (Teil 1+2)** 🚩 | **99 €** (statt 118 €) | beides; **gratis ab 20 Einheiten** |

### Weitere Einmal-Angebote
| Service | Preis | Rolle / Hinweis |
|---|---|---|
| Daten-Import aus altem PMS | 49 € | Order-Bump · erstattbar, wenn Kunde bleibt |
| Profi-Vorlagen-Paket (DE+EN) | 29 € | Order-Bump · fertige Nachrichten-Vorlagen |
| KI-Wissensdatenbank-Setup | 69 € | Add-on (nur Premium) · KI antwortet ab Tag 1 |
| Rechnungs-Setup | 49 € | Add-on (nur Premium) · MwSt/City Tax/Logo |
| Strategie-Call 30 Min | 99 € | Listing-Optimierung (keine %-Versprechen, UWG) |
| Strategie-Call 60 Min + PriceLabs | 199 € | PriceLabs-Mitgliedschaft separat |
| Express „Live in 24 h" | +39 € | Aufpreis auf ein Setup · Dringlichkeit |
| Jahres-Upgrade | „2 Monate gratis" | Order-Bump · kein Service, Cash + Retention |

**Checkout-Sequenz:** Plan wählen → **Order-Bump** (z. B. Daten-Import / Vorlagen-Paket als Checkbox) → bestätigen → **1-Click-Upsell** (Komplett-Setup) → Danke-Seite. **Nicht alle gleichzeitig zeigen** — pro Schritt 1–2 relevante; Rest später in der App. KI-/Rechnungs-Setup nur bei Premium einblenden.

**Framing:** „Deine Software ist gratis. Sollen *wir* sie für dich einrichten, damit du heute live bist?" — das Bezahlte ist klar der **Service**, nicht die Software.

---

## 7. Feature-Matrix (vollständig)

| Feature | Free | Basic | Premium |
|---|:--:|:--:|:--:|
| **Kanal-Management** | | | |
| Verfügbarkeits-Sync über 50+ Kanäle | ✓ | ✓ | ✓ |
| Visueller 2-Wege-Kalender | ✓ | ✓ | ✓ |
| Kanäle verbinden & verwalten | ✓ | ✓ | ✓ |
| Inventar-Verwaltung | ✓ (max 2) | ✓ | ✓ |
| Gruppen & Gebäude | – | ✓ | ✓ |
| Listing-Links | – | ✓ | ✓ |
| **Kommunikation** | | | |
| Unified Inbox | – | ✓ | ✓ |
| Automatisierte Gastnachrichten (Vorlagen + Trigger) | – | ✓ | ✓ |
| Vorlagen & Variablen | – | ✓ | ✓ |
| KI-Gast-Chatbot (Auto + Entwürfe + Apartment-Wissen) | – | – | ✓ *(Usage)* |
| Gäste-SMS (z. B. Check-in) | – | – | ✓ *(Usage)* |
| **Operations** | | | |
| Reinigungs-Kalender | – | ✓ | ✓ |
| Teammates / Reinigungskräfte | – | ✓ | ✓ |
| Reinigungs-SMS-Benachrichtigung | – | – | ✓ *(Usage)* |
| E-Mail-Benachrichtigungen (Buchungen & Fehler) | – | ✓ | ✓ |
| Teammate-Rollen & Rechte | – | – | ✓ |
| Audit-Log | – | – | ✓ |
| **Umsatz & Finanzen** | | | |
| Auto-Bewertungen nach Checkout | – | ✓ | ✓ |
| Dynamic Pricing (PriceLabs-Anbindung) | – | – | ✓ ¹ |
| Gäste-Rechnungen + Self-Service-Portal | – | – | ✓ |
| Rechnungs-Editor | – | – | ✓ |
| Statistiken & Reports | – | – | ✓ |
| **In Entwicklung (Premium)** | | | |
| Website-Builder | – | – | 🔜 |
| Gäste-Karte | – | – | 🔜 |
| **Support & Garantie** | | | |
| E-Mail-Support | ✓ | ✓ | ✓ |
| Priorisierter Support | – | – | ✓ |
| Geld-zurück- & Zufriedenheitsgarantie | – | – | ✓ |

¹ PriceLabs-Mitgliedschaft zahlt der Kunde separat. _Künftiger Wedge: eigenes Dynamic Pricing bündeln → spart dem Kunden ~20 $/Listing._

---

## 8. Vertrauen / Trust-Elemente (Landing Page)

- Founder-Operator-Vorstellung (Foto, Story, echtes Portfolio) + Verlinkung Social Media.
- Echte Produkt-Demo/Screenshots (Kalender, Inbox) — Authentizität > Hochglanz.
- Design-Partner-Testimonials (erst sammeln, dann Ads skalieren).
- Geld-zurück-/Zufriedenheitsgarantie (Premium).
- DSGVO, Datenexport, kein Lock-in, „faire Kündigung jederzeit".
- **Nie** das Backend/Sync-Infrastruktur nennen.

---

## 9. Landing-Page-Struktur (IA)

1. **Hero:** „1 Jahr gratis Channel Manager" + Sub-Versprechen + 1 CTA. Kurzes Founder-Demo-Video (60–90 s).
2. **Problem:** Doppelbuchungen, 5 Logins, manuelle Nachrichten.
3. **Lösung/Demo:** Produkt in Aktion (Sync, Inbox).
4. **Features als Outcomes:** „Nie wieder doppelt buchen", „Antworte automatisch", „Verdiene mehr mit Dynamic Pricing".
5. **Social Proof:** Founder-Story + Testimonials.
6. **Pricing:** 3 Cards (Premium = Bestseller) + Ersparnis-Rechner (Slider).
7. **One-Time-Services** (nur im Checkout, nicht auf der Hauptseite).
8. **Garantie / Risk-Reversal.**
9. **FAQ:** Wechselangst, Datensicherheit, Kündigung, „was passiert nach dem Gratis-Jahr".
10. **Final-CTA.**
- Mobile-first. Preise offen zeigen (keine versteckten Kosten = unser Wedge).
- **Sprache: DE/EN-Toggle** mit Auto-Erkennung der Besuchersprache (Browser-Sprache → Default, manuell umschaltbar). i18n von Anfang an einplanen.
- **Optional/SEO:** Vergleichsseiten („Smoobu-Alternative", „Hostaway-Alternative") für wechselwillige große Hosts.

---

## 10. Rechtliche Hinweise (DE/EU) — vor Launch klären

- **Auto-Konversion Free → Basic:** „zahlungspflichtig bestellen"-Button (Button-Lösung), klare Vorab-Info, **Kündigungsbutton**, **Erinnerungsmail vor erster Abbuchung** (senkt Chargebacks).
- **B2C ist eingeschlossen** → strengere Verbraucherregeln gelten: **Brutto-Preise** (inkl. MwSt) anzeigen, **Widerrufsrecht** (bei digitalen Leistungen Hinweis + ausdrücklicher Verzicht vor Sofort-Freischaltung), **Kündigungsbutton** (Pflicht), Button-Lösung „zahlungspflichtig bestellen". B2B parallel: Netto-Preise + Reverse Charge (USt-IdNr.).
- **MwSt:** EU-B2B = Reverse Charge → USt-IdNr. erfassen/validieren (Stripe Tax nutzen).
- **Werbeaussagen:** keine konkreten „+X % Umsatz"-Zahlen (UWG/Abmahnrisiko); Garantien in AGB sauber definieren.
- **DSGVO:** AVV mit allen Sub-Prozessoren; Verarbeitungsverzeichnis.

---

## 11. Noch zu finalisieren ⏳

1. **20+-Benchmark** optional vervollständigen (Guesty, Lodgify, Hostaway, Avantio — im ersten Research nicht 3-fach verifiziert). *Nur falls für Pricing-Seite/Vergleichsseiten gewünscht.*

**Spec eingefroren (v1).** Bestätigt: Tiers 9 €/19 € pro Listing · Mengenrabatt −10/20/30/35 % · KI 0,10 €/Antwort (große Portfolios via Sales-Call) · SMS 0,12 € · Setup gratis ab 20 · Einmal-Menü (Setup 2-teilig + 99 €-Bundle, Daten-Import 49 €, Vorlagen 29 €, KI-Wissensdb 69 €, Rechnungs-Setup 49 €, Express +39 €, Strategie-Calls 99/199 €) · Sprache DE/EN-Toggle · B2C inklusive.
