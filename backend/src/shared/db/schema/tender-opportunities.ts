import { boolean, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Monitor licitații publice (e-licitatie.ro/SICAP) — sursă externă de oportunități, NU un
// `PlatformConnector` (nu e o platformă Vanadium Systems, vezi PLAN.md „Decizie de scop"),
// deci nu intră în src/connectors/. Job dedicat în src/jobs/tender-watch-sync.ts.
export const tenderOpportunities = pgTable(
  'tender_opportunities',
  {
    ...standardColumns,
    source: text('source').notNull(), // 'direct_acquisition' | 'contract_notice'
    externalId: text('external_id').notNull(), // uniqueIdentificationCode / noticeNo
    title: text('title').notNull(),
    cpvCode: text('cpv_code'),
    cpvDescription: text('cpv_description'),
    contractingAuthority: text('contracting_authority'),
    estimatedValueRon: numeric('estimated_value_ron', { precision: 14, scale: 2 }),
    procedureType: text('procedure_type'), // sysProcedureType.text, null la achiziții directe
    stateText: text('state_text'), // sysNoticeState/sysDirectAcquisitionState.text (raw)
    isOpen: boolean('is_open').notNull(),
    publicationDate: timestamp('publication_date', { withTimezone: true }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }), // caDecisionDeadline / maxTenderReceiptDeadline
    detailUrl: text('detail_url').notNull(),
    matchedRuleId: uuid('matched_rule_id').references(() => tenderWatchRules.id),
    // Denormalizat la ingest din `tenderWatchRules.highPriority` a regulii care a potrivit
    // (job-ul are deja regula în memorie când calculează `matchedRuleId` — nu merită un join
    // la fiecare listare doar pt. un boolean). Dacă prioritatea regulii se schimbă ulterior,
    // rândurile vechi NU se recalculează retroactiv — reflectă starea de la ultima sincronizare.
    isPriority: boolean('is_priority').notNull().default(false),
    raw: jsonb('raw').notNull(), // payload complet SICAP, evită migrare pt. câmpuri noi
    // SICAP section 3 ("Informații juridice, economice, financiare și tehnice"). Only public
    // tenders (`contract_notice`) have it; direct acquisitions have no formal qualification, so
    // it is null there. Extracted from free text with a regex (`extractMinTurnoverRon`), best
    // effort: null when parsing fails, never an assumed threshold. A young company is ruled out
    // by any threshold above its own turnover; jobs/tender-watch-sync.ts compares the two.
    minTurnoverRon: numeric('min_turnover_ron', { precision: 14, scale: 2 }),
    eligibilityNote: text('eligibility_note'), // textul brut al criteriului economico-financiar, pt. verificare manuală
    // "Nu mă interesează" — filtru, nu ștergere (pattern `prospects.archivedAt`).
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idx_tender_opp_source_external').on(t.source, t.externalId),
    index('idx_tender_opp_deadline').on(t.deadlineAt),
    index('idx_tender_opp_is_open').on(t.isOpen),
  ],
)

// Reguli de match CPV/keyword, editabile din UI (nu hardcodate — pattern sprint de-hardcodare
// 2026-08-20, ca `prospect_statuses`). Validare "cel puțin unul din cpvPrefix/keyword" în
// service, nu constraint DB — pattern simplu, ca alte validări din module existente.
export const tenderWatchRules = pgTable('tender_watch_rules', {
  ...standardColumns,
  label: text('label').notNull(),
  cpvPrefix: text('cpv_prefix'), // ex. '72' — match pe prefixul cpvCode
  keyword: text('keyword'), // match case-insensitive în title/cpvDescription
  active: boolean('active').notNull().default(true),
  // Potrivirile pe o regulă de prioritate înaltă declanșează o alertă separată (critical, nu
  // doar info) și ies în evidență în UI — cerință Stefan (2026-09-14): prea mult zgomot din
  // regulile largi (CPV 72/48), vrea un semnal distinct pt. ce chiar contează.
  highPriority: boolean('high_priority').notNull().default(false),
  // Regulă de dezinteres — cerință Stefan (2026-09-15): CPV 72/48 sunt prea largi ("licență
  // Windows" x101, papetărie, mobilier), dar tot trebuie să rămână pe radar ca să nu rateze
  // ceva. O potrivire pe o regulă `exclude` NU oprește ingestul (rândul tot ajunge în DB, vezi
  // jobs/tender-watch-sync.ts), doar îl marchează `dismissedAt` la inserare — iese din lista
  // principală, dar rămâne vizibil cu „Arată arhivate", exact ca un „Nu mă interesează" manual.
  exclude: boolean('exclude').notNull().default(false),
})
