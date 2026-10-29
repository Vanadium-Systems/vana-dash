import type { DisplayCurrency, Locale } from './locale'
export type FeatureKey = string

export interface SessionRole {
  id: string
  name: string
  kind: 'admin' | 'manager' | 'custom'
}

export interface NotificationPrefs {
  chat: 'all' | 'dm' | 'none'
  emailNew: boolean
  alerts: boolean
}

/** Răspunsul de sesiune (`/api/auth/me` și login): omul + ce poate face (PLAN.md C2). */
export interface SessionPayload {
  user: {
    id: string
    email: string
    displayName: string | null
    role: SessionRole | null
    status: 'invited' | 'active' | 'disabled'
  }
  /** Funcționalitățile efective, cu poarta paginii respectată (decizia „.view oprit"). */
  features: FeatureKey[]
  isPlatformAdmin: boolean
  /** The person's own company (not the one looked at with the override); absent in older test fixtures. */
  tenant?: { id: string; name: string; isPlatformOwner: boolean } | null
  /** Cheile cutiilor de email; `null` = toate (adminul). */
  mailboxes: string[] | null
  notificationPrefs: NotificationPrefs
  navLayout: Array<{ to: string; visible: boolean }> | null
  /** Până când a văzut omul pagina Noutăți; `null` = niciodată. */
  updatesSeenAt: string | null
  locale: Locale
  enabledLocales: Locale[]
  displayCurrency: DisplayCurrency
  displayCurrencies: DisplayCurrency[]
}

/** Sent next to totals: the currency the figures are in and whether they were converted. */
export interface MoneyMeta {
  currency: DisplayCurrency
  /** False when the figures are in RON, the currency the books are kept in. */
  converted: boolean
  rateSource: 'BNR'
  /** Another currency was asked for, but there is no rate for it: the figures are in RON. */
  fallback?: 'no_rate'
}

// modules/support — tichete către Vanadium.
export type SupportTicketStatus = 'deschis' | 'raspuns' | 'inchis'

export interface SupportTicket {
  id: string
  subject: string
  description: string
  status: SupportTicketStatus
  /** Ruta din aplicație de unde a fost deschis. */
  page: string | null
  createdAt: string
  lastActivityAt: string
  /** Necitit pentru partea care întreabă: autorul sau contul de platformă. */
  unread: boolean
  author: { id: string; name: string }
}

export interface SupportTicketReply {
  id: string
  body: string
  isPlatformReply: boolean
  createdAt: string
  author: { id: string; name: string }
}

export interface SupportTicketDetail extends SupportTicket {
  replies: SupportTicketReply[]
}

/** Numele omului în texte: `displayName`, sau emailul dacă nu are. */
export function sessionUserName(session: SessionPayload | null): string {
  if (!session) return ''
  return session.user.displayName ?? session.user.email
}

export type HealthStatus = 'unknown' | 'healthy' | 'degraded' | 'down'

export interface PlatformMetricMapping {
  metricKey: string
  unit?: string
  path: string
  kind?: 'number'
}

export interface Platform {
  id: string
  name: string
  type: string
  apiUrl: string
  syncCron: string
  healthStatus: HealthStatus
  lastSyncAt: string | null
  // doar pt. type='generic' — mapările metrică→rută editabile din UI
  metricMappings?: PlatformMetricMapping[] | null
  healthPath?: string | null
  createdAt: string
}

export interface PlatformType {
  type: string
  displayName: string
}

export interface SyncLogEntry {
  id: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  recordsSync: number
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
}

export interface MetricSummary {
  metricKey: string
  unit: string | null
  total: number
  latest: number
  latestAt: string
}

// Wave 0/1, sprint de-hardcodare (2026-08-20) — înlocuiește KPI_CARDS hardcodat din
// OverviewPage.tsx.
export interface OverviewConfig {
  visibleKpis: string[]
}

export interface SeriesPoint {
  date: string
  value: number
}

// ── Accounting Hub ───────────────────────────────────────────────────────────

export type PaymentStatus = 'unpaid' | 'partial' | 'paid'
export type AnafStatus = 'draft' | 'pending' | 'validated' | 'rejected'

export interface FinancialRecord {
  id: string
  type: 'invoice' | 'expense' | 'payment'
  direction: 'in' | 'out'
  amount: string
  currency: string
  description: string | null
  category: string | null
  issuedAt: string
  dueAt: string | null
  paidAt: string | null
  paymentStatus: PaymentStatus
  source: string
  documentNumber: string | null
  billingClientId: string | null
  counterpartyName: string | null
  counterpartyCif: string | null
  reverseChargeType: ReverseChargeType
  counterpartyCountry: string | null
  reverseChargeVatRate: string | null
  anafUploadId: string | null
  anafStatus: AnafStatus | null
  hasXml: boolean
  hasPdf: boolean
  hasAnafPdf: boolean
  createdAt: string
}

export type ReverseChargeType = 'none' | 'eu_services' | 'non_eu_services'

export interface DeclarationLine {
  recordId: string
  /** False = subscription without its real invoice yet; shown, but left out of the declaration. */
  confirmed: boolean
  reverseChargeType: Exclude<ReverseChargeType, 'none'>
  documentNumber: string
  issuedAt: string
  amountForeign: number
  currency: string
  fxRate: number
  baseRon: number
  vatRon: number
  counterpartyCountry: string | null
  counterpartyVatId: string | null
  counterpartyName: string
}

export interface DeclarationPreview {
  period: string
  lines: DeclarationLine[]
  totals: { baseRon: number; vatRon: number }
  warnings: string[]
  filing: { anafIndex: string; filedAt: string; confirmedAt: string | null } | null
}

export interface QuarterlyPackageSummary {
  quarter: string
  period: { from: string; to: string }
  invoicesIssued: number
  invoicesReceived: number
  revenueRon: number
  expensesRon: number
  unmatchedBankTransactions: number
  reverseChargeLines: number
}

export interface InvoiceLine {
  id?: string
  position: number
  description: string
  quantity: string
  unitPrice: string
  vatRate: string
}

export interface FinancialRecordDetail extends FinancialRecord {
  lines: InvoiceLine[]
}

export interface RecurringExpense {
  id: string
  description: string
  category: string | null
  amount: string
  currency: 'RON' | 'EUR' | 'USD'
  cycle: 'monthly' | 'annual'
  cycleDay: number
  cycleMonth: number | null
  nextDueDate: string
  active: boolean
  showInCalendar: boolean
  counterpartyName: string | null
  counterpartyCif: string | null
  counterpartyCountry: string | null
  reverseChargeType: 'none' | 'eu_services' | 'non_eu_services'
  reverseChargeVatRate: string | null
  autoMaterialize: boolean
}

export interface BillingClient {
  id: string
  name: string
  // Sprint C, Track D — identificator uman-lizibil comun cu vanagreen (tenants.slug acolo).
  slug: string | null
  cif: string
  regCom: string | null
  address: string
  city: string | null
  county: string | null
  country: string
  iban: string | null
  bank: string | null
  email: string | null
  // Re-scope 2026-07-18 — aplicația integrată căreia îi aparține clientul (determină ce
  // template-uri de factură sunt disponibile la facturare).
  platformId: string | null
  // Sprint C, Track B — mapare + facturare automată vanagreen.
  vanagreenTenantId: string | null
  vanagreenExtendMonths: number | null
  subscriptionPriceLei: string | null
  subscriptionPriceEur: string | null
  subscriptionPriceCurrency: 'lei' | 'eur'
  autoInvoiceEnabled: boolean
  // Sprint C, Track D — creat automat dintr-un tenant vanagreen nou, date de facturare goale.
  needsBillingInfo: boolean
  // 2026-08-03 — oglindă read-only a tenants.is_demo din vanagreen, sincronizată zilnic.
  // Afișat separat în UI (tabelul „Clienți demo"), exclus din listClients()/crons de facturare.
  isDemo: boolean
  demoEndsAt: string | null
  // 2026-08-11 — oglindă tenants.deleted_at din vanagreen; non-null = client în ștergere,
  // purjat automat local la 30 zile de la această dată (jobs/vanagreen-tenant-sync.ts).
  pendingDeletionAt: string | null
  // Sprint C, Track D — cadență recurentă, mutată integral din vanagreen.
  billingCycle: 'monthly' | 'annual' | null
  billingCycleDay: number | null
  billingCycleMonth: number | null
  billingDueDate: string | null
  // Excepție per client de la termenul de plată implicit (InvoiceSequence.defaultPaymentTermsDays).
  // Null = folosește default-ul global.
  paymentTermsDays: number | null
  // Sprint Tab Contracte (2026-08-01) — câmpuri specifice generării de contract.
  contactName: string | null
  contactTitle: string | null
  phone: string | null
  contractPlan: string | null
  contractDetails: ContractDetails | null
}

// Număr de contract ocupat în afara dash-ului (dashboard_config['contract.reservedNumbers']).
export interface ReservedContractNumber {
  number: string
  note: string
  /** YYYY-MM-DD */
  date: string
}

// modules/contracts — shape validat Zod server-side (ContractDetailsSchema), toate opționale.
export interface ContractDetails {
  nrContract?: string
  dataContract?: string
  taxaInitiere?: string
  nrZileOnboarding?: string
  facturareTip?: string
  operatoriGestiune?: string
  operatoriTeren?: string
  puncteLucru?: string
  documenteIncluse?: string
  flux?: string
  moduleAddon?: string
  /** Implicit true (nesetat = Luna Gratuită inclusă, comportamentul de dinainte). */
  areLunaGratuita?: boolean
  conditiiSpeciale?: string
}

export interface SignatureRect {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface ContractDocument {
  id: string
  billingClientId: string
  docType: 'contract' | 'anexa' | 'act_aditional'
  addendumId: string | null
  pdfStoragePath: string
  isSigned: boolean
  signedAt: string | null
  signatureRect: SignatureRect | null
  sourceDocumentId: string | null
  createdAt: string
}

export interface ContractAddendum {
  id: string
  billingClientId: string
  number: number
  issuedAt: string
  oldPriceNote: string
  newPriceNote: string
  reason: string
  effectiveDateNote: string
  temporary: boolean
  reversionNote: string | null
  createdAt: string
}

// Completare automată client din ANAF (după CIF) — vezi ClientFormDialog.
export interface AnafCompanyInfo {
  name: string
  address: { street: string | null; locality: string | null; county: string | null }
  isVatPayer: boolean
  stare: 'activ' | 'inactiv' | 'radiat'
}

// ── Sprint C, Track B — extindere abonament vanagreen ───────────────────────

export interface VanagreenTenant {
  id: string
  name: string
  slug: string | null
  cif: string | null
  billingDueDate: string | null
  billingCycle: 'monthly' | 'annual' | null
  billingCycleDay: number | null
  billingCycleMonth: number | null
}

export interface VanagreenSettings {
  autoExtendEnabled: boolean
}

// ── Track A — monitorizare server ────────────────────────────────────────────

export type SignalLevel = 'green' | 'yellow' | 'red'
export type SignalKey = 'cpu' | 'ram' | 'disk' | 'containers' | 'jobs_failed' | 'backup'

export interface HealthSignal {
  key: SignalKey
  label: string
  level: SignalLevel
  value: number | null
  unit: 'pct' | 'count' | 'hours'
  detail: string
  meta?: Record<string, unknown>
}

export interface HealthHistoryPoint {
  captured_at: string
  cpu_pct: number
  ram_pct: number
  disk_pct: number
}

export interface HostHealthSummary {
  host: string
  last_captured_at: string | null
  signals: HealthSignal[]
  history: HealthHistoryPoint[]
}

export interface HealthSignalsSummary {
  generated_at: string
  signals: HealthSignal[]
  history: HealthHistoryPoint[]
  hosts: HostHealthSummary[]
}

export interface VanagreenExtensionLogEntry {
  id: string
  billingClientId: string
  mode: 'dry_run' | 'live'
  source: 'auto_match' | 'mark_paid'
  sourceId: string
  months: number
  status: 'success' | 'failed'
  responseMessage: string | null
  createdAt: string
}

export interface InvoiceSequence {
  id: string
  key: string
  prefix: string
  separator: string
  yearFormat: 'none' | 'yy' | 'yyyy'
  padding: number
  startFrom: number
  resetOn: 'never' | 'year'
  currentValue: number
  lastResetYear: number | null
  // Termen de plată implicit (zile calendaristice de la emitere) — fallback pt. clienții fără
  // paymentTermsDays propriu (BillingClient.paymentTermsDays).
  defaultPaymentTermsDays: number
}

export interface SpvMessage {
  id: string
  type: string
  detail: string
  cif: string
  createdAt: string
  saved: boolean
}

export interface AnafStatusInfo {
  cif: string | null
  status: 'unconfigured' | 'active' | 'needs_reauth'
  certAlias: string | null
  expiresAt: string | null
  lastRefreshedAt: string | null
  oauthConfigured: boolean
}

export type BankAuthStatus = 'unconfigured' | 'active' | 'needs_reauth'

export interface BankAccount {
  id: string
  provider: string
  name: string
  accountRef: string | null
  currency: string
  lastSyncAt: string | null
  healthStatus: HealthStatus
  createdAt: string
  // OAuth2 + JWT client assertion (Revolut) — null/'unconfigured' pt. provideri pe API key static.
  authStatus: BankAuthStatus
  tokenExpiresAt: string | null
  lastRefreshedAt: string | null
  clientId: string | null
  /** Certificatul public (PEM) — nu e secret, de descărcat și urcat manual în Revolut. */
  certificatePem: string | null
}

export interface BankProvider {
  type: string
  displayName: string
}

export interface TransactionMatch {
  id: string | null
  financialRecordId: string | null
  matchType: 'auto' | 'manual' | null
  confidence: string | null
  documentNumber: string | null
}

export interface BankTransactionRow {
  id: string
  bankAccountId: string
  amount: string
  currency: string
  counterpartyName: string | null
  counterpartyIban: string | null
  reference: string | null
  valueDate: string
  direction: 'in' | 'out'
  match: TransactionMatch | null
}

export interface OpenInvoice {
  id: string
  documentNumber: string | null
  counterpartyName: string | null
  amount: string
  currency: string
  issuedAt: string
  paymentStatus: PaymentStatus
}

// ── Financials ───────────────────────────────────────────────────────────────

export interface PnlByMonth {
  month: string
  direction: 'in' | 'out'
  paymentStatus: PaymentStatus
  total: number
}

export interface PnlByCategory {
  category: string
  direction: 'in' | 'out'
  paymentStatus: PaymentStatus
  total: number
}

export interface PnlResponse {
  byMonth: PnlByMonth[]
  byCategory: PnlByCategory[]
}

export interface CashflowEntry {
  direction: 'in' | 'out'
  paymentStatus: PaymentStatus
  total: number
  count: number
}

// Sprint D, Track 2 — istoric curs BNR.
export interface ExchangeRatePoint {
  date: string
  rate: string
}

// Sprint D, Track 3 — template-uri de facturi per PLATFORMĂ (re-scope 2026-07-18): 2-3
// template-uri per aplicație integrată, reutilizate de toți clienții ei.
export interface InvoiceTemplateLine {
  description: string
  quantity: number
  // 'fixed' = unitPrice de mai jos; 'client_subscription' = preț luat din abonamentul curent
  // al clientului la generarea facturii (unitPrice rămâne null în template).
  priceSource: 'fixed' | 'client_subscription'
  unitPrice: number | null
  vatRatePct: number
}

export interface InvoiceTemplate {
  id: string
  platformId: string
  name: string
  currency: 'RON' | 'EUR' | 'USD'
  lineItems: InvoiceTemplateLine[]
  isDefaultForAutoInvoice: boolean
  createdAt: string
  updatedAt: string
}

// Sprint D, Track 4 — calculator de preț modular per platformă.
export interface PricingDocumentBand {
  upTo: number | null
  rate: number | null
}

export interface PricingPuncteBand {
  max: number | null
  mult: number
  label: string
  planName?: string
}

export interface PricingEquipmentItem {
  id: string
  name: string
  purchasePrice: number
  integrationPrice: number
  monthlyFee: number
}

// Wave 0/1, sprint de-hardcodare (2026-08-20) — catalog generic, editabil din UI (Config preț),
// înlocuiește cele 12 câmpuri `addon*Price` fixe.
// Benzi pe cantitate (2026-08-25): opțional — cantitatea cade într-o treaptă, total =
// cantitate × unitPrice. Fără benzi = preț fix.
export interface PricingAddonBand {
  upTo: number | null
  unitPrice: number
}

export interface PricingAddon {
  key: string
  label: string
  price: number
  bands?: PricingAddonBand[]
}

// Bundle-uri de add-on-uri la preț fix (2026-08-20) — `addonKeys` referă `key`-uri din
// `PricingConfig['addons']`.
export interface PricingBundle {
  key: string
  label: string
  addonKeys: string[]
  price: number
  // Preset opțional pt. calculatorul manual (2026-08-20) — vezi PricingBundleSchema (backend).
  puncteLucru?: number
  operatoriDesktop?: number
  operatoriMobil?: number
  documente?: number
  cantare?: number
  onboardingPrice: number
}

export interface PricingConfig {
  basePrice: number
  operatorDesktopRate: number
  operatorMobilRate: number
  documenteIncluse: number
  documentBands: PricingDocumentBand[]
  fluxDeeeDelta: number
  addons: PricingAddon[]
  bundles: PricingBundle[]
  cantarRate: number
  cantarSetupPrice: number
  siatdFloorPrice: number
  siatdFloorUnits: number
  siatdUnitPrice: number
  lunileAnuale: number
  puncteBands: PricingPuncteBand[]
  onboardingBase: number
  onboardingOpRate: number
  onboardingDeeeDelta: number
  onboardingSiatdSetup: number
  equipmentItems: PricingEquipmentItem[]
}

export interface PricingConfigRow {
  platformId: string
  config: PricingConfig
}

export interface PricingCalculateInput {
  platformId: string
  flux: 'standard' | 'deee'
  opDesktop: number
  opMobil: number
  puncte: number
  documente: number
  siatd: number
  selectedEquipmentIds: string[]
  selectedAddonKeys: string[]
  selectedBundleKey: string | null
  // Cantități pt. add-on-urile cu benzi (2026-08-25); lipsa = 1. Add-on-urile fără benzi o ignoră.
  addonQuantities?: Record<string, number>
  cantare: number
}

export interface PricingBreakdownRow {
  label: string
  value: number
}

export interface PricingResult {
  totalMonthly: number
  totalAnnual: number
  onboardingTotal: number
  manualReviewNeeded: boolean
  planName: string | null
  breakdown: PricingBreakdownRow[]
}

// ── Email module ────────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  createdAt: string
  updatedAt: string
}

export type EmailSendStatus = 'sent' | 'delivered' | 'bounced' | 'complained' | 'delayed' | 'failed'
// Cheia unei identități din Setări Email: 'stefan', 'contact', 'outreach' (cu plafon de
// warm-up propriu) sau orice identitate adăugată de acolo (ex. 'sales').
export type EmailFromKey = string

export interface SendQuotaUsage {
  today: number
  month: number
  dailyLimit: number
  monthlyLimit: number
}

export interface SuppressionsOverview {
  unsubscribed: { email: string; unsubscribedAt: string }[]
  autoUnsubscribed: { email: string; unsubscribedAt: string; source: 'bounce' | 'complaint' }[]
  bounced: { recipient: string; lastBouncedAt: string; count: number }[]
}

export interface EmailSend {
  id: string
  templateId: string | null
  recipient: string
  fromAddress: string | null
  subject: string
  bodyText: string | null
  bodyHtml: string | null
  status: EmailSendStatus
  errorMessage: string | null
  batchId: string | null
  createdAt: string
  // 2026-08-11 — engagement (webhook Resend email.opened/email.clicked) — agregat, nu log
  // per-eveniment. openedAt/clickedAt = prima apariție, count-urile cresc la fiecare eveniment.
  openedAt: string | null
  openCount: number
  clickedAt: string | null
  clickCount: number
  lastClickedUrl: string | null
  // 2026-08-11 — cross-referențiat cu email_suppressions în listSends (service.ts), ca Stefan
  // să vadă direct cine s-a dezabonat, fără să verifice manual în DB.
  isSuppressed: boolean
}

// Raport pe filtrele din SentTab.tsx (sursă/secvență/perioadă) — /api/email/sends/report.
// `replied`/`replyRate` există doar unde are sens conceptul (totaluri + pe secvență) — un
// send de bulk/manual n-are enrollment, deci n-are cum să aibă status 'replied'.
export interface EmailSendsReportTotals {
  sent: number
  delivered: number
  bounced: number
  complained: number
  failed: number
  opened: number
  clicked: number
  unsubscribed: number
  replied: number
  openRate: number
  clickRate: number
  replyRate: number
}

export interface EmailSendsReportBreakdownRow {
  sent: number
  opened: number
  clicked: number
  openRate: number
  clickRate: number
}

export interface EmailSendsSequenceBreakdownRow extends EmailSendsReportBreakdownRow {
  sequenceId: string
  sequenceName: string
  replied: number
  replyRate: number
}

export interface EmailSendsReport {
  totals: EmailSendsReportTotals
  bySequence: EmailSendsSequenceBreakdownRow[]
  byTemplate: (EmailSendsReportBreakdownRow & { templateId: string; templateName: string })[]
}

export interface BulkSendResult {
  sent: number
  skipped: number
  // 2026-08-11 — sărite pt. că adresa e dezabonată (email_suppressions), separat de `skipped`
  // (deja trimis anterior — dedup).
  suppressed: number
  failed: number
  results: EmailSend[]
  skippedRecipients: string[]
  suppressedRecipients: string[]
  // 2026-08-12 — plafonul zilnic de warm-up (identitatea outreach) a fost atins în timpul
  // batch-ului; restul destinatarilor NU au fost trimiși. Mereu gol pt. from !== 'outreach'.
  capBlockedRecipients: string[]
}

// ── Secvențe outreach (drip automat, 2026-08-12) ─────────────────────────────

export interface EmailSequenceStep {
  id: string
  sequenceId: string
  stepOrder: number
  templateId: string
  delayDays: number
}

export type EmailSequenceEnrollmentStatus = 'active' | 'replied' | 'unsubscribed' | 'completed' | 'failed'

export interface EmailSequenceEnrollment {
  id: string
  sequenceId: string
  prospectId: string | null
  recipientEmail: string
  recipientName: string | null
  currentStep: number
  status: EmailSequenceEnrollmentStatus
  consecutiveFailures: number
  nextSendAt: string
  enrolledAt: string
  lastSentAt: string | null
}

export interface EmailSequence {
  id: string
  name: string
  fromIdentity: EmailFromKey
  active: boolean
  steps: EmailSequenceStep[]
  createdAt: string
  updatedAt: string
}

export interface EnrollResult {
  enrolled: number
  alreadyEnrolled: string[]
}

export interface SequenceStats {
  total: number
  byStatus: Record<EmailSequenceEnrollmentStatus, number>
  byStep: { step: number; label: string; count: number }[]
}

export type EmailFolder = 'inbox' | 'archive' | 'trash' | 'spam'

export interface EmailThread {
  id: string
  subject: string
  participants: string[]
  lastMessageAt: string
  createdAt: string
  // Rezumat al mesajului reprezentativ (cel mai recent primit, sau cel mai recent trimis dacă
  // threadul n-are niciun mesaj primit încă) — pt. randare listă fără fetch per thread.
  latestMessageId: string | null
  fromAddress: string | null
  toAddress: string | null
  isRead: boolean
  isStarred: boolean
  folder: EmailFolder | null
  hasAttachment: boolean
  attachmentNames: string[]
}

export interface EmailAttachmentMeta {
  id: string
  messageId: string
  filename: string
  contentType: string | null
  contentId: string | null
  disposition: 'attachment' | 'inline' | null
}

export interface EmailMessage {
  id: string
  threadId: string
  direction: 'in' | 'out'
  resendEmailId: string | null
  fromAddress: string
  toAddress: string
  subject: string
  bodyText: string | null
  bodyHtml: string | null
  receivedAt: string | null
  createdAt: string
  isRead: boolean
  isStarred: boolean
  folder: EmailFolder
  snoozedUntil: string | null
  labelId: string | null
  forwardOfMessageId: string | null
  /** Cine a trimis mesajul, pe o cutie comună („Trimis de Ana"). `null` = mesaj vechi. */
  sentByUserId: string | null
  attachments: EmailAttachmentMeta[]
}

export interface EmailUnreadCounts {
  inbox: number
  spam: number
  total: number
}

export interface EmailLabel {
  id: string
  name: string
  color: string | null
  notificationsEnabled: boolean
}

export type EmailRuleMatchType = 'from_address' | 'from_domain' | 'subject_contains'
export type EmailRuleAction = 'label' | 'archive' | 'trash' | 'spam'

export interface EmailRule {
  id: string
  matchType: EmailRuleMatchType
  matchValue: string
  action: EmailRuleAction
  labelId: string | null
  createdAt: string
}

export interface EmailBlocklistEntry {
  id: string
  address: string
  createdAt: string
}

export interface EmailDraftAttachment {
  filename: string
  storagePath: string
}

export interface EmailDraft {
  id: string
  fromKey: EmailFromKey
  to: string
  subject: string
  body: string
  templateId: string | null
  attachments: EmailDraftAttachment[]
  updatedAt: string
}

export interface EmailIdentity {
  key: string
  label: string
  fromAddress: string
}

export interface EmailSettings {
  /** Semnătură per identitate de trimitire, `<identityKey>` → HTML. Șirul gol = fără semnătură. */
  signatures: Record<string, string>
  logoUrl: string | null
  autoSpamEnabled: boolean
  spamThreshold: number
  spamKeywords: string[]
  outreachDailyCap: number
  outreachSendHour: number
  outreachSendWeekdaysOnly: boolean
  identities?: EmailIdentity[] | null
  autoLoadImages?: boolean
}

/** `GET /api/email/sender-options`: only the person's own mailboxes and their signatures. */
export interface EmailSenderOptions {
  identities: EmailIdentity[]
  signatures: Record<string, string>
  logoUrl: string | null
  autoLoadImages: boolean
}

export interface ArchiveFolder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  fileCount: number
  subfolderCount: number
  autoMonthlySubfolders: boolean
  ownerUserId: string
  level: AccessLevel
  /** Proprietarul sau adminul — doar ei văd „Partajează". */
  canShare: boolean
}

export type AccessLevel = 'view' | 'edit'

export interface ArchiveFolderPath {
  path: ArchiveFolderPathEntry[]
  level: AccessLevel
  canShare: boolean
  ownerUserId: string
  ownerName: string
}

export interface ArchiveSpaceEntry {
  id: string
  name: string
  kind: 'own' | 'shared' | 'space'
  level: AccessLevel
  ownerUserId: string
  ownerName: string
}

export interface ArchiveSpaces {
  own: { id: string; name: string } | null
  shared: ArchiveSpaceEntry[]
  /** Null dacă omul nu administrează spațiile. */
  spaces: ArchiveSpaceEntry[] | null
}

export interface AccessShare {
  id: string
  userId: string
  level: AccessLevel
  displayName: string | null
  email: string
}

export interface StorageUsage {
  usedBytes: number
  limitBytes: number
}

export interface ArchiveFolderPathEntry {
  id: string
  name: string
}

export interface ArchiveFile {
  id: string
  folderId: string | null
  name: string
  mimeType: string
  sizeBytes: number
  r2Key: string
  tags: string[]
  createdAt: string
  previewUrl: string | null
}

export interface ArchiveSearchResult {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  tags: string[]
  folderId: string | null
  folderPath: { id: string; name: string }[]
  previewUrl: string | null
}

export interface ArchiveDownloadUrl {
  url: string
  expiresAt: string
}

export interface CalendarEvent {
  id: string
  title: string
  description: string | null
  location: string | null
  startAt: string
  endAt: string
  allDay: boolean
  recurrenceRule: string | null
  recurrenceEndAt: string | null
  color: string | null
  reminderMinutesBefore: number | null
  reminderSentAt: string | null
}

export interface CalendarOccurrence {
  eventId: string
  // 'expense' = ocurență virtuală generată din recurring_expenses (Accounting), nu un rând real
  // în calendar_events — needitabilă din formularul de eveniment, vezi CalendarPage.tsx.
  kind: 'event' | 'expense'
  // 'booking' = creat de o programare de pe vanadium.systems (modules/booking).
  source: 'manual' | 'booking'
  title: string
  description: string | null
  location: string | null
  allDay: boolean
  color: string | null
  isRecurring: boolean
  recurrenceRule: string | null
  recurrenceEndAt: string | null
  occurrenceStart: string
  occurrenceEnd: string
  reminderMinutesBefore: number | null
  /** Null pe cheltuielile recurente: sunt ale firmei, nu au calendar. */
  ownerUserId: string | null
  ownerName: string | null
  attendees: { id: string; name: string }[]
  isCommon: boolean
  access: 'owner' | 'edit' | 'view' | null
}

export interface CalendarLayer {
  userId: string
  name: string
  level: AccessLevel
  owner: boolean
}

export interface CalendarsPayload {
  mine: CalendarLayer[]
  given: (AccessShare & { ours: boolean })[]
  members: { id: string; displayName: string | null; email: string }[]
}

// ── Notițe ───────────────────────────────────────────────────────────────────

export interface Note {
  id: string
  title: string
  body: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

// ── Wishlist ─────────────────────────────────────────────────────────────────

export type WishlistCategory = 'necesitate' | 'placere'
export type WishlistScope = 'personal' | 'firma'
export type WishlistPriority = 'low' | 'medium' | 'high'

export interface WishlistItem {
  id: string
  title: string
  category: WishlistCategory
  scope: WishlistScope
  priority: WishlistPriority
  estimatedPrice: string | null
  currency: string
  link: string | null
  purchased: boolean
  purchasedAt: string | null
  financialRecordId: string | null
  createdAt: string
}

export interface WishlistTotal {
  scope: WishlistScope
  category: WishlistCategory
  total: number
}

export interface WishlistResponse {
  items: WishlistItem[]
  totals: WishlistTotal[]
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export type PlanScope = 'personal' | 'firma'
export type PlanThresholdType = 'manual' | 'mrr_ron'
export type PlanGoalStatus = 'locked' | 'available' | 'completed'
export type PlanTargetPriceCurrency = 'RON' | 'EUR'

export interface PlanGoal {
  id: string
  scope: PlanScope
  tier: number
  position: number
  title: string
  note: string | null
  thresholdType: PlanThresholdType
  thresholdValue: string | null
  monthlyCostRon: string | null
  targetPriceAmount: string | null
  targetPriceCurrency: PlanTargetPriceCurrency | null
  targetDate: string | null
  completedAt: string | null
  status: PlanGoalStatus
}

export interface PlanResponse {
  personal: PlanGoal[]
  firma: PlanGoal[]
  mrrRon: number
}

// ── Platform ops signals (Feature 2, sănătate operațională per platformă) ────

export interface PlatformOpsSignal {
  key: string
  label: string
  level: SignalLevel
  value: number | null
  unit: 'pct' | 'count' | 'hours' | 'queued'
  detail: string
}

export interface PlatformOpsHistoryPoint {
  capturedAt: string
  cpuPct: number
  ramPct: number
  diskPct: number
}

export interface PlatformOpsSignalsResponse {
  supported: boolean
  generatedAt?: string
  signals: PlatformOpsSignal[]
  history: PlatformOpsHistoryPoint[]
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertCondition = 'lt' | 'lte' | 'gt' | 'gte'

export interface AlertRule {
  id: string
  name: string
  metricKey: string
  condition: AlertCondition
  threshold: string
  windowHours: number
  severity: AlertSeverity
  platformId: string | null
  enabled: boolean
  createdAt: string
}

export interface AlertInstance {
  id: string
  ruleId: string
  ruleName: string
  severity: AlertSeverity
  message: string
  triggeredAt: string
  acknowledgedAt: string | null
  snoozedUntil: string | null
}

export interface AlertRuleTestResult {
  value: number
  triggered: boolean
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface MrrTrendClientPoint {
  month: string
  metricKey: string
  value: number
}

export interface MrrTrendResponse {
  clientsByMonth: MrrTrendClientPoint[]
  /** `mrrDisplay` is the MRR in the display currency of the person (see `money` on the response). */
  currentMrr: { mrrLei: number; mrrEur: number; mrrDisplay: number }
}

export interface PnlTotals {
  revenue: number
  expense: number
  net: number
}

export interface PeriodComparisonResponse {
  periodA: PnlTotals
  periodB: PnlTotals
}

export interface ExpenseBreakdownTrendPoint {
  month: string
  category: string
  total: number
}

export interface MonthlySnapshot {
  month: string
  revenue: number
  expense: number
  net: number
  mrr: { mrrLei: number; mrrEur: number; mrrDisplay: number }
  topExpenseCategories: Array<{ category: string; total: number }>
  alertsTriggered: number
  syncSuccessRate: number
}

// Wave 0/1, sprint de-hardcodare (2026-08-20) — mirror `STATUS_COLOR_TOKENS`
// (backend/src/modules/prospects/schema.ts). Paletă fixă — clasele Tailwind complete trebuie
// să existe static în sursă pt. JIT purge (vezi COLOR_TOKEN_CLASSES în ProspectareTab.tsx).
export const STATUS_COLOR_TOKENS = ['slate', 'gray', 'red', 'orange', 'amber', 'emerald', 'cyan', 'blue', 'purple', 'indigo'] as const
export type StatusColorToken = (typeof STATUS_COLOR_TOKENS)[number]

// Catalog de statusuri prospect, editabil din UI — înlocuiește STATUS_OPTIONS/STATUS_LABELS/
// STATUS_COLORS hardcodate (`prospect_statuses`, sursă de adevăr acum în DB).
export interface ProspectStatusEntry {
  id: string
  key: string
  label: string
  colorToken: StatusColorToken
  sortOrder: number
  isDefault: boolean
}

export type ProspectPriority = 'HOT' | 'WARM' | 'NURTURE' | 'SKIP'

export interface Prospect {
  id: string
  name: string
  cif: string | null
  phone: string | null
  email: string | null
  website: string | null
  contactName: string | null
  caenCode: string | null
  foundingYear: number | null
  employeeCount: number | null
  revenue: string | null
  profit: string | null
  debt: string | null
  equity: string | null
  cash: string | null
  receivables: string | null
  inventory: string | null
  score: string | null
  priority: ProspectPriority
  status: string
  contactedBy: string | null
  notes: string | null
  source: string | null
  platformId: string | null
  billingClientId: string | null
  lastContactedAt: string | null
  archivedAt: string | null
  assignedUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface ProspectAssignee {
  id: string
  displayName: string | null
  email: string
}

export interface ProspectScoringConfig {
  id: string
  budgetWeight: string
  needWeight: string
  techWeight: string
  contactWeight: string
  hotThreshold: string
  warmThreshold: string
  nurtureThreshold: string
}

export interface ProspectImportResult {
  imported: number
  updated: number
}

export type TenderSource = 'direct_acquisition' | 'contract_notice'

export interface TenderOpportunity {
  id: string
  source: TenderSource
  externalId: string
  title: string
  cpvCode: string | null
  cpvDescription: string | null
  contractingAuthority: string | null
  estimatedValueRon: string | null
  procedureType: string | null
  stateText: string | null
  isOpen: boolean
  publicationDate: string | null
  deadlineAt: string | null
  detailUrl: string
  matchedRuleId: string | null
  isPriority: boolean
  minTurnoverRon: string | null
  eligibilityNote: string | null
  dismissedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TenderWatchRule {
  id: string
  label: string
  cpvPrefix: string | null
  keyword: string | null
  active: boolean
  highPriority: boolean
  exclude: boolean
  createdAt: string
  updatedAt: string
}

// ── Programări publice (docs/BOOKING.md) ─────────────────────────────────────

export interface BookingWindow {
  weekday: number
  start: string
  end: string
}

export interface BookingSettings {
  enabled: boolean
  durationMin: number
  bufferMin: number
  minNoticeHours: number
  horizonDays: number
  weekly: BookingWindow[]
}

export interface BookingBlock {
  id: string
  startAt: string
  endAt: string
  reason: string | null
}

export interface BookingSummary {
  id: string
  calendarEventId: string | null
  start: string
  end: string
  // null după purjarea de la 90 de zile
  name: string | null
  email: string | null
  company: string | null
  topic: string | null
  status: 'confirmed' | 'cancelled'
  createdAt: string
}

export interface BookingSlots {
  timezone: string
  durationMin: number
  slots: Array<{ start: string; end: string }>
}

// ── Mesaje (PLAN.md C3) ───────────────────────────────────────────────────────────────

export interface ChatAttachment {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
}

export interface ChatMember {
  id: string
  displayName: string | null
  email: string
  presence: 'online' | 'away'
  lastSeenAt: string | null
}

export interface ChatMessage {
  id: string
  conversationId: string
  authorUserId: string
  authorName: string
  body: string
  clientId: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  attachments: ChatAttachment[]
}

/** How far another member has got, for the ticks on your own messages. */
export interface ChatReceipt {
  userId: string
  deliveredUpTo: string | null
  readUpTo: string | null
}

export interface ChatConversation {
  id: string
  kind: 'dm' | 'group'
  name: string | null
  members: ChatMember[]
  lastMessage: { body: string; authorId: string; createdAt: string } | null
  unreadCount: number
  muted: boolean
}

export type ChatStreamEvent =
  | { type: 'message.created'; conversationId: string; message: ChatMessage }
  | { type: 'message.updated'; conversationId: string; message: Partial<ChatMessage> & { id: string } }
  | { type: 'conversation.updated'; conversationId: string }
  | { type: 'read'; conversationId: string; userId: string; messageId: string }
  | { type: 'delivered'; conversationId: string; userId: string; at: string }
  | { type: 'presence'; userId: string; presence: 'online' | 'away'; lastSeenAt: string | null }
