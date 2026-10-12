import { z } from 'zod'

// Contractul apelat de recyclers_app (shared/lib/vanadash-pricing-client.ts +
// vanadash-billing-client.ts) pt. wizard-ul de self-serve signup — vezi
// .github/agents/VANAGREEN.md "Pending / în lucru" pt. istoricul deciziei. Shape FIX, definit
// acolo (alt repo, planul deja livrat) — nu se schimbă unilateral aici fără să se actualizeze
// și clientul din recyclers_app.

export const SelfServePricingCalculateSchema = z
  .object({
    workPoints: z.number().int().nonnegative(),
    desktopOperators: z.number().int().nonnegative(),
    mobileSeats: z.number().int().nonnegative(),
    // Adăugate 2026-08-04 (contract inițial nu le avea) — recyclers_app le trimite acum din
    // cardurile „Documente/lună" și „Robot SIATD — achiziții/lună" ale wizard-ului.
    documentsPerMonth: z.number().int().nonnegative(),
    siatdPurchasesPerMonth: z.number().int().nonnegative(),
    flavor: z.enum(['simple', 'deee_dba']),
    // 'accounting' adăugat 2026-08-04 — mapează la addonEfactura (singurul din cele 6 addon-uri
    // interne exclus inițial din setul self-serve, acum cu preț real configurat de Stefan).
    // 'signature_pad'/'id_scanner' adăugate 2026-08-07 (handoff din recyclers_app PLAN.md, sprint
    // "Wizard self-serve — expune signature_pad/id_scanner/cântar smart") — module F16-software,
    // preț configurat în pricing_configs din 2026-08-07 (vezi VANAGREEN.md "F16-software").
    // 'analytics'/'partner_portal' adăugate 2026-08-19 — recyclers_app livrase deja checkbox-urile
    // în wizard (grant real de entitlement) FĂRĂ ca prețul să fie reflectat aici (`.strict()`
    // respingea cheile, `toCalcInput` mai jos le hardcoda `false`) — gap de activare gratuită
    // neintenționată, semnalat din `recyclers_app/.github/agents/VANADASH.md`. Acest repo trebuie
    // să meargă ÎNAINTE de recyclers_app (același pattern ca la `cantare` mai sus) — recyclers_app
    // încă nu le trimite (`PRICED_ADDON_KEYS` de-acolo le exclude deliberat), deci un client vechi
    // care nu le trimite tot funcționează (`.strict()` nu respinge o cheie LIPSĂ, doar una necunoscută).
    // 'hr'/'ai_assistant' adăugate 2026-08-19 (F14/F13) — livrate direct cu preț configurat (nu
    // gap de activare gratuită ca analytics/partner_portal, expuse aici ȘI în recyclers_app în
    // aceeași sesiune, ordinea vana-dash-primul tot contează pt. clienți vechi în tranzit).
    addons: z.array(
      z.enum([
        'treatment',
        'pickup',
        'market_prices',
        'nexus',
        'crm',
        'accounting',
        'signature_pad',
        'id_scanner',
        'analytics',
        'partner_portal',
        'hr',
        'ai_assistant',
      ]),
    ),
    // Cântar smart (2026-08-07) — preț PER cântar conectat, câmp cantitate (nu bool, ca restul
    // addons). .default(0) OBLIGATORIU pt. compatibilitate cu deploy-ul din recyclers_app: acest
    // repo trebuie să meargă ÎNAINTE (ordinea din PLAN.md, Open Question 1) — un client vechi care
    // încă nu trimite `cantare` NU trebuie să primească 400 pe `.strict()`.
    cantare: z.number().int().nonnegative().default(0),
    // Bundle-uri (2026-08-20) — spre deosebire de `addons` mai sus, NU e un enum fix: pachetele
    // sunt definite liber de Stefan din Config preț (catalog dinamic, vezi VANAGREEN.md), deci
    // orice string e acceptat aici — un `key` care nu se potrivește niciunui pachet activ e
    // ignorat silențios la calcul (calc.ts), la fel ca un `key` de addon necunoscut. Wizard-ul
    // din recyclers_app descoperă pachetele disponibile din
    // GET /api/v1/integrations/vanagreen/pricing/bundles, nu le hardcodează. `.default(null)`
    // OBLIGATORIU: un client vechi care nu trimite deloc `bundle` nu trebuie să primească 400.
    bundle: z.string().nullable().default(null),
    // Cantități pe add-on (sprint de-hardcodare 2026-08-25) — aditiv cu default gol: recyclers_app
    // încă nu le trimite, deci lipsa = 1 pt. fiecare add-on bifat (contractul self-serve rămâne
    // neschimbat). Când wizard-ul va expune input-uri de cantitate, le va trimite aici.
    addonQuantities: z.record(z.number().int().positive()).default({}),
    includeOnboarding: z.boolean(),
  })
  .strict()
export type SelfServePricingCalculateInput = z.infer<typeof SelfServePricingCalculateSchema>

export const SelfServeBillingClientIngestSchema = z
  .object({
    vanagreenTenantId: z.string().min(1),
    companyName: z.string().min(1),
    contactEmail: z.string().email(),
    quotedMonthlyTotal: z.number().nonnegative().nullable(),
    quotedAnnualTotal: z.number().nonnegative().nullable(),
    needsBillingInfo: z.literal(true),
    autoInvoiceEnabled: z.literal(false),
  })
  .strict()
export type SelfServeBillingClientIngestBody = z.infer<typeof SelfServeBillingClientIngestSchema>
