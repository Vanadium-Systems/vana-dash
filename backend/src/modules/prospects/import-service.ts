import { parse } from 'csv-parse/sync'
import ExcelJS from 'exceljs'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getCountryPack } from '../../countries/index.js'
import { db } from '../../shared/db/client.js'
import {
  prospectContactPoints,
  prospectNotes,
  prospectPeople,
  prospects,
  prospectStageEvents,
  prospectStatuses,
  users,
} from '../../shared/db/schema/index.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import { getCompany } from '../../shared/lib/company.js'
import { tr } from '../../shared/lib/i18n.js'
import { canReassign } from '../../shared/lib/prospect-access.js'
import { emitProspectEvent } from '../../shared/lib/prospect-events.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { IMPORT_MAX_ROWS, type ImportDistribution } from './import-schema.js'
import { InvalidAssigneeError, recalculateScores } from './service.js'

/**
 * Parsare tolerantă la formatul fișierelor de prospectare (port dintr-un script Python intern) —
 * alias-uri de coloane pt. formatul vechi (tab, coloane pe an: Cifra2024RON etc.) și formatul nou
 * (export BUC: "Cifra afaceri", "Nr. angajați" etc.), auto-detectie delimiter (tab/;/,), numere în
 * format românesc (1.234.567,89). Același parser pentru .csv și .xlsx, iar scrierea trece mereu
 * prin preview (plan fără scrieri) și commit (același plan, reconstruit, apoi aplicat).
 */

// Telefon/Site adăugate 2026-07-29 — export propriu al lui Stefan (giga CSV, coloane curate)
// folosea aceste nume, nefiind recunoscute, tot importul cădea pe formatul "fără date financiare"
// (Prioritate SKIP, Scor 0.0 pt. toate rândurile). Alias-urile în engleză vin din șablonul .xlsx.
const PHONE_COLS = ['Telefon mobil', 'Mobil1', 'Mobil2', 'Telefon1', 'Telefon2', 'Telefon', 'Phone']
const EMAIL_COLS = ['Email', 'Email1', 'Email2']
const SITE_COLS = ['Adresa web', 'Web1', 'Web2', 'Site', 'Website']
const CONTACT_COLS = ['Pers. decizie', 'Contact', 'Persoană de contact', 'Persoana de contact', 'Contact person']
const CAEN_COLS = ['Cod CAEN', 'CodCAEN', 'CAEN', 'NACE code']
const DATE_COLS = [
  'Data înfiinţare',
  'Data infiintare',
  'Data înregistrare',
  'DataInfiintare',
  'Data inregistrare',
  'AnInfiintare',
]
const FIRMA_COLS = ['Nume firmă', 'Firma', 'Denumire', 'Nume firma', 'Company name']
const STARE_COLS = ['Stare firmă', 'Stare', 'Stare firma']
const CUI_COLS = ['CUI', 'bid', 'Cod unic de inregistrare', '_CUI', 'Tax ID']
const STATUS_COLS = ['Status']
const NOTES_COLS = ['OBS', 'Obs', 'Notițe', 'Notite', 'Notes']
const OWNER_COLS = ['Responsabil (email)', 'Responsabil', 'Owner (email)']
const REVENUE_YEAR_COLS = ['An', 'Anul', 'Year']

const CURRENT_YEAR = new Date().getFullYear()

function getCol(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const v = row[c]
    if (v !== undefined && v !== null) {
      const s = String(v).trim()
      if (s) return s
    }
  }
  return ''
}

// Numere format românesc: 1.234.567,89 sau 93,3 (zecimale cu virgulă, fără separator de mii).
function parseRoNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null
  let v = raw.trim()
  if (!v || ['NULL', 'N/A', '-'].includes(v.toUpperCase())) return null
  if (v.includes(',') && v.includes('.')) {
    v = v.replaceAll('.', '').replace(',', '.')
  } else if (v.includes(',') && v.length - v.indexOf(',') <= 3) {
    v = v.replace(',', '.')
  } else if ((v.match(/\./g) ?? []).length > 1) {
    v = v.replaceAll('.', '')
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface YearData {
  cifra: number | null
  profit: number | null
  venituri: number | null
  angajati: number | null
  capital: number | null
  datorii: number | null
  stocuri: number | null
  disponib: number | null
  creante: number | null
}

function getYearDataOld(row: Record<string, string>, y: number): YearData {
  return {
    cifra: parseRoNumber(row[`Cifra${y}RON`]),
    profit: parseRoNumber(row[`Profit${y}RON`]),
    venituri: parseRoNumber(row[`Venituri${y}RON`]),
    angajati: parseRoNumber(row[`Angajati${y}`]),
    capital: parseRoNumber(row[`CapitalPropriu${y}RON`]),
    datorii: parseRoNumber(row[`Datorii${y}RON`]),
    stocuri: parseRoNumber(row[`Stocuri${y}RON`]),
    disponib: parseRoNumber(row[`Disponibilitati${y}RON`]),
    creante: parseRoNumber(row[`Creante${y}RON`]),
  }
}

function getYearDataNew(row: Record<string, string>): YearData {
  const num = (candidates: string[]) => {
    const raw = getCol(row, candidates)
    return raw ? parseRoNumber(raw) : null
  }
  return {
    cifra: num(['Cifra afaceri', 'Cifra', 'CifraAfacereRON', 'Cifră de afaceri', 'Cifra de afaceri', 'Revenue']),
    profit: num(['Profit/pierdere', 'Profit', 'ProfitRON']),
    venituri: num(['Venituri', 'VenituriRON']),
    angajati: num(['Nr. angajați', 'Nr. angajati', 'Nr angajati', 'Angajati', 'NrAngajati', 'Angajați', 'Employees']),
    capital: num(['Capital propriu', 'CapitalPropriu']),
    datorii: num(['Datorii']),
    stocuri: num(['Stocuri']),
    disponib: num(['Disponibilități', 'Disponibilitati', 'Disponibilităţi']),
    creante: num(['Creanțe', 'Creante', 'Creanţe']),
  }
}

// Turnover is the standard measure of a company's size. Total income can include financial
// or one-off income that inflates it, so turnover comes first and total income is the
// fallback. With the order reversed, the figure shown differed from the public registry by
// a third for some companies.
function revenueOf(d: YearData): number | null {
  return d.cifra && d.cifra > 0 ? d.cifra : d.venituri
}

function bestYear(row: Record<string, string>): { year: number | null; data: YearData | null; prevRevenue: number | null } {
  for (let y = CURRENT_YEAR; y >= CURRENT_YEAR - 6; y--) {
    const d = getYearDataOld(row, y)
    if ((d.cifra && d.cifra > 0) || (d.angajati && d.angajati > 0)) {
      const prev = revenueOf(getYearDataOld(row, y - 1))
      return { year: y, data: d, prevRevenue: prev && prev > 0 ? prev : null }
    }
  }
  const d = getYearDataNew(row)
  if ((d.cifra && d.cifra > 0) || (d.angajati && d.angajati > 0)) {
    const declared = parseRoNumber(getCol(row, REVENUE_YEAR_COLS))
    const year = declared && declared >= 1990 && declared <= CURRENT_YEAR ? Math.trunc(declared) : CURRENT_YEAR - 1
    return { year, data: d, prevRevenue: null }
  }
  return { year: null, data: null, prevRevenue: null }
}

function parseFoundingYear(row: Record<string, string>): number | null {
  const val = getCol(row, DATE_COLS)
  if (!val) return null
  const patterns = [/(\d{4})-\d{2}-\d{2}/, /\d{2}\.\d{2}\.(\d{4})/, /^(\d{4})$/, /\d{2}\/(\d{4})/]
  for (const p of patterns) {
    const m = val.match(p)
    if (m) {
      const yr = Number(m[1])
      if (yr >= 1990 && yr <= CURRENT_YEAR) return yr
    }
  }
  return null
}

const DIACRITICS: Record<string, string> = { ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't' }

function toAscii(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((c) => DIACRITICS[c] ?? c)
    .join('')
}

const INACTIVE_STATES = /radiat|inactiv|dizolv|lichid|insolv|suspend|inchis|closed|struck/
const ACTIVE_STATES = /functiune|activ|active|open/

// false = struck off or inactive. An unrecognised word leaves the flag as it is: only a clear
// "radiat"/"inactiv" is information worth overwriting.
function isActiveRaw(row: Record<string, string>): boolean | undefined {
  const stare = toAscii(getCol(row, STARE_COLS))
  if (!stare) return undefined
  if (INACTIVE_STATES.test(stare)) return false
  if (ACTIVE_STATES.test(stare)) return true
  return undefined
}

/** Vocabular extensibil (coloana DB e text) — slugify generic, nu o listă fixă de alias-uri. */
function normalizeStatus(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'necontactat'
  const slug = toAscii(trimmed)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'necontactat'
}

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4096)
  const counts: Record<string, number> = {
    '\t': (sample.match(/\t/g) ?? []).length,
    ';': (sample.match(/;/g) ?? []).length,
    ',': (sample.match(/,/g) ?? []).length,
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]
}

// ── Errors ───────────────────────────────────────────────────────────────────

export type ImportErrorCode =
  | 'IMPORT_TOO_MANY_ROWS'
  | 'IMPORT_NO_NAME_COLUMN'
  | 'IMPORT_UNSUPPORTED_FILE'
  | 'IMPORT_UNREADABLE'
  | 'IMPORT_TOKEN_EXPIRED'
  | 'IMPORT_NEEDS_REASSIGN'

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

// ── File → rows ──────────────────────────────────────────────────────────────

/** One data row as the file has it: headers as keys, `line` = the row number in the file. */
export interface SourceRow {
  line: number
  cells: Record<string, string>
}

// Reads the plain text out of any exceljs cell value. A formula contributes its cached result,
// a hyperlink its text, rich text its runs joined; an error cell (#N/A) is empty.
function valueText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object') return String(value)
  const v = value as Record<string, unknown>
  if ('result' in v) return valueText(v.result)
  if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((run: { text?: string }) => run.text ?? '').join('')
  if ('hyperlink' in v) return valueText(v.text)
  return ''
}

function cellText(cell: ExcelJS.Cell): string {
  // A merged range keeps its value in the top-left cell only.
  return valueText((cell.isMerged ? cell.master : cell).value).trim()
}

async function xlsxRows(buffer: Buffer): Promise<{ headers: string[]; rows: SourceRow[] }> {
  const workbook = new ExcelJS.Workbook()
  // Not the streaming reader: only the full load resolves merged cells.
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return { headers: [], rows: [] }

  const columns: Array<{ col: number; header: string }> = []
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const header = cellText(cell)
    if (header) columns.push({ col, header })
  })

  const rows: SourceRow[] = []
  for (let line = 2; line <= sheet.rowCount; line++) {
    const row = sheet.getRow(line)
    const cells: Record<string, string> = {}
    let any = false
    for (const { col, header } of columns) {
      const text = cellText(row.getCell(col))
      cells[header] = text
      if (text) any = true
    }
    if (!any) continue
    if (rows.length >= IMPORT_MAX_ROWS) throw tooManyRows()
    rows.push({ line, cells })
  }
  return { headers: columns.map((c) => c.header), rows }
}

function csvRows(buffer: Buffer): { headers: string[]; rows: SourceRow[] } {
  const text = buffer.toString('utf-8')
  const records = parse(text, {
    columns: true,
    delimiter: detectDelimiter(text),
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
    info: true,
  }) as Array<{ record: Record<string, string>; info: { lines: number } }>
  if (records.length > IMPORT_MAX_ROWS) throw tooManyRows()
  return {
    headers: records[0] ? Object.keys(records[0].record) : [],
    rows: records.map(({ record, info }) => ({ line: info.lines, cells: record })),
  }
}

const tooManyRows = () => new ImportError('IMPORT_TOO_MANY_ROWS', 400, tr('errors.prospects.importTooManyRows', { max: IMPORT_MAX_ROWS }))

export async function parseProspectFile(buffer: Buffer, filename: string): Promise<SourceRow[]> {
  const extension = filename.toLowerCase().split('.').pop()
  if (extension !== 'csv' && extension !== 'xlsx') {
    throw new ImportError('IMPORT_UNSUPPORTED_FILE', 400, tr('errors.prospects.importUnsupportedFile'))
  }
  let parsed: { headers: string[]; rows: SourceRow[] }
  try {
    parsed = extension === 'csv' ? csvRows(buffer) : await xlsxRows(buffer)
  } catch (err) {
    if (err instanceof ImportError) throw err
    throw new ImportError('IMPORT_UNREADABLE', 400, tr('errors.prospects.importUnreadable'))
  }
  if (!parsed.headers.some((h) => FIRMA_COLS.includes(h) || CUI_COLS.includes(h))) {
    throw new ImportError('IMPORT_NO_NAME_COLUMN', 400, tr('errors.prospects.importNoNameColumn'))
  }
  return parsed.rows
}

// ── Row → fields ─────────────────────────────────────────────────────────────

export interface ParsedProspectRow {
  line: number
  name: string
  cif: string | null
  phones: string[]
  emails: string[]
  website: string | null
  contactName: string | null
  caenCode: string | null
  foundingYear: number | null
  employeeCount: number | null
  revenue: number | null
  revenuePrev: number | null
  revenueYear: number | null
  profit: number | null
  debt: number | null
  equity: number | null
  cash: number | null
  receivables: number | null
  inventory: number | null
  presetStatus: string | null
  notes: string | null
  ownerEmail: string | null
  isActive: boolean | undefined
}

/** Every filled column among the aliases (a file can have Mobil1 and Mobil2), split on `/ , ;`. */
function getList(row: Record<string, string>, candidates: string[]): string[] {
  return candidates.flatMap((c) => (row[c] ?? '').split(/[/,;]/)).map((v) => v.trim()).filter(Boolean)
}

function parseRow({ line, cells: row }: SourceRow): ParsedProspectRow {
  const { year, data, prevRevenue } = bestYear(row)
  const revenue = data ? revenueOf(data) : null
  const statusRaw = getCol(row, STATUS_COLS)

  return {
    line,
    name: getCol(row, FIRMA_COLS),
    cif: getCol(row, CUI_COLS) || null,
    phones: getList(row, PHONE_COLS),
    emails: getList(row, EMAIL_COLS),
    website: getCol(row, SITE_COLS) || null,
    contactName: getCol(row, CONTACT_COLS) || null,
    caenCode: getCol(row, CAEN_COLS) || null,
    foundingYear: parseFoundingYear(row),
    employeeCount: data?.angajati != null ? Math.round(data.angajati) : null,
    revenue: revenue ?? null,
    revenuePrev: revenue != null ? prevRevenue : null,
    revenueYear: revenue != null ? year : null,
    profit: data?.profit ?? null,
    debt: data?.datorii ?? null,
    equity: data?.capital ?? null,
    cash: data?.disponib ?? null,
    receivables: data?.creante ?? null,
    inventory: data?.stocuri ?? null,
    presetStatus: statusRaw ? normalizeStatus(statusRaw) : null,
    notes: getCol(row, NOTES_COLS) || null,
    ownerEmail: getCol(row, OWNER_COLS).toLowerCase() || null,
    isActive: isActiveRaw(row),
  }
}

export const toParsedRows = (rows: SourceRow[]): ParsedProspectRow[] => rows.map(parseRow)

// ── Plan (what an import would do) ───────────────────────────────────────────

type ProspectInsert = typeof prospects.$inferInsert
type ContactKind = 'phone' | 'email'
type ContactPointDraft = { kind: ContactKind; value: string; valueNormalized: string }

export type ImportAction = 'new' | 'update' | 'skip' | 'error'

interface UpdatePatch {
  set: Partial<ProspectInsert>
  points: Array<ContactPointDraft & { isPrimary: boolean }>
  person: string | null
}

interface PlanRow {
  parsed: ParsedProspectRow
  action: ImportAction
  prospectId?: string
  ownerName?: string
  fills: string[]
  /** `error` rows only: MISSING_NAME, INVALID_CUI. */
  error?: string
  /** `skip` rows only: DUPLICATE_IN_FILE. */
  reason?: string
  patch?: UpdatePatch
  contacts: { phones: ContactPointDraft[]; emails: ContactPointDraft[] }
  cifKey: string | null
}

export interface PreviewRow {
  line: number
  action: ImportAction
  name: string
  prospectId?: string
  ownerName?: string
  fills: string[]
  error?: string
  reason?: string
}

const cifKeyOf = (cif: string) => cif.replace(/^\s*RO|\s/gi, '').toUpperCase()
// Same cut-off as the numbers: a lone dash or "N/A" in the CUI column means "none".
const EMPTY_CUI = new Set(['NULL', 'N/A', '-', '0'])
const isBlank = (v: unknown) => v === null || v === undefined || v === ''
// A phone with fewer digits is a dash, a note or an extension, not a number.
const looksLikePhone = (v: string) => (v.match(/\d/g) ?? []).length >= 6
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+$/.test(v)
const compatibleCif = (a: string | null, b: string | null) => !a || !b || a === b

type ExistingProspect = typeof prospects.$inferSelect

interface Candidate {
  prospectId: string
  cifKey: string | null
}

async function lookupCandidates(cifKeys: string[], phoneKeys: string[], emailKeys: string[]) {
  const byCif = new Map<string, Candidate>()
  const byPhone = new Map<string, Candidate[]>()
  const byEmail = new Map<string, Candidate[]>()

  for (let i = 0; i < cifKeys.length; i += 1000) {
    const found = await db
      .select({ id: prospects.id, cifKey: prospects.cifNormalized })
      .from(prospects)
      .where(and(isNull(prospects.deletedAt), inArray(prospects.cifNormalized, cifKeys.slice(i, i + 1000))))
      .orderBy(prospects.createdAt)
    for (const p of found) if (p.cifKey && !byCif.has(p.cifKey)) byCif.set(p.cifKey, { prospectId: p.id, cifKey: p.cifKey })
  }

  const byContact = async (kind: ContactKind, keys: string[], into: Map<string, Candidate[]>) => {
    for (let i = 0; i < keys.length; i += 1000) {
      const found = await db
        .select({ prospectId: prospectContactPoints.prospectId, key: prospectContactPoints.valueNormalized, cifKey: prospects.cifNormalized })
        .from(prospectContactPoints)
        .innerJoin(prospects, eq(prospects.id, prospectContactPoints.prospectId))
        .where(
          and(
            eq(prospectContactPoints.kind, kind),
            isNull(prospectContactPoints.deletedAt),
            isNull(prospects.deletedAt),
            inArray(prospectContactPoints.valueNormalized, keys.slice(i, i + 1000)),
          ),
        )
        .orderBy(prospects.createdAt)
      for (const p of found) into.set(p.key, [...(into.get(p.key) ?? []), { prospectId: p.prospectId, cifKey: p.cifKey || null }])
    }
  }
  await byContact('phone', phoneKeys, byPhone)
  await byContact('email', emailKeys, byEmail)
  return { byCif, byPhone, byEmail }
}

function buildPatch(row: ParsedProspectRow, existing: ExistingProspect, contacts: PlanRow['contacts'], have: ExistingContent): { patch: UpdatePatch; fills: string[] } {
  const set: Partial<ProspectInsert> = {}
  const fills: string[] = []
  const fill = <K extends keyof ProspectInsert>(field: K, current: unknown, value: ProspectInsert[K] | null | undefined) => {
    if (isBlank(current) && !isBlank(value)) {
      set[field] = value as ProspectInsert[K]
      fills.push(field)
    }
  }
  const money = (v: number | null) => (v === null ? null : String(v))

  fill('cif', existing.cif, row.cif && !EMPTY_CUI.has(row.cif.toUpperCase()) ? row.cif : null)
  fill('website', existing.website, row.website)
  fill('caenCode', existing.caenCode, row.caenCode)
  fill('foundingYear', existing.foundingYear, row.foundingYear)
  fill('employeeCount', existing.employeeCount, row.employeeCount)
  // Revenue, the year before and the year of the figure describe one reading; they move together.
  if (isBlank(existing.revenue) && row.revenue !== null) {
    set.revenue = String(row.revenue)
    set.revenuePrev = money(row.revenuePrev)
    set.revenueYear = row.revenueYear
    fills.push('revenue')
  }
  fill('profit', existing.profit, money(row.profit))
  fill('debt', existing.debt, money(row.debt))
  fill('equity', existing.equity, money(row.equity))
  fill('cash', existing.cash, money(row.cash))
  fill('receivables', existing.receivables, money(row.receivables))
  fill('inventory', existing.inventory, money(row.inventory))
  // Struck off is news, so unlike the rest it replaces what is there.
  if (row.isActive !== undefined && existing.isActive !== row.isActive) {
    set.isActive = row.isActive
    fills.push('isActive')
  }

  const points: UpdatePatch['points'] = []
  for (const kind of ['phone', 'email'] as const) {
    const known = kind === 'phone' ? have.phones : have.emails
    const fresh = (kind === 'phone' ? contacts.phones : contacts.emails).filter((c) => !known.has(c.valueNormalized))
    fresh.forEach((c, i) => points.push({ ...c, isPrimary: known.size === 0 && i === 0 }))
    if (fresh.length) fills.push(kind)
  }
  const person = row.contactName && !have.people.has(row.contactName.toLowerCase()) ? row.contactName : null
  if (person) fills.push('contactName')
  return { patch: { set, points, person }, fills }
}

interface ExistingContent {
  phones: Set<string>
  emails: Set<string>
  people: Set<string>
}

async function planImport(me: Pick<SessionUser, 'id'>, rows: ParsedProspectRow[]): Promise<PlanRow[]> {
  const pack = getCountryPack((await getCompany()).country)

  const prepared = rows.map((parsed) => {
    const rawCif = parsed.cif?.trim() ?? ''
    const cif = EMPTY_CUI.has(rawCif.toUpperCase()) ? '' : rawCif
    const cifKey = cif ? cifKeyOf(cif) : null
    const invalidCif = Boolean(cif) && (!cifKey || cifKey.length > 20 || !/\d/.test(cifKey))
    const phones = uniqueBy(parsed.phones.filter(looksLikePhone).map((value) => ({ kind: 'phone' as const, value, valueNormalized: pack.normalizePhone(value) })))
    const emails = uniqueBy(parsed.emails.filter((v) => looksLikeEmail(v)).map((value) => ({ kind: 'email' as const, value, valueNormalized: value.toLowerCase() })))
    return { parsed, cifKey: invalidCif ? null : cifKey, invalidCif, contacts: { phones, emails } }
  })

  const found = await lookupCandidates(
    [...new Set(prepared.flatMap((p) => (p.cifKey ? [p.cifKey] : [])))],
    [...new Set(prepared.flatMap((p) => p.contacts.phones.map((c) => c.valueNormalized)))],
    [...new Set(prepared.flatMap((p) => p.contacts.emails.map((c) => c.valueNormalized)))],
  )

  // The first match in the order CUI, phone, email. A phone or email shared by two companies with
  // different CUIs is a switchboard, not a duplicate.
  const matchInDb = (p: (typeof prepared)[number]): Candidate | undefined => {
    if (p.cifKey && found.byCif.has(p.cifKey)) return found.byCif.get(p.cifKey)
    for (const [list, index] of [
      [p.contacts.phones, found.byPhone],
      [p.contacts.emails, found.byEmail],
    ] as const) {
      for (const c of list) {
        const hit = index.get(c.valueNormalized)?.find((candidate) => compatibleCif(p.cifKey, candidate.cifKey))
        if (hit) return hit
      }
    }
    return undefined
  }

  const matches = prepared.map(matchInDb)
  const matchedIds = [...new Set(matches.flatMap((m) => (m ? [m.prospectId] : [])))]
  const existingById = new Map<string, ExistingProspect>()
  const contentById = new Map<string, ExistingContent>()
  const ownerNames = new Map<string, string>()
  for (let i = 0; i < matchedIds.length; i += 1000) {
    const ids = matchedIds.slice(i, i + 1000)
    for (const p of await db.select().from(prospects).where(inArray(prospects.id, ids))) {
      existingById.set(p.id, p)
      contentById.set(p.id, { phones: new Set(), emails: new Set(), people: new Set() })
    }
    const points = await db
      .select({ prospectId: prospectContactPoints.prospectId, kind: prospectContactPoints.kind, key: prospectContactPoints.valueNormalized })
      .from(prospectContactPoints)
      .where(and(inArray(prospectContactPoints.prospectId, ids), isNull(prospectContactPoints.deletedAt)))
    for (const c of points) contentById.get(c.prospectId)?.[c.kind === 'phone' ? 'phones' : 'emails'].add(c.key)
    const people = await db
      .select({ prospectId: prospectPeople.prospectId, name: prospectPeople.name })
      .from(prospectPeople)
      .where(and(inArray(prospectPeople.prospectId, ids), isNull(prospectPeople.deletedAt)))
    for (const person of people) contentById.get(person.prospectId)?.people.add(person.name.toLowerCase())
  }
  const ownerIds = [...new Set([...existingById.values()].flatMap((p) => (p.assignedUserId && p.assignedUserId !== me.id ? [p.assignedUserId] : [])))]
  if (ownerIds.length) {
    for (const u of await db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).where(inArray(users.id, ownerIds))) {
      ownerNames.set(u.id, u.displayName || u.email)
    }
  }

  const seenCif = new Set<string>()
  const seenContact = new Map<string, string | null>()
  const seenProspect = new Set<string>()
  const plan: PlanRow[] = []

  prepared.forEach((p, i) => {
    const base = { parsed: p.parsed, fills: [] as string[], contacts: p.contacts, cifKey: p.cifKey }
    if (p.invalidCif) return plan.push({ ...base, action: 'error', error: 'INVALID_CUI' })

    const contactKeys = [...p.contacts.phones, ...p.contacts.emails].map((c) => `${c.kind}:${c.valueNormalized}`)
    const match = matches[i]
    const duplicatedInFile =
      (p.cifKey !== null && seenCif.has(p.cifKey)) ||
      contactKeys.some((key) => seenContact.has(key) && compatibleCif(p.cifKey, seenContact.get(key) ?? null)) ||
      (match !== undefined && seenProspect.has(match.prospectId))
    if (duplicatedInFile) return plan.push({ ...base, action: 'skip', reason: 'DUPLICATE_IN_FILE' })

    if (p.cifKey) seenCif.add(p.cifKey)
    for (const key of contactKeys) if (!seenContact.has(key)) seenContact.set(key, p.cifKey)

    if (match) {
      seenProspect.add(match.prospectId)
      const existing = existingById.get(match.prospectId)!
      const { patch, fills } = buildPatch(p.parsed, existing, p.contacts, contentById.get(match.prospectId)!)
      const ownerName = existing.assignedUserId && existing.assignedUserId !== me.id ? ownerNames.get(existing.assignedUserId) : undefined
      return plan.push({ ...base, action: 'update', prospectId: match.prospectId, ownerName, fills, patch })
    }
    if (!p.parsed.name) return plan.push({ ...base, action: 'error', error: 'MISSING_NAME' })
    plan.push({ ...base, action: 'new' })
  })
  return plan
}

function uniqueBy<T extends { valueNormalized: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.valueNormalized, item])).values()]
}

function countPlan(plan: PlanRow[]) {
  const counts = { new: 0, update: 0, skip: 0, error: 0 }
  for (const row of plan) counts[row.action]++
  return counts
}

// ── Stored previews ──────────────────────────────────────────────────────────

const PREVIEW_TTL_MS = 30 * 60 * 1000
const MAX_PREVIEWS_PER_USER = 3

interface StoredPreview {
  userId: string
  expiresAt: number
  file: string
  source: string
  rows: ParsedProspectRow[]
}

// In memory on purpose: a preview is a convenience of the next 30 minutes, and losing it on a
// restart only means uploading the file again.
const previews = new Map<string, StoredPreview>()

function sweepPreviews() {
  const now = Date.now()
  for (const [token, entry] of previews) if (entry.expiresAt <= now) previews.delete(token)
}

function storePreview(entry: Omit<StoredPreview, 'expiresAt'>): string {
  sweepPreviews()
  const mine = [...previews].filter(([, e]) => e.userId === entry.userId)
  // Map keeps insertion order, so the first ones are the oldest.
  for (const [token] of mine.slice(0, Math.max(0, mine.length - (MAX_PREVIEWS_PER_USER - 1)))) previews.delete(token)
  const token = crypto.randomUUID()
  previews.set(token, { ...entry, expiresAt: Date.now() + PREVIEW_TTL_MS })
  return token
}

/** Removes the preview as it hands it over: a second commit of the same token would add every note twice. */
function takePreview(userId: string, token: string): StoredPreview {
  sweepPreviews()
  const entry = previews.get(token)
  if (!entry || entry.userId !== userId) throw new ImportError('IMPORT_TOKEN_EXPIRED', 404, tr('errors.prospects.importTokenExpired'))
  previews.delete(token)
  return entry
}

export async function previewImport(me: Pick<SessionUser, 'id'>, buffer: Buffer, filename: string, source?: string) {
  const rows = toParsedRows(await parseProspectFile(buffer, filename))
  const plan = await planImport(me, rows)
  const token = storePreview({ userId: me.id, file: filename, source: source?.trim() || filename, rows })
  const preview: PreviewRow[] = plan.map((r) => ({
    line: r.parsed.line,
    action: r.action,
    name: r.parsed.name,
    prospectId: r.prospectId,
    ownerName: r.ownerName,
    fills: r.fills,
    error: r.error,
    reason: r.reason,
  }))
  return { token, counts: countPlan(plan), rows: preview }
}

// ── Commit ───────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500

async function resolveDistribution(me: Pick<SessionUser, 'id' | 'features'>, distribution: ImportDistribution): Promise<string[]> {
  if (distribution.mode === 'me') return [me.id]
  if (!canReassign(me)) throw new ImportError('IMPORT_NEEDS_REASSIGN', 403, tr('errors.prospects.importNeedsReassign'))
  const ids = [...new Set(distribution.userIds ?? [])]
  const active = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.status, 'active'), isNull(users.deletedAt)))
  if (active.length !== ids.length) throw new InvalidAssigneeError(tr('errors.prospects.assigneeInvalid'))
  return ids
}

async function statusResolver() {
  const catalog = await db
    .select({ key: prospectStatuses.key, label: prospectStatuses.label, isDefault: prospectStatuses.isDefault })
    .from(prospectStatuses)
    .where(isNull(prospectStatuses.deletedAt))
    .orderBy(prospectStatuses.sortOrder)
  const keys = new Set(catalog.map((s) => s.key))
  const byLabel = new Map(catalog.map((s) => [normalizeStatus(s.label), s.key]))
  const fallback = catalog.find((s) => s.isDefault)?.key ?? catalog[0]?.key ?? 'necontactat'
  return (preset: string | null) => (preset && keys.has(preset) ? preset : ((preset && byLabel.get(preset)) ?? fallback))
}

export async function commitImport(me: Pick<SessionUser, 'id' | 'features'>, token: string, distribution: ImportDistribution) {
  const owners = await resolveDistribution(me, distribution)
  const entry = takePreview(me.id, token)
  const plan = await planImport(me, entry.rows)
  const resolveStatus = await statusResolver()

  const ownerByEmail = new Map<string, string>()
  const wanted = [...new Set(entry.rows.flatMap((r) => (r.ownerEmail ? [r.ownerEmail] : [])))]
  if (canReassign(me) && wanted.length) {
    const found = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(inArray(sql`lower(${users.email})`, wanted), eq(users.status, 'active'), isNull(users.deletedAt)))
    for (const u of found) ownerByEmail.set(u.email.toLowerCase(), u.id)
  }

  const work = plan.filter((r) => r.action === 'new' || r.action === 'update')
  let roundRobin = 0
  const createdIds: string[] = []
  const updatedIds: string[] = []

  for (let i = 0; i < work.length; i += BATCH_SIZE) {
    const batch = work.slice(i, i + BATCH_SIZE)
    const batchNew: string[] = []
    const batchTouched: string[] = []
    await db.transaction(async (tx) => {
      const now = new Date()
      const drafts = {
        prospects: [] as ProspectInsert[],
        people: [] as Array<typeof prospectPeople.$inferInsert>,
        points: [] as Array<typeof prospectContactPoints.$inferInsert>,
        stages: [] as Array<typeof prospectStageEvents.$inferInsert>,
        notes: [] as Array<typeof prospectNotes.$inferInsert>,
      }
      const addNote = (prospectId: string, body: string | null) => {
        if (body) drafts.notes.push({ prospectId, authorUserId: me.id, body })
      }
      const money = (v: number | null) => (v === null ? null : String(v))

      for (const r of batch) {
        const p = r.parsed
        if (r.action === 'new') {
          const id = crypto.randomUUID()
          const assignedUserId = (p.ownerEmail && ownerByEmail.get(p.ownerEmail)) || owners[distribution.mode === 'round_robin' ? roundRobin++ % owners.length : 0]!
          const status = resolveStatus(p.presetStatus)
          drafts.prospects.push({
            id,
            ...createdByUserId(),
            ...updatedByUserId(),
            name: p.name,
            cif: p.cif && !EMPTY_CUI.has(p.cif.toUpperCase()) ? p.cif : null,
            website: p.website,
            caenCode: p.caenCode,
            foundingYear: p.foundingYear,
            employeeCount: p.employeeCount,
            revenue: money(p.revenue),
            revenuePrev: money(p.revenuePrev),
            revenueYear: p.revenueYear,
            profit: money(p.profit),
            debt: money(p.debt),
            equity: money(p.equity),
            cash: money(p.cash),
            receivables: money(p.receivables),
            inventory: money(p.inventory),
            isActive: p.isActive,
            source: entry.source,
            status,
            assignedUserId,
            claimedAt: now,
          })
          let personId: string | null = null
          if (p.contactName) {
            personId = crypto.randomUUID()
            drafts.people.push({ id: personId, prospectId: id, name: p.contactName })
          }
          for (const [list, kind] of [[r.contacts.phones, 'phone'], [r.contacts.emails, 'email']] as const) {
            list.forEach((c, n) => drafts.points.push({ prospectId: id, personId, kind, value: c.value, valueNormalized: c.valueNormalized, isPrimary: n === 0 }))
          }
          drafts.stages.push({ prospectId: id, fromStatus: null, toStatus: status, changedByUserId: me.id, changedAt: now })
          addNote(id, p.notes)
          batchNew.push(id)
          batchTouched.push(id)
        } else {
          const id = r.prospectId!
          const patch = r.patch!
          if (Object.keys(patch.set).length) {
            await tx.update(prospects).set({ ...patch.set, ...updatedByUserId(), updatedAt: now }).where(eq(prospects.id, id))
          }
          let personId: string | null = null
          if (patch.person) {
            personId = crypto.randomUUID()
            drafts.people.push({ id: personId, prospectId: id, name: patch.person })
          }
          for (const c of patch.points) drafts.points.push({ prospectId: id, personId, ...c })
          addNote(id, p.notes)
          batchTouched.push(id)
        }
      }

      if (drafts.prospects.length) await tx.insert(prospects).values(drafts.prospects)
      if (drafts.people.length) await tx.insert(prospectPeople).values(drafts.people)
      if (drafts.points.length) await tx.insert(prospectContactPoints).values(drafts.points)
      if (drafts.stages.length) await tx.insert(prospectStageEvents).values(drafts.stages)
      if (drafts.notes.length) await tx.insert(prospectNotes).values(drafts.notes)
    })
    await recalculateScores(batchTouched)
    for (const prospectId of batchNew) emitProspectEvent('prospect.created', { prospectId, via: 'import', importToken: token })
    createdIds.push(...batchNew)
    updatedIds.push(...batch.filter((r) => r.action === 'update').map((r) => r.prospectId!))
  }

  const result = {
    created: createdIds.length,
    updated: updatedIds.length,
    skipped: plan.filter((r) => r.action === 'skip').length,
    errors: plan.filter((r) => r.action === 'error').map((r) => ({ line: r.parsed.line, code: r.error! })),
  }
  await recordAudit({
    action: 'prospect.import',
    entityType: 'prospect',
    actorUserId: me.id,
    changes: { file: [null, entry.file], counts: [null, { new: result.created, update: result.updated, skip: result.skipped, error: result.errors.length }] },
  })
  return result
}
