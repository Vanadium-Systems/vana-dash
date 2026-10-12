import type { GenericMetricMapping } from './generic/types.js'

// Contractul comun al oricărei platforme conectate la vana-dash.
// Toată logica specifică unei platforme trăiește în src/connectors/<platform>/.

export interface PlatformConfig {
  id: string
  name: string
  type: string
  apiUrl: string
  /** API key decriptat — există doar în memorie în timpul sync-ului. */
  apiKey: string
  /** Doar type='generic' (conectorul le ignoră altfel) — mapările salvate pe rândul platformei. */
  metricMappings?: GenericMetricMapping[] | null
  healthPath?: string | null
}

export interface PlatformMetric {
  metricKey: string
  value: number
  unit?: string
  recordedAt: Date
  meta?: Record<string, unknown>
}

export interface PlatformHealth {
  status: 'healthy' | 'degraded' | 'down'
  latencyMs?: number
  message?: string
}

/**
 * Semnal de sănătate operațională (CPU/RAM/disk/erori/backup, NU stack traces individuale —
 * vezi PLAN.md Feature 2). `key`/`unit` sunt string/union larg, nu enum strict: platforme
 * diferite pot avea seturi de semnale diferite, FE randează generic pe label+level+value+unit.
 */
export interface PlatformOpsSignal {
  key: string
  label: string
  level: 'green' | 'yellow' | 'red'
  value: number | null
  unit: 'pct' | 'count' | 'hours' | 'queued'
  detail: string
}

export interface PlatformOpsSignals {
  generatedAt: Date
  signals: PlatformOpsSignal[]
  history: Array<{ capturedAt: Date; cpuPct: number; ramPct: number; diskPct: number }>
}

export interface PlatformConnector {
  readonly type: string
  readonly displayName: string
  fetchMetrics(config: PlatformConfig, from: Date, to: Date): Promise<PlatformMetric[]>
  checkHealth(config: PlatformConfig): Promise<PlatformHealth>
  handleWebhook?(payload: unknown): Promise<PlatformMetric[]>
  /** Opțional — doar platformele care expun un endpoint de health-signals îl implementează. */
  fetchOpsSignals?(config: PlatformConfig): Promise<PlatformOpsSignals>
}

// ── Accounting (ANAF SPV / e-Factura) ────────────────────────────────────────
// Semantică diferită de PlatformConnector: documente, nu metrici — interfață separată.

/** Sesiune ANAF: token-ul decriptat există doar în memorie pe durata call-ului. */
export interface AnafSession {
  cif: string
  accessToken: string
}

/** O factură din e-Factura — folosit atât pt. primite (contraparte=furnizor), cât și emise (contraparte=client). */
export interface AnafInvoiceDocument {
  /** Id-ul mesajului e-Factura — cheia de dedup la sync. */
  anafMessageId: string
  documentNumber: string | null
  counterpartyName: string | null
  counterpartyCif: string | null
  amount: number
  currency: string
  issuedAt: Date
  dueAt: Date | null
  /** XML-ul UBL descărcat, pentru arhivare pe disc. */
  xml: string
  /** PDF-ul vizual — din arhiva ANAF dacă a fost prezent, altfel generat via /transformare. */
  pdf: Buffer | null
  meta?: Record<string, unknown>
}

export interface SpvMessage {
  id: string
  type: string
  detail: string
  cif: string
  createdAt: Date
}

export type AnafUploadStatus = 'pending' | 'validated' | 'rejected'

export interface AccountingConnector {
  readonly type: 'anaf'
  readonly displayName: string
  /** `knownMessageIds` — mesaje deja sincronizate (financial_records.anafMessageId), SĂRITE la
   *  descărcare. Fără asta, sync-ul orar re-descarcă ZIP-ul fiecărui mesaj din fereastra de 30
   *  zile la fiecare rulare — lovește garantat limita ANAF de 10 descărcări/zi/mesaj în mai
   *  puțin de jumătate de zi (confirmat live, 2026-08-01: "S-au facut deja 10 descarcari..."). */
  fetchIncomingInvoices(session: AnafSession, from: Date, to: Date, knownMessageIds: ReadonlySet<string>): Promise<AnafInvoiceDocument[]>
  /** Facturi emise vizibile în SPV (tip 'FACTURA TRIMISA') — inclusiv cele emise prin alte canale înainte de vana-dash. */
  fetchOutgoingInvoices(session: AnafSession, from: Date, to: Date, knownMessageIds: ReadonlySet<string>): Promise<AnafInvoiceDocument[]>
  fetchSpvMessages(session: AnafSession, days: number): Promise<SpvMessage[]>
  uploadInvoice(session: AnafSession, xml: string): Promise<{ uploadId: string }>
  checkUploadStatus(session: AnafSession, uploadId: string): Promise<AnafUploadStatus>
  checkHealth(session: AnafSession): Promise<PlatformHealth>
}

// ── Bank (reconciliere) ──────────────────────────────────────────────────────

export interface BankAccountConfig {
  id: string
  provider: string
  name: string
  accountRef: string | null
  currency: string
  /** Access token decriptat — există doar în memorie în timpul sync-ului (OAuth sau static). */
  accessToken: string
}

export interface BankTransaction {
  /** Id-ul tranzacției la provider — cheia de upsert. */
  externalId: string
  /** Valoare absolută; sensul e dat de direction. */
  amount: number
  currency: string
  counterpartyName: string | null
  counterpartyIban: string | null
  reference: string | null
  valueDate: Date
  direction: 'in' | 'out'
  rawMeta?: Record<string, unknown>
}

export interface BankConnector {
  readonly type: string
  readonly displayName: string
  fetchTransactions(account: BankAccountConfig, from: Date, to: Date): Promise<BankTransaction[]>
  checkHealth(account: BankAccountConfig): Promise<PlatformHealth>
  /** Opțional — provideri cu auth dinamic (OAuth) își pregătesc access token-ul
   *  (refresh dacă e nevoie) înainte de fetchTransactions/checkHealth. Fără el,
   *  bank-sync.ts decriptează apiKeyEnc direct (provideri legacy cu token static). */
  prepareSession?(accountId: string): Promise<{ accessToken: string }>
}
