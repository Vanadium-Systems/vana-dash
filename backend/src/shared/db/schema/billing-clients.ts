import { sql } from 'drizzle-orm'
import { boolean, date, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { platforms } from './platforms.js'
import { tenantColumns } from './tenant-column.js'

export const billingClientCurrency = pgEnum('billing_client_currency', ['lei', 'eur'])
export const billingClientCycle = pgEnum('billing_client_cycle', ['monthly', 'annual'])

// Clienții către care Stefan emite facturi (clienții SaaS ai vanagreen etc.).
// Populați manual sau importați ulterior dintr-un connector.
export const billingClients = pgTable(
  'billing_clients',
  {
    ...tenantColumns,
    ...standardColumns,
    ...auditColumns,
    name: text('name').notNull(),
    // Sprint C, Track D: identificator uman-lizibil comun cu vanagreen (tenants.slug acolo).
    // Generat din name la creare, editabil o singură dată. Nullable pt. clienți vechi/nemapați
    // pre-Track D — backfill ulterior, nu constrâns NOT NULL la nivel DB încă.
    slug: text('slug'),
    cif: text('cif').notNull(),
    regCom: text('reg_com'),
    address: text('address').notNull(),
    city: text('city'),
    county: text('county'),
    country: text('country').notNull().default('RO'),
    iban: text('iban'),
    bank: text('bank'),
    email: text('email'),
    // Sprint C, Track B: mapare la un tenant din vanagreen (recyclers_app) — validată printr-un
    // apel API (verifyVanagreenTenant), nu FK cross-DB. Null = client nemapat.
    vanagreenTenantId: text('vanagreen_tenant_id'),
    // Aplicația integrată căreia îi aparține clientul (ex: VanaGreen) — determină ce
    // template-uri de factură (modules/invoicing) îi sunt disponibile la facturare. Null =
    // client nemapat la nicio platformă (facturare strict manuală, fără picker de template).
    platformId: uuid('platform_id').references(() => platforms.id),
    // Sprint C, Track D: creat automat dintr-un tenant vanagreen nou (fără mapare încă), cu
    // legal details/billing goale — "completează datele" în UI. False pt. clienți creați manual.
    needsBillingInfo: boolean('needs_billing_info').notNull().default(false),
    // Sprint tenanți demo (2026-08-03) — oglindă read-only a `tenants.is_demo` din vanagreen
    // (sursă de adevăr acolo, NU aici), sincronizată zilnic de `jobs/vanagreen-tenant-sync.ts`.
    // Un rând schelet identic celor normale (needsBillingInfo/cif/address placeholder), doar
    // afișat separat în UI ("Clienți demo") și exclus din listClients()/crons de facturare —
    // niciodată setat manual din formularul de client.
    isDemo: boolean('is_demo').notNull().default(false),
    // Informațional, oglindă `tenants.demo_ends_at` din vanagreen — reminder, nu enforced de
    // niciun cron aici (la fel ca acolo).
    demoEndsAt: date('demo_ends_at', { mode: 'string' }),
    // 2026-08-11 — oglindă `tenants.deleted_at` din vanagreen pt. un tenant reziliat
    // (`jobs/vanagreen-tenant-sync.ts`). Non-null = client în fereastra de 30 zile înainte de
    // purge local (soft-delete pe billing_clients, în ritm cu purge-cron-ul din vanagreen).
    // Afișat separat în UI ("Clienți în ștergere", ClientsTab.tsx) — exclus din
    // listClients()/listDemoClients() ca să nu se suprapună cu tab-urile normale. Curățat
    // (null) dacă tenantul reapare în vanagreen (Stefan l-a restaurat în cele 30 zile).
    pendingDeletionAt: timestamp('pending_deletion_at', { withTimezone: true, mode: 'date' }),
    // Câte luni se extinde abonamentul vanagreen la o plată confirmată pe acest client. Null =
    // nesetat încă (nu se poate extinde automat până Stefan configurează asta).
    vanagreenExtendMonths: integer('vanagreen_extend_months'),
    subscriptionPriceLei: numeric('subscription_price_lei', { precision: 12, scale: 2 }),
    subscriptionPriceEur: numeric('subscription_price_eur', { precision: 12, scale: 2 }),
    subscriptionPriceCurrency: billingClientCurrency('subscription_price_currency')
      .notNull()
      .default('lei'),
    autoInvoiceEnabled: boolean('auto_invoice_enabled').notNull().default(false),
    // Sprint C, Track D: cadență recurentă — mutată integral din vanagreen (billing-cycle.ts),
    // care renunță la calcul propriu. Null billingCycle = mod one-shot (billingDueDate setat
    // manual, nu se rostogolește automat) — la fel ca modul legacy din vanagreen dinainte.
    billingCycle: billingClientCycle('billing_cycle'),
    billingCycleDay: integer('billing_cycle_day'),
    billingCycleMonth: integer('billing_cycle_month'),
    billingDueDate: date('billing_due_date', { mode: 'string' }),
    // Excepție per client de la termenul de plată implicit (invoice_sequences.default_payment_terms_days)
    // — ex. un client are 15 zile contractual, nu 10. Null = folosește default-ul global.
    paymentTermsDays: integer('payment_terms_days'),
    billingReminder7dSentAt: timestamp('billing_reminder_7d_sent_at', { withTimezone: true, mode: 'date' }),
    billingReminder1dSentAt: timestamp('billing_reminder_1d_sent_at', { withTimezone: true, mode: 'date' }),
    billingOverdueSentAt: timestamp('billing_overdue_sent_at', { withTimezone: true, mode: 'date' }),
    // Sprint Tab Contracte (2026-08-01) — câmpuri specifice generării de contract, nu de
    // facturare (numele/CIF/adresă existente mai sus rămân sursa unică pt. facturare, nu se
    // duplică). Toate nullable — clienți existenți nu au aceste date, completate din UI la nevoie.
    contactName: text('contact_name'),
    contactTitle: text('contact_title'),
    phone: text('phone'),
    contractPlan: text('contract_plan'),
    // Restul câmpurilor contractuale (operatori, puncte de lucru, module addon, taxă inițiere
    // etc.) — text liber specific-contract, nefolosit în nicio agregare SQL, shape validat Zod
    // la service (ContractDetailsSchema în modules/contracts/schema.ts), NU la nivel DB.
    contractDetails: jsonb('contract_details'),
    // Sprint Referral discount status (2026-08-12) — reducere pending calculată o singură dată
    // la grant (maybeGrantReferralDiscount), consumată atomic la prima factură care rezolvă un
    // preț de abonament (createDraftInvoice). Toate 3 null = fără reducere pending. Suma +
    // moneda sunt ÎNTOTDEAUNA în moneda de abonament a tenantului ADUS la momentul grant-ului,
    // indiferent pe care rând (adus SAU referrer) stă — vezi PLAN §1.
    referralDiscountReferralId: text('referral_discount_referral_id'),
    referralDiscountPendingAmount: numeric('referral_discount_pending_amount', { precision: 12, scale: 2 }),
    referralDiscountPendingCurrency: billingClientCurrency('referral_discount_pending_currency'),
  },
  (table) => ({
    // Parțial: permite mai multe NULL (clienți nemapați/nebackfilled încă) cât timp valorile
    // ne-null rămân unice.
    slugUnique: uniqueIndex('idx_billing_clients_slug_unique').on(table.tenantId, table.slug).where(sql`${table.slug} IS NOT NULL`),
  }),
)
