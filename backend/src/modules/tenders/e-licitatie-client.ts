import type { tenderWatchRules } from '../../shared/db/schema/index.js'
import type { NormalizedTenderRow } from './types.js'
import { tr } from '../../shared/lib/i18n.js'

// Client pt. cele două endpoint-uri interne SICAP (e-licitatie.ro), nedocumentate oficial —
// research complet în PLAN.md. Fără autentificare, dar Referer/Origin/User-Agent obligatorii
// (altfel 403 "Referrer cannot be null").
const BASE_URL = 'https://www.e-licitatie.ro'
const FETCH_TIMEOUT_MS = 15_000
const PAGE_SIZE = 100
// Plasă de siguranță pe paginare — nu presupunem un cap fix. Verificat empiric (2026-09-15):
// licitații publice „În desfășurare" pe fereastra implicită de 30 zile ≈ 1965 (20 pagini), DA
// „Ofertare" ≈ 2000; 30 de pagini lasă marjă fără să crească nejustificat durata sync-ului.
const MAX_PAGES = 30

// ── Reguli de trafic spre SICAP ───────────────────────────────────────────
// IP-ul serverului de producție a fost banat de SICAP pe 2026-09-15 și deblocat de ANAP pe
// 2026-09-25 cu avertisment explicit: „103 sesiuni anonime în 5 min, vârf 61/secundă". O a doua
// banare nu mai e garantat reversibilă, deci TOATE request-urile spre e-licitatie.ro trec prin
// `sicapFetch` de mai jos, care impune:
//   - un singur request în zbor, oricâte surse rulează în paralel (coadă globală);
//   - minim MIN_REQUEST_INTERVAL_MS între request-uri → max. ~75 în orice fereastră de 5 min;
//   - plafon de MAX_REQUESTS_PER_RUN pe rulare, după care ne oprim cu ce avem;
//   - cookie-urile primite sunt retrimise, ca o rulare să fie O sesiune, nu câte una per request;
//   - la primul 403/429 nu mai trimitem nimic până la rularea următoare (vezi și kill-switch-ul
//     automat din jobs/tender-watch-sync.ts).
// Nu scădea intervalul și nu crește plafonul fără să refaci calculul de mai sus.
const MIN_REQUEST_INTERVAL_MS = 4_000
const MAX_REQUESTS_PER_RUN = 70
// Din plafon, atâtea rămân rezervate verificărilor de eligibilitate (Secțiunea 3) — paginarea
// se oprește înainte să le consume.
const ELIGIBILITY_RESERVE = 20

export class SicapBlockedError extends Error {}

let requestQueue: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0
let requestsThisRun = 0
let blockedStatus: number | null = null
const sessionCookies = new Map<string, string>()

/** Resetează plafonul, sesiunea și starea de blocaj — apelat o dată la începutul fiecărei rulări. */
export function beginSicapRun(): void {
  requestsThisRun = 0
  blockedStatus = null
  sessionCookies.clear()
}

export function sicapBlockedStatus(): number | null {
  return blockedStatus
}

function hasRequestBudget(reserve = 0): boolean {
  return requestsThisRun < MAX_REQUESTS_PER_RUN - reserve
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sicapFetch(path: string, init: { method: 'GET' | 'POST'; referer: string; body?: string }): Promise<Response> {
  const run = requestQueue.then(async () => {
    if (blockedStatus !== null) throw new SicapBlockedError(tr('errors.tenders.alreadyBlocked', { blockedStatus }))
    if (!hasRequestBudget()) throw new Error(tr('errors.tenders.requestCap', { MAX_REQUESTS_PER_RUN }))
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    requestsThisRun++
    try {
      const cookie = [...sessionCookies].map(([name, value]) => `${name}=${value}`).join('; ')
      const res = await fetch(`${BASE_URL}${path}`, {
        method: init.method,
        headers: { ...COMMON_HEADERS, Referer: init.referer, ...(cookie ? { Cookie: cookie } : {}) },
        body: init.body,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      for (const header of res.headers.getSetCookie()) {
        const pair = header.split(';', 1)[0]!
        const eq = pair.indexOf('=')
        if (eq > 0) sessionCookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
      }
      if (res.status === 403 || res.status === 429) {
        blockedStatus = res.status
        throw new SicapBlockedError(tr('errors.tenders.httpBlocked', { status: res.status, path }))
      }
      if (!res.ok) throw new Error(tr('errors.tenders.http', { status: res.status, path }))
      return res
    } finally {
      lastRequestAt = Date.now()
    }
  })
  requestQueue = run.catch(() => undefined)
  return run
}

const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  Origin: BASE_URL,
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
}

type TenderWatchRuleRow = typeof tenderWatchRules.$inferSelect

interface DirectAcquisitionApiItem {
  directAcquisitionId: number
  directAcquisitionName: string
  sysDirectAcquisitionState: { id: number; text: string }
  uniqueIdentificationCode: string
  cpvCode: string | null
  publicationDate: string | null
  caDecisionDeadline: string | null
  contractingAuthority: string | null
  estimatedValueRon: number | null
}

interface ContractNoticeApiItem {
  cNoticeId: number
  noticeNo: string
  sysNoticeState: { id: number; text: string }
  sysProcedureState: { id: number; text: string }
  sysNoticeVersionId: number
  sysNoticeTypeId: number
  contractingAuthorityNameAndFN: string | null
  contractTitle: string
  sysProcedureType: { id: number; text: string } | null
  cpvCodeAndName: string | null
  estimatedValueRon: number | null
  noticeStateDate: string | null
  maxTenderReceiptDeadline: string | null
}

// GetCNoticeListFiltered nu întoarce doar "licitații publice" clasice (sysNoticeTypeId 2) —
// vin amestecate și anunțuri simplificate (17), de participare (7), de concurs (6) etc., iar
// fiecare tip are alt slug de rută publică pe e-licitatie.ro (confirmat din app-pub.js,
// `navigateToView`/`sys.pub.routes.*`) — un URL construit cu slug-ul greșit cade pe fallback-ul
// de listă goală, nu pe 404, deci greșeala trece neobservată dacă nu verifici manual linkul.
const NOTICE_TYPE_SLUG: Record<number, string> = {
  2: 'c-notice', // Licitație deschisă/restrânsă, procedură simplificată clasică
  6: 'dc-notice', // Concurs de soluții
  7: 'pc-notice', // Anunț de participare (sistem calificare)
  12: 'rfq-invitation', // Invitație RFQ
  17: 'simplified-notice', // Anunț simplificat (SCN)
}

function buildContractNoticeDetailUrl(item: ContractNoticeApiItem): string {
  const slug = NOTICE_TYPE_SLUG[item.sysNoticeTypeId] ?? 'c-notice'
  return `${BASE_URL}/pub/notices/${slug}/v${item.sysNoticeVersionId}/view/${item.cNoticeId}`
}

interface ListResponse<T> {
  total: number
  items: T[]
  searchTooLong?: boolean
}

async function postJson<T>(path: string, referer: string, body: unknown): Promise<ListResponse<T>> {
  const res = await sicapFetch(path, { method: 'POST', referer, body: JSON.stringify(body) })
  return (await res.json()) as ListResponse<T>
}

interface Section3ViewResponse {
  efCriteria: string | null // titlul criteriului economico-financiar (ex. "Cifră de afaceri medie anuală")
  efCriteriaMin: string | null // textul liber cu pragul minim cerut — aici stă cifra
  tpCriteriaQAStandardMin: string | null // experiență similară minimă cerută (text liber, nu parsăm încă)
}

async function getJson<T>(path: string, referer: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]))
  const res = await sicapFetch(`${path}?${qs}`, { method: 'GET', referer })
  return (await res.json()) as T
}

/**
 * Cifra de afaceri minimă cerută, din text liber SEAP — tipic „...mai mare sau egală cu
 * 2.700.000,00 Lei". Ia cea mai mare valoare RON găsită lângă „lei"/"RON"; restul numerelor din
 * text (ani, articole de lege) nu au sufixul monetar, deci nu se potrivesc din greșeală.
 * Best-effort — dacă formatul textului diferă și regexul nu prinde nimic, întoarce null (NU
 * presupunem un prag doar pt. că textul există).
 */
export function extractMinTurnoverRon(text: string): number | null {
  const matches = [...text.matchAll(/([\d.]{4,}(?:,\d{2})?)\s*(?:lei|ron)\b/gi)]
  if (matches.length === 0) return null
  const values = matches.map((m) => Number(m[1]!.replace(/\./g, '').replace(',', '.')))
  return Math.max(...values)
}

/**
 * Secțiunea 3 ("Informații juridice, economice, financiare și tehnice") — DOAR pt. licitații
 * publice (`contract_notice`); achizițiile directe nu au proceduri formale de calificare, deci
 * n-are sens să interogăm. Un eșec de fetch/parsare pt. UN anunț nu oprește sincronizarea
 * întreagă — apelantul (jobs/tender-watch-sync.ts) izolează eroarea per-rând.
 */
export async function fetchContractNoticeEligibility(
  row: NormalizedTenderRow,
): Promise<{ minTurnoverRon: number | null; eligibilityNote: string | null } | null> {
  if (row.source !== 'contract_notice') return null
  const item = row.raw as ContractNoticeApiItem
  const data = await getJson<Section3ViewResponse>('/api-pub/NoticeCommon/GetSection3View/', row.detailUrl, {
    initNoticeId: item.cNoticeId,
    sysNoticeTypeId: item.sysNoticeTypeId,
  })
  const combined = `${data.efCriteria ?? ''} ${data.efCriteriaMin ?? ''}`
  return {
    minTurnoverRon: extractMinTurnoverRon(combined),
    eligibilityNote: data.efCriteriaMin?.trim() || null,
  }
}

// "cpvCodeAndName"/"cpvCode" vin ca "34351100-3 - Pneuri pentru autovehicule (Rev.2)" —
// separăm codul de descriere, nu ținem string-ul brut în coloanele dedicate.
function splitCpv(raw: string | null): { code: string | null; description: string | null } {
  if (!raw) return { code: null, description: null }
  const idx = raw.indexOf(' - ')
  if (idx === -1) return { code: raw.trim(), description: null }
  return { code: raw.slice(0, idx).trim(), description: raw.slice(idx + 3).trim() }
}

function toDate(iso: string | null): Date | null {
  return iso ? new Date(iso) : null
}

/**
 * Achiziții directe deschise (încă în ofertare) — `showOngoingDa: true` e flag-ul confirmat
 * empiric (research Wave 1) care întoarce date curente sortate desc, spre deosebire de
 * body-ul fără el (`pageSize`/`pageIndex` simple), care întoarce mereu aceeași felie veche
 * din 2019 — comportament de cache/index stale al SICAP, nu un bug de-al nostru. Starea
 * "deschis" confirmată empiric: `sysDirectAcquisitionState.id === 2` ("Ofertare").
 */
export async function fetchOpenDirectAcquisitions(): Promise<NormalizedTenderRow[]> {
  const referer = `${BASE_URL}/pub/direct-acquisition-notices/list/1`
  const now = new Date()
  const rows: NormalizedTenderRow[] = []
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const page = await postJson<DirectAcquisitionApiItem>('/api-pub/DirectAcquisitionCommon/GetDirectAcquisitionList/', referer, {
      pageSize: PAGE_SIZE,
      pageIndex,
      showOngoingDa: true,
    })
    for (const item of page.items) {
      const { code, description } = splitCpv(item.cpvCode)
      const deadline = toDate(item.caDecisionDeadline)
      rows.push({
        source: 'direct_acquisition',
        externalId: item.uniqueIdentificationCode,
        title: item.directAcquisitionName,
        cpvCode: code,
        cpvDescription: description,
        contractingAuthority: item.contractingAuthority,
        estimatedValueRon: item.estimatedValueRon,
        procedureType: null,
        stateText: item.sysDirectAcquisitionState?.text ?? null,
        // `showOngoingDa` e stare la momentul index-ării SICAP, nu live — o achiziție directă
        // trece rapid în "Ofertă acceptată" între sync-uri (2x/zi); verificăm și deadline-ul
        // ca plasă suplimentară, ca la licitațiile publice mai jos.
        isOpen: item.sysDirectAcquisitionState?.id === 2 && (!deadline || deadline.getTime() > now.getTime()),
        publicationDate: toDate(item.publicationDate),
        deadlineAt: deadline,
        detailUrl: `${BASE_URL}/pub/direct-acquisition/view/${item.directAcquisitionId}`,
        raw: item,
      })
    }
    if (page.items.length < PAGE_SIZE) break
    if (!hasRequestBudget(ELIGIBILITY_RESERVE)) {
      console.warn(`[e-licitatie] paginare oprită după pagina ${pageIndex + 1} — plafon de request-uri atins`)
      break
    }
  }
  return rows
}

/**
 * Licitații publice cu procedura "În desfășurare" (`sysProcedureStateId: 2`), publicate în
 * ultimele `sinceDays` zile. Intervalul de dată (`startPublicationDate`/`endPublicationDate`)
 * e OBLIGATORIU — confirmat empiric (Wave 1): fără el, endpoint-ul întoarce un set stale (nu
 * trece de ~2022, indiferent de `pageIndex`/`sortProperties`), cu el sortarea implicită devine
 * desc pe recency și ajunge la date de azi.
 *
 * `sinceDays: 3` era gândit ca fereastră INCREMENTALĂ (ce-i nou de la ultimul sync, 2x/zi) —
 * greșit, pt. că "În desfășurare" ține de starea CURENTĂ a procedurii, nu de data publicării: o
 * licitație publicată acum 2 săptămâni, încă deschisă, era complet ratată. 30 de zile acoperă
 * marea majoritate a duratelor tipice de ofertare (verificat empiric — 1965 rezultate la 30 zile
 * vs. 167 la 3 zile, cerință Stefan 2026-09-15).
 */
export async function fetchOpenContractNotices(sinceDays = 30): Promise<NormalizedTenderRow[]> {
  const referer = `${BASE_URL}/pub/notices/contract-notices/list/2/0`
  const now = new Date()
  const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000)
  const rows: NormalizedTenderRow[] = []
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const page = await postJson<ContractNoticeApiItem>('/api-pub/NoticeCommon/GetCNoticeListFiltered/', referer, {
      pageSize: PAGE_SIZE,
      pageIndex,
      sysProcedureStateId: 2,
      startPublicationDate: since.toISOString(),
      endPublicationDate: now.toISOString(),
    })
    for (const item of page.items) {
      const { code, description } = splitCpv(item.cpvCodeAndName)
      const deadline = toDate(item.maxTenderReceiptDeadline)
      rows.push({
        source: 'contract_notice',
        externalId: item.noticeNo,
        title: item.contractTitle,
        cpvCode: code,
        cpvDescription: description,
        contractingAuthority: item.contractingAuthorityNameAndFN,
        estimatedValueRon: item.estimatedValueRon,
        procedureType: item.sysProcedureType?.text ?? null,
        stateText: item.sysProcedureState?.text ?? null,
        isOpen: item.sysProcedureState?.id === 2 && (!deadline || deadline.getTime() > now.getTime()),
        publicationDate: toDate(item.noticeStateDate),
        deadlineAt: deadline,
        detailUrl: buildContractNoticeDetailUrl(item),
        raw: item,
      })
    }
    if (page.items.length < PAGE_SIZE) break
    if (!hasRequestBudget(ELIGIBILITY_RESERVE)) {
      console.warn(`[e-licitatie] paginare oprită după pagina ${pageIndex + 1} — plafon de request-uri atins`)
      break
    }
  }
  return rows
}

function ruleMatches(row: NormalizedTenderRow, rule: TenderWatchRuleRow, haystack: string): boolean {
  if (rule.cpvPrefix && row.cpvCode?.startsWith(rule.cpvPrefix)) return true
  if (rule.keyword && haystack.includes(rule.keyword.toLowerCase())) return true
  return false
}

/**
 * Regula activă care se potrivește (prefix CPV SAU keyword în titlu/descriere CPV), sau null.
 * O regulă de prioritate înaltă câștigă mereu în fața uneia normale, chiar dacă a fost creată
 * mai târziu (`rules` vine ordonat pe `createdAt`) — altfel o regulă largă mai veche (ex. CPV
 * `48`) "fură" match-ul unei reguli de prioritate mai specifice cu același prefix, iar
 * oportunitatea nu mai iese în evidență cum ar trebui.
 */
export function matchWatchRule(row: NormalizedTenderRow, rules: TenderWatchRuleRow[]): string | null {
  const haystack = `${row.title} ${row.cpvDescription ?? ''}`.toLowerCase()
  let firstNormalMatchId: string | null = null
  for (const rule of rules) {
    if (!ruleMatches(row, rule, haystack)) continue
    if (rule.highPriority) return rule.id
    firstNormalMatchId ??= rule.id
  }
  return firstNormalMatchId
}

/**
 * True dacă rândul se potrivește pe CEL PUȚIN o regulă din listă (prefix CPV SAU keyword) —
 * folosit pt. regulile de excludere (`exclude: true`), unde nu contează CARE regulă a
 * potrivit, doar dacă a potrivit vreuna.
 */
export function matchesAnyRule(row: NormalizedTenderRow, rules: TenderWatchRuleRow[]): boolean {
  const haystack = `${row.title} ${row.cpvDescription ?? ''}`.toLowerCase()
  return rules.some((rule) => ruleMatches(row, rule, haystack))
}
