import { parse } from 'csv-parse/sync'
import { eq, isNull, and } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { prospects } from '../../shared/db/schema/index.js'
import { computeScore } from './scoring.js'
import { getScoringConfig, toScoringWeights } from './service.js'

/**
 * Parsare CSV tolerantă la formatul CSV-urilor de prospectare (port dintr-un script Python intern) —
 * alias-uri de coloane pt. formatul vechi (tab, coloane pe an: Cifra2024RON etc.) și formatul nou
 * (export BUC: "Cifra afaceri", "Nr. angajați" etc.), auto-detectie delimiter (tab/;/,), numere în
 * format românesc (1.234.567,89).
 */

// Telefon/Site adăugate 2026-07-29 — export propriu al lui Stefan (giga CSV, coloane curate)
// folosea aceste nume, nefiind recunoscute, tot importul cădea pe formatul "fără date financiare"
// (Prioritate SKIP, Scor 0.0 pt. toate rândurile).
const PHONE_COLS = ['Telefon mobil', 'Mobil1', 'Mobil2', 'Telefon1', 'Telefon2', 'Telefon']
const EMAIL_COLS = ['Email', 'Email1', 'Email2']
const SITE_COLS = ['Adresa web', 'Web1', 'Web2', 'Site']
const CONTACT_COLS = ['Pers. decizie', 'Contact']
const CAEN_COLS = ['Cod CAEN', 'CodCAEN', 'CAEN']
const DATE_COLS = [
  'Data înfiinţare',
  'Data infiintare',
  'Data înregistrare',
  'DataInfiintare',
  'Data inregistrare',
  'AnInfiintare',
]
const FIRMA_COLS = ['Nume firmă', 'Firma', 'Denumire', 'Nume firma']
const STARE_COLS = ['Stare firmă', 'Stare', 'Stare firma']
const CUI_COLS = ['CUI', 'bid', 'Cod unic de inregistrare', '_CUI']
const STATUS_COLS = ['Status']
const OBS_COLS = ['OBS', 'Obs']
const CONTACTED_BY_COLS = ['CineAContactat', 'Cine a contactat', 'Cine A Contactat']

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
    cifra: num(['Cifra afaceri', 'Cifra', 'CifraAfacereRON']),
    profit: num(['Profit/pierdere', 'Profit', 'ProfitRON']),
    venituri: num(['Venituri', 'VenituriRON']),
    angajati: num(['Nr. angajați', 'Nr. angajati', 'Nr angajati', 'Angajati', 'NrAngajati']),
    capital: num(['Capital propriu', 'CapitalPropriu']),
    datorii: num(['Datorii']),
    stocuri: num(['Stocuri']),
    disponib: num(['Disponibilități', 'Disponibilitati', 'Disponibilităţi']),
    creante: num(['Creanțe', 'Creante', 'Creanţe']),
  }
}

function bestYear(row: Record<string, string>): { year: number | null; data: YearData | null } {
  for (let y = CURRENT_YEAR; y >= CURRENT_YEAR - 6; y--) {
    const d = getYearDataOld(row, y)
    if ((d.cifra && d.cifra > 0) || (d.angajati && d.angajati > 0)) return { year: y, data: d }
  }
  const d = getYearDataNew(row)
  if ((d.cifra && d.cifra > 0) || (d.angajati && d.angajati > 0)) return { year: CURRENT_YEAR - 1, data: d }
  return { year: null, data: null }
}

function hasAnyFinancialDataRaw(row: Record<string, string>): boolean {
  for (let y = CURRENT_YEAR; y >= CURRENT_YEAR - 2; y--) {
    const d = getYearDataOld(row, y)
    if ((d.cifra && d.cifra > 500) || (d.angajati && d.angajati > 0)) return true
  }
  const d = getYearDataNew(row)
  return Boolean((d.cifra && d.cifra > 500) || (d.angajati && d.angajati > 0))
}

function isActiveRaw(row: Record<string, string>): boolean | undefined {
  const stare = getCol(row, STARE_COLS).toLowerCase()
  if (!stare) return undefined
  return stare.includes('functiune')
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

/** Vocabular extensibil (coloana DB e text) — slugify generic, nu o listă fixă de alias-uri. */
function normalizeStatus(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return 'necontactat'
  const ascii = trimmed
    .toLowerCase()
    .split('')
    .map((c) => DIACRITICS[c] ?? c)
    .join('')
  const slug = ascii.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
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

export interface ParsedProspectRow {
  name: string
  cif: string | null
  phone: string | null
  email: string | null
  website: string | null
  contactName: string | null
  caenCode: string | null
  foundingYear: number | null
  employeeCount: number | null
  revenue: number | null
  profit: number | null
  debt: number | null
  equity: number | null
  cash: number | null
  receivables: number | null
  inventory: number | null
  // Preluate din formatul deja-sortat al lui Stefan (Status/OBS/CineAContactat), null dacă lipsesc.
  presetStatus: string | null
  presetContactedBy: string | null
  presetNotes: string | null
  // Semnale folosite doar la calculul gate-ului de viabilitate — nu se persistă.
  isActive: boolean | undefined
  hasAnyFinancialData: boolean
}

function parseRow(row: Record<string, string>): ParsedProspectRow | null {
  const name = getCol(row, FIRMA_COLS)
  if (!name) return null

  const { data } = bestYear(row)
  const foundingYear = parseFoundingYear(row)
  const hasAnyFinancialData = hasAnyFinancialDataRaw(row)
  const isActive = isActiveRaw(row)

  const statusRaw = getCol(row, STATUS_COLS)
  const obsRaw = getCol(row, OBS_COLS)
  const contactedByRaw = getCol(row, CONTACTED_BY_COLS)

  // Turnover is the standard measure of a company's size. Total income can include financial
  // or one-off income that inflates it, so turnover comes first and total income is the
  // fallback. With the order reversed, the figure shown differed from the public registry by
  // a third for some companies.
  const revenue = data ? (data.cifra && data.cifra > 0 ? data.cifra : data.venituri) : null

  return {
    name,
    cif: getCol(row, CUI_COLS) || null,
    phone: getCol(row, PHONE_COLS) || null,
    email: getCol(row, EMAIL_COLS) || null,
    website: getCol(row, SITE_COLS) || null,
    contactName: getCol(row, CONTACT_COLS) || null,
    caenCode: getCol(row, CAEN_COLS) || null,
    foundingYear,
    employeeCount: data?.angajati != null ? Math.round(data.angajati) : null,
    revenue: revenue ?? null,
    profit: data?.profit ?? null,
    debt: data?.datorii ?? null,
    equity: data?.capital ?? null,
    cash: data?.disponib ?? null,
    receivables: data?.creante ?? null,
    inventory: data?.stocuri ?? null,
    presetStatus: statusRaw ? normalizeStatus(statusRaw) : null,
    presetContactedBy: contactedByRaw || null,
    presetNotes: obsRaw || null,
    isActive,
    hasAnyFinancialData,
  }
}

export function parseProspectsCsv(csvText: string): ParsedProspectRow[] {
  const delimiter = detectDelimiter(csvText)
  const records = parse(csvText, {
    columns: true,
    delimiter,
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[]

  const parsed: ParsedProspectRow[] = []
  for (const row of records) {
    const p = parseRow(row)
    if (p) parsed.push(p)
  }
  return parsed
}

export interface ImportResult {
  imported: number
  updated: number
}

function numOrNull(v: string | null | undefined): number | null {
  return v !== null && v !== undefined ? Number(v) : null
}

/** Câmpurile care se pot completa la reimport fără să șteargă ce există deja pe rândul din DB. */
function mergeRowWithExisting(row: ParsedProspectRow, existing: typeof prospects.$inferSelect | undefined) {
  return {
    phone: row.phone ?? existing?.phone ?? null,
    email: row.email ?? existing?.email ?? null,
    website: row.website ?? existing?.website ?? null,
    contactName: row.contactName ?? existing?.contactName ?? null,
    caenCode: row.caenCode ?? existing?.caenCode ?? null,
    foundingYear: row.foundingYear ?? existing?.foundingYear ?? null,
    employeeCount: row.employeeCount ?? existing?.employeeCount ?? null,
    revenue: row.revenue ?? numOrNull(existing?.revenue),
    profit: row.profit ?? numOrNull(existing?.profit),
    debt: row.debt ?? numOrNull(existing?.debt),
    equity: row.equity ?? numOrNull(existing?.equity),
    cash: row.cash ?? numOrNull(existing?.cash),
    receivables: row.receivables ?? numOrNull(existing?.receivables),
    inventory: row.inventory ?? numOrNull(existing?.inventory),
  }
}

/**
 * UPSERT pe cif: MERGE câmp cu câmp, nu overwrite total — un rând nou care are doar
 * nume/CUI/telefon/website completează exact acele câmpuri, restul (email, date financiare,
 * status/notițe/contactedBy) rămân cele existente în DB dacă rândul nou nu le are. Un rând nou
 * gol pe un câmp nu mai șterge o valoare deja completată — doar o valoare nouă o înlocuiește
 * pe cea veche. INSERT simplu când cif lipsește sau nu există niciun rând cu acel cif. Rulat
 * rând-cu-rând într-o tranzacție (volum mic, ~100-200 firme per import, nu justifică un singur
 * UPSERT SQL cu precedență per-câmp).
 */
export async function importProspects(csvText: string, source?: string): Promise<ImportResult> {
  const rows = parseProspectsCsv(csvText)
  const config = await getScoringConfig()
  const weights = toScoringWeights(config)

  let imported = 0
  let updated = 0

  await db.transaction(async (tx) => {
    for (const row of rows) {
      let existing: typeof prospects.$inferSelect | undefined
      if (row.cif) {
        ;[existing] = await tx
          .select()
          .from(prospects)
          .where(and(eq(prospects.cif, row.cif), isNull(prospects.deletedAt)))
      }

      const merged = mergeRowWithExisting(row, existing)
      const hasAnyFinancialData =
        row.hasAnyFinancialData ||
        Boolean((merged.revenue && merged.revenue > 500) || (merged.employeeCount && merged.employeeCount > 0))

      const score = computeScore(
        {
          revenue: merged.revenue,
          profit: merged.profit,
          debt: merged.debt,
          equity: merged.equity,
          cash: merged.cash,
          receivables: merged.receivables,
          inventory: merged.inventory,
          employeeCount: merged.employeeCount,
          foundingYear: merged.foundingYear,
          hasWebsite: Boolean(merged.website),
          hasPhone: Boolean(merged.phone),
          hasEmail: Boolean(merged.email),
          hasContactName: Boolean(merged.contactName),
          hasRecentFinancials: hasAnyFinancialData,
          hasAnyFinancialData,
          isActive: row.isActive,
        },
        weights,
      )

      const values = {
        phone: merged.phone,
        email: merged.email,
        website: merged.website,
        contactName: merged.contactName,
        caenCode: merged.caenCode,
        foundingYear: merged.foundingYear,
        employeeCount: merged.employeeCount,
        revenue: merged.revenue !== null ? String(merged.revenue) : null,
        profit: merged.profit !== null ? String(merged.profit) : null,
        debt: merged.debt !== null ? String(merged.debt) : null,
        equity: merged.equity !== null ? String(merged.equity) : null,
        cash: merged.cash !== null ? String(merged.cash) : null,
        receivables: merged.receivables !== null ? String(merged.receivables) : null,
        inventory: merged.inventory !== null ? String(merged.inventory) : null,
        score: String(score),
      }

      if (existing) {
        await tx
          .update(prospects)
          .set({
            ...values,
            name: row.name,
            source: source ?? existing.source,
            status: row.presetStatus ?? existing.status,
            notes: row.presetNotes ?? existing.notes,
            contactedBy: row.presetContactedBy ?? existing.contactedBy,
            updatedAt: new Date(),
          })
          .where(eq(prospects.id, existing.id))
        updated++
      } else {
        await tx.insert(prospects).values({
          ...values,
          name: row.name,
          cif: row.cif,
          source: source ?? null,
          status: row.presetStatus ?? 'necontactat',
          notes: row.presetNotes,
          contactedBy: row.presetContactedBy,
        })
        imported++
      }
    }
  })

  return { imported, updated }
}
