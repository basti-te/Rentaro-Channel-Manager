# Rentaro — Monetarisierungs-Bauplan

> Technischer Fahrplan zur Umsetzung von [pricing-and-packaging.md](pricing-and-packaging.md).
> Stand: Juni 2026 · Status: **final (v1)** · Bereit zum Bau — wartet auf grünes Licht.
> Disziplin: Migrationen IMMER vor dem Code deployen, der sie referenziert. Stripe erst im **Test-Mode**, dann Live.

---

## 1. Ausgangslage (was schon existiert)

**✅ Wiederverwendbar (schon gebaut):**
- Stripe-Client + Checkout + Customer-Portal + Webhooks: `packages/api/src/services/stripe.ts`, `packages/api/src/routers/billing.ts`, `apps/worker/src/webhooks/stripe.ts`, `apps/worker/src/inngest/functions/stripe-event.ts`
- `subscriptions`-Tabelle (status, interval, quantity, Perioden, trialEndsAt, cancelAt) + `tenants` (stripeCustomerId, smsEnabled, aiRepliesEnabled, billingExempt, onboardedAt, Usage-Watermarks)
- **KI-/SMS-Metering** (täglich): `ai-usage-reconcile.ts`, `sms-usage-reconcile.ts`; Pro-Property-Quantity-Sync: `billing-reconcile.ts`
- **Plan-Guard-Middleware** (`packages/api/src/services/plan-guard.ts`) auf editor/admin/owner-Procedures
- Onboarding (`onboarding.ts`, `me.bootstrap`): legt Tenant + Owner-Membership + Free-Subscription (14-Tage-Trial) an
- Öffentliche Routen existieren: `landing.tsx`, `login.tsx`, `impressum.tsx`, `datenschutz.tsx`, `invoice-public.tsx`
- `properties.active` + `activePropertyCount()` für die Mengen-Zählung

**🔴 Fehlt komplett:**
- Tier-System Free/Basic/Premium mit **Feature-Gating + Limits** (heute: binär „Abo ja/nein")
- **Pro-Listing-Staffelpreise** (heute: base-fee + per-property; Spec will reine Pro-Listing-Volumenstaffel)
- **Einmal-Käufe** (Setup-Services, Order-Bumps, 1-Click-Upsell)
- **Free→Basic-Auto-Konversion** nach 12 Monaten + Kartenerfassung beim Gratis-Start
- **Öffentliche Pricing-Seite + Landing-Rebuild + DE/EN-i18n**
- **B2C-Rechtspflichten** (Brutto-Preise, Widerruf, Kündigungsbutton, Stripe Tax/USt-IdNr.)

**⚠️ Aufräumen:** `planEnum` ist heute `free/starter/pro/enterprise` und wird nur als Label genutzt (alle Zahler hartcodiert `starter`). → Auf **`free/basic/premium`** umstellen (geringes Risiko, kaum Echt-Tenants).

---

## 2. Zielarchitektur

### Tiers → Stripe
- Sauberes Enum **`tier: free | basic | premium`** (ersetzt das Legacy-`plan`-Enum).
- **Pro-Listing-Volumenstaffel über Stripe „volume tiered pricing"** (`billing_scheme=tiered`, `tiers_mode=volume`). 1 Price je Tier × Interval = **4 Abo-Preise**, Mengenrabatt nativ eingebaut. `quantity = activePropertyCount`.

| Stripe Price | Tiers (volume, Cent/Listing) |
|---|---|
| Basic monatlich | 1–4 → 900 · 5–9 → 810 · 10–19 → 720 · 20–49 → 630 · 50+ → 585 |
| Basic jährlich (×10) | 9000 · 8100 · 7200 · 6300 · 5850 (pro Listing/Jahr) |
| Premium monatlich | 1900 · 1710 · 1520 · 1330 · 1235 |
| Premium jährlich (×10) | 19000 · 17100 · 15200 · 13300 · 12350 |

**Beträge = Brutto-Cent (inkl. 19 % MwSt)** → Stripe-Preise als *tax-inclusive* konfigurieren. B2B mit USt-IdNr. → Reverse-Charge zieht die MwSt im Checkout ab (zahlt dann netto). _Annahme: die Spec-Preise 9 €/19 € sind Brutto; falls netto gemeint, werden die Brutto-Anzeigen 10,71 €/22,61 €._

→ ersetzt `STRIPE_PRICE_BASE_*` + `STRIPE_PRICE_PROPERTY_*` durch `STRIPE_PRICE_BASIC_MONTHLY/ANNUAL`, `STRIPE_PRICE_PREMIUM_MONTHLY/ANNUAL`.
- **KI/SMS-Metered-Preise bleiben** (nur Premium), hängen als zusätzliche Items am Premium-Abo.

### Entitlements (code-definiert, zentral)
Statische Map `tier → { features:Set, limits }` in z. B. `packages/api/src/services/entitlements.ts`:
```
free:    features[calendar, channel_sync]                          limits{ listings: 2 }
basic:   + inbox, auto_messages, cleaning_calendar, auto_reviews,  limits{ listings: ∞ }
            email_alerts, groups, listing_links
premium: + ai_chatbot, dynamic_pricing, guest_sms, cleaning_sms,   limits{ listings: ∞ }
            invoices, statistics, roles, audit_log
billingExempt → premium-äquivalent, ohne Stripe-Gates/Metering-Charge
```
- `resolveAccess()` (in `plan-guard.ts`) wird von `→ ok:bool` auf `→ { tier, features, limits, ok }` erweitert.
- Neuer Helper `requireFeature(ctx, 'ai_chatbot')` → wirft `FEATURE_NOT_IN_PLAN` → UI fängt es und zeigt Upsell.
- Limit-Enforcement (z. B. Free max 2 Listings) bei Property-Create + im `billing-reconcile`.

---

## 3. Phasenplan

### Phase 0 — Fundament & Stripe-Setup *(kein User-facing Code)*
- Enum-Migration `plan → tier (free/basic/premium)` + Schema-Felder ergänzen (s. u.). Migration zuerst auf Prod.
- Stripe **Test-Mode**: 4 volumengestaffelte Abo-Preise + Einmal-Produkte + (vorhandene) Meter-Preise anlegen. Env-Vars setzen.
- **Stripe Tax** aktivieren (MwSt automatisch), USt-IdNr.-Erfassung vorbereiten.
- Neue Schema-Felder: `tenants.freeStartedAt`, `tenants.freeConvertsAt`, `tenants.defaultPaymentMethodId`; Tabelle `one_time_purchases(tenantId, product, amountCents, status, stripePaymentIntentId, fulfilledAt)`.

### Phase 1 — Entitlements-Kern *(Backend + minimale UI)*
- `entitlements.ts` (Tier-Map), `resolveAccess()` erweitern, `requireFeature`/Limit-Helper.
- Bestehende Features nach Tier gaten: Inbox/Auto-Nachrichten/Reinigung/Bewertungen (Basic), KI/Dynamic Pricing/SMS/Rechnungen/Statistiken/Rollen (Premium).
- KI-/SMS-Reconcile zusätzlich auf `tier=premium` gaten (nicht nur `*Enabled`-Booleans).
- UI: gesperrte Features ausgrauen + Upsell-Hinweis (zentrale `<UpsellGate feature=…>`-Komponente).

### Phase 2 — Neue Abo-Preise (Pro-Listing-Staffel)
- Checkout (`createCheckoutSession`) von base+property auf **Tier-Auswahl → 1 volumengestaffelter Price** umstellen; `quantity = activePropertyCount`.
- `billing-reconcile` auf die neuen Prices umstellen (Quantity-Sync bleibt).
- Settings-`BillingCard`: Tier + Intervall wählbar, aktuellen Tier/Verbrauch anzeigen.

### Phase 3 — Free-Tier + Karte + Auto-Konversion
- Free-Limit (max 2 Listings) durchsetzen; Property-Create blockt darüber mit Upsell.
- **Kartenerfassung beim Gratis-Start** via Checkout `mode:'setup'` (SetupIntent) → `defaultPaymentMethodId`. `freeStartedAt/freeConvertsAt` setzen.
- Cron `free-conversion` (täglich): fällige Free-Tenants → Basic-Abo mit gespeicherter Karte anlegen + abbuchen; Fehler → Dunning.
- **Erinnerungsmails** 30/7/1 Tage vor Abbuchung (Resend, vorhandener Notifications-Stack).
- **DE-Pflicht:** Button-Lösung „zahlungspflichtig bestellen" beim Gratis-Start, Kündigungsbutton in der App.

### Phase 4 — Einmal-Services
- Einmal-Produkte in Stripe; `one_time_purchases`-Tracking + Fulfillment-Status.
- **Order-Bump** (Checkbox im Checkout) via `subscription_data.add_invoice_items` auf die erste Rechnung.
- **1-Click-Upsell** (nach Kauf) via off-session PaymentIntent mit gespeicherter Karte.
- **„Setup gratis ab 20 Einheiten":** bei `activePropertyCount ≥ 20` Preis 0 + nur Fulfillment-Task anlegen.
- Sichtbarkeit kontextabhängig (KI-/Rechnungs-Setup nur bei Premium).

### Phase 5 — Öffentliche Landing- + Pricing-Seite *(großer Frontend-Teil)*
- `landing.tsx` neu (frontend-design-Skill): Hero → Problem → Demo → Outcomes → Proof (Founder) → Pricing → Garantie → FAQ → CTA.
- **Pricing-Cards** (Free/Basic/Premium, Premium=Bestseller) + **Ersparnis-Rechner** (Slider Einheiten → Preis).
- **DE/EN-Toggle** mit Auto-Erkennung (Browser-Sprache) → i18n-Setup im Frontend.
- Checkout-Einstieg + Order-Bump/Upsell-Flow.
- **Niemals das Backend nennen** — nur „verbunden mit Airbnb, Booking.com & 50+ Kanälen".

### Phase 6 — B2C-Recht & Feinschliff
- **Preis-Anzeige durchgängig Brutto „inkl. MwSt"** (eine Anzeige für alle). B2B-Reverse-Charge läuft im Checkout über USt-IdNr.-Eingabe + Stripe Tax (MwSt-Abzug dort), keine separate Netto-Anzeige.
- Widerrufsrecht/-verzicht bei Sofort-Freischaltung, **Kündigungsbutton**, Button-Lösung, AGB/Preisangaben.
- Stripe Tax + Rechnungs-/Invoice-History (Customer Portal genügt initial).

---

## 4. Schlüssel-Entscheidungen (meine Empfehlung)

1. **Stripe volume tiered pricing** statt eigener Rabattlogik → Mengenrabatt nativ, weniger Code. ✅
2. **Entitlements als Code-Map**, nicht als DB-Tabelle → versionierbar, einfach, eine Quelle der Wahrheit. ✅
3. **Enum auf `free/basic/premium` umstellen** (Legacy `starter/pro/enterprise` raus). ✅
4. **`billingExempt` = Premium-äquivalent ohne Charge** → dein eigener Workspace bleibt voll & kostenlos. ✅
5. **Karte beim Gratis-Start via SetupIntent** → ermöglicht Auto-Konversion + 1-Click-Upsells, reduziert Müll-Signups. ✅

---

## 5. Risiken & Recht
- **Deploy-Reihenfolge:** Migration vor Code (sonst „Katastrophe" wie bei `ota_commission_cents`).
- **Auto-Konversion ist heikel (DE/EU):** Button-Lösung + Kündigungsbutton + Erinnerungsmails sind Pflicht, nicht optional.
- **Tier-Downgrade:** Premium→Basic/Free → Daten behalten, Bearbeitung sperren (graceful degradation), nichts löschen.
- **Migration bestehender Zahler:** aktuell alle `starter` → sauber auf `basic`/`premium` mappen.

---

## 6. Entscheidungen (final)
1. **Reihenfolge:** Phasen **0→6 hintereinander**. ✅
2. **Preis-Anzeige:** durchgängig **Brutto inkl. MwSt** (B2B-Reverse-Charge im Checkout via USt-IdNr. + Stripe Tax). ✅
3. **Downgrade/Kündigung:** **Free als Auffangbecken** — Daten bleiben, nur Kalender aktiv, Bearbeitung gesperrt. ✅
4. **14-Tage-Premium-Trial bleibt** zusätzlich zum Free-Köder: direkte Tester starten mit vollem Premium-Trial (bestehender `trialEndsAt`-Mechanismus); der Gratis-Köder ist der calendar-only-Pfad mit 12-Monats-Konversion. Beide Pfade koexistieren. ✅

**→ Bauplan final. Warte auf grünes Licht zum Start von Phase 0.**
