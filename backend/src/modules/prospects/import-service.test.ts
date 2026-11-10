/**
 * Integration test on a real Postgres (test/setup.ts). The import reads .csv and .xlsx the same
 * way (column aliases of the old and the new registry exports), and writes only through
 * preview + commit: duplicates by CUI / phone / email are completed, never doubled.
 */
import ExcelJS from 'exceljs'
import { and, eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, prospectContactPoints, prospectNotes, prospectPeople, prospects, prospectStageEvents, prospectStatuses } from '../../shared/db/schema/index.js'
import { onProspectEvent } from '../../shared/lib/prospect-events.js'
import { runWithFreshActor } from '../../shared/lib/request-context.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { commitImport, ImportError, parseProspectFile, previewImport, toParsedRows } from './import-service.js'
import { buildImportTemplate } from './import-template.js'
import * as service from './service.js'

const SOURCE = `qa-import-${crypto.randomUUID()}`
const userIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare']

let a: SessionUser
let b: SessionUser
let manager: SessionUser

const buffer = (lines: string[]) => Buffer.from(lines.join('\n'))
const parseCsv = async (lines: string[]) => toParsedRows(await parseProspectFile(buffer(lines), 'qa.csv'))
const importCsv = async (me: SessionUser, lines: string[], distribution: Parameters<typeof commitImport>[2] = { mode: 'me' }) => {
  const preview = await previewImport(me, buffer(lines), 'qa.csv', SOURCE)
  return { preview, result: await commitImport(me, preview.token, distribution) }
}
const byCif = async (cif: string) => (await db.select().from(prospects).where(eq(prospects.cif, cif)))[0]
const countAll = async () => ({
  prospects: (await db.select({ id: prospects.id }).from(prospects)).length,
  points: (await db.select({ id: prospectContactPoints.id }).from(prospectContactPoints)).length,
  notes: (await db.select({ id: prospectNotes.id }).from(prospectNotes)).length,
  audit: (await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.action, 'prospect.import'))).length,
})

beforeAll(async () => {
  a = await createTestUser('imp-a', userIds, { features: AGENT })
  b = await createTestUser('imp-b', userIds, { features: [...AGENT, 'clienti.toti'] })
  manager = await createTestUser('imp-manager', userIds, { features: [...AGENT, 'clienti.toti', 'clienti.repartizare'] })
  await db.insert(prospectStatuses).values({ key: 'qa_de_revenit', label: 'QA De revenit', colorToken: 'amber' }).onConflictDoNothing()
})

afterAll(async () => {
  await db.delete(prospects).where(eq(prospects.source, SOURCE))
  await db.delete(prospects).where(like(prospects.name, 'QA Imp %'))
  await db.delete(auditLog).where(and(inArray(auditLog.action, ['prospect.import', 'prospect.export']), inArray(auditLog.actorUserId, userIds)))
  await db.delete(prospectStatuses).where(eq(prospectStatuses.key, 'qa_de_revenit'))
  await cleanupTestUsers(userIds)
})

describe('parsing', () => {
  it('recognises the new format (BUC export) by column aliases', async () => {
    const [row] = await parseCsv([
      'Firma,CUI,Nr. angajați,Cifra afaceri,Profit/pierdere,Capital propriu,Datorii,Disponibilități,Web1,Email1,Pers. decizie',
      'ACME TEST SRL,99100901,10,1000000,50000,200000,100000,30000,https://acme.example,office@acme.example,ION POPESCU',
    ])
    expect(row).toMatchObject({
      line: 2,
      name: 'ACME TEST SRL',
      cif: '99100901',
      employeeCount: 10,
      revenue: 1_000_000,
      revenuePrev: null,
      revenueYear: new Date().getFullYear() - 1,
      profit: 50_000,
      equity: 200_000,
      debt: 100_000,
      cash: 30_000,
      website: 'https://acme.example',
      emails: ['office@acme.example'],
      contactName: 'ION POPESCU',
    })
  })

  it('parses Romanian numbers (decimal comma, dots as thousands)', async () => {
    const [row] = await parseCsv(['Firma,CUI,Cifra2024RON,Profit2024RON,Angajati2024', 'BETA SRL,99100902,"1.234.567,89","93,3",5'])
    expect(row?.revenue).toBeCloseTo(1_234_567.89)
    expect(row?.profit).toBeCloseTo(93.3)
  })

  it('takes revenue, the year before and the year from the per-year format', async () => {
    const [row] = await parseCsv(['Firma,CUI,Cifra2024RON,Cifra2023RON,Venituri2023RON,Angajati2024', 'YEARS SRL,99100903,900000,700000,750000,8'])
    expect(row).toMatchObject({ revenue: 900_000, revenuePrev: 700_000, revenueYear: 2024 })
  })

  it('reads Status and OBS, and the "Stare" column into the active flag', async () => {
    const rows = await parseCsv([
      'Firma,CUI,Status,OBS,Stare firmă',
      'GAMMA SRL,99100904,DE REVENIT,revin saptamana viitoare,Radiată',
      'GAMMA 2 SRL,99100905,,,În funcțiune',
      'GAMMA 3 SRL,99100906,,,altceva',
    ])
    expect(rows[0]).toMatchObject({ presetStatus: 'de_revenit', notes: 'revin saptamana viitoare', isActive: false })
    expect(rows[1]?.isActive).toBe(true)
    expect(rows[2]?.isActive).toBeUndefined()
  })

  it('reads the "giga CSV" columns (Telefon/Site/CifraAfacereRON/NrAngajati), found 2026-07-29 when an import silently came in with no revenue', async () => {
    const [row] = await parseCsv([
      'Firma,CUI,Telefon,Email,Site,Contact,CifraAfacereRON,ProfitRON,VenituriRON,NrAngajati,AnInfiintare',
      'DELTA SRL,99100907,0755055544,office@delta.example,https://delta.example,ION IONESCU,6945923,147024,5192867,28,2017',
    ])
    expect(row).toMatchObject({ phones: ['0755055544'], website: 'https://delta.example', revenue: 6_945_923, profit: 147_024, employeeCount: 28, foundingYear: 2017 })
  })

  it('splits several phones and emails on / , ;', async () => {
    const [row] = await parseCsv(['Firma,CUI,Telefon,Email', 'MULTI SRL,99100908,"0722 111 222 / 0733 444 555; -","a@x.example, b@x.example"'])
    expect(row?.phones).toEqual(['0722 111 222', '0733 444 555', '-'])
    expect(row?.emails).toEqual(['a@x.example', 'b@x.example'])
  })

  it('refuses more than 5,000 rows and a file with no name or CUI column', async () => {
    const lines = ['Firma,CUI', ...Array.from({ length: 5001 }, (_, i) => `ROW ${i},${i + 1}`)]
    await expect(parseProspectFile(buffer(lines), 'big.csv')).rejects.toMatchObject({ code: 'IMPORT_TOO_MANY_ROWS', status: 400 })
    await expect(parseProspectFile(buffer(['Telefon,Email', '0722111222,a@x.example']), 'x.csv')).rejects.toMatchObject({ code: 'IMPORT_NO_NAME_COLUMN' })
    await expect(parseProspectFile(buffer(['Firma']), 'x.txt')).rejects.toBeInstanceOf(ImportError)
  })

  it('reads .xlsx: formula results, merged cells, hyperlinks, rich text and dates', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Data')
    sheet.addRow(['Nume firmă', 'CUI', 'Cifră de afaceri', 'Website', 'Notițe', 'Data înregistrare'])
    sheet.addRow(['Xlsx SRL', 99100950, null, null, null, new Date('2015-06-01T00:00:00Z')])
    sheet.getCell('C2').value = { formula: 'B2*2', result: 198_200_100 }
    sheet.getCell('D2').value = { text: 'xlsx.example', hyperlink: 'https://xlsx.example' }
    sheet.getCell('E2').value = { richText: [{ text: 'prima ' }, { text: 'notă', font: { bold: true } }] }
    sheet.addRow(['Merged SRL', 99100951])
    sheet.addRow([null, 99100952])
    sheet.mergeCells('A3:A4')
    sheet.addRow([])
    sheet.addRow(['After Gap SRL', 99100953])

    const rows = toParsedRows(await parseProspectFile(Buffer.from(await workbook.xlsx.writeBuffer()), 'qa.xlsx'))
    expect(rows.map((r) => [r.line, r.name, r.cif])).toEqual([
      [2, 'Xlsx SRL', '99100950'],
      [3, 'Merged SRL', '99100951'],
      [4, 'Merged SRL', '99100952'],
      [6, 'After Gap SRL', '99100953'],
    ])
    expect(rows[0]).toMatchObject({ revenue: 198_200_100, website: 'xlsx.example', notes: 'prima notă', foundingYear: 2015 })
  })

  it.each(['ro', 'en'] as const)('the %s template opens, has both sheets, and every header is recognised', async (locale) => {
    const file = await runWithFreshActor({ userId: null, ip: null, locale }, () => buildImportTemplate())
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(file as unknown as ExcelJS.Buffer)
    expect(workbook.worksheets).toHaveLength(2)
    expect(workbook.worksheets[1]?.rowCount).toBe(14)

    const [row] = toParsedRows(await parseProspectFile(file, 'template.xlsx'))
    expect(row).toMatchObject({
      name: 'Acme SRL',
      cif: '12345678',
      phones: ['0722 111 222'],
      emails: ['office@example.com'],
      website: 'example.com',
      caenCode: '6201',
      employeeCount: 12,
      revenue: 1_500_000,
      revenueYear: 2025,
    })
    expect(row?.contactName).toBeTruthy()
    expect(row?.presetStatus).toBeTruthy()
    expect(row?.notes).toBeTruthy()
    expect(row?.ownerEmail).toContain('@example.com')
  })
})

describe('preview and commit', () => {
  it('creates the prospect with people, contact points, stage event, note, financials and owner', async () => {
    const created: string[] = []
    const off = onProspectEvent('prospect.created', (e) => void created.push(e.prospectId))
    const { preview, result } = await importCsv(a, [
      'Nume firmă,CUI,Telefon,Email,Persoană de contact,Website,Cifra2024RON,Cifra2023RON,Angajati2024,Stare firmă,Status,Notițe',
      'QA Imp New SRL,RO99100001,"0722 111 222 / 0733 444 555",office@qa-new.example,Ion Popescu,qa-new.example,"1.000.000,50",800000,12,Radiată,QA DE REVENIT,Prima notă',
    ])
    off()
    expect(preview.counts).toEqual({ new: 1, update: 0, skip: 0, error: 0 })
    expect(preview.rows[0]).toMatchObject({ line: 2, action: 'new', name: 'QA Imp New SRL' })
    expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] })

    const row = (await byCif('RO99100001'))!
    expect(row).toMatchObject({ isActive: false, employeeCount: 12, revenueYear: 2024, status: 'qa_de_revenit', assignedUserId: a.id, source: SOURCE, lastActivityAt: null })
    expect(Number(row.revenue)).toBe(1_000_000.5)
    expect(Number(row.revenuePrev)).toBe(800_000)
    expect(row.claimedAt).not.toBeNull()
    expect(row.score).not.toBeNull()
    expect(created).toEqual([row.id])

    const points = await db.select().from(prospectContactPoints).where(eq(prospectContactPoints.prospectId, row.id)).orderBy(prospectContactPoints.createdAt)
    expect(points.map((p) => [p.kind, p.valueNormalized, p.isPrimary]).sort()).toEqual([
      ['email', 'office@qa-new.example', true],
      ['phone', '+40722111222', true],
      ['phone', '+40733444555', false],
    ])
    expect((await db.select().from(prospectPeople).where(eq(prospectPeople.prospectId, row.id))).map((p) => p.name)).toEqual(['Ion Popescu'])
    const stages = await db.select().from(prospectStageEvents).where(eq(prospectStageEvents.prospectId, row.id))
    expect(stages).toMatchObject([{ fromStatus: null, toStatus: 'qa_de_revenit', changedByUserId: a.id }])
    expect(await db.select().from(prospectNotes).where(eq(prospectNotes.prospectId, row.id))).toMatchObject([{ body: 'Prima notă', authorUserId: a.id }])

    // The struck-off flag is read by every recalculation, so it has to survive one.
    await service.recalculateAllScores()
    expect((await byCif('RO99100001'))?.isActive).toBe(false)
  })

  it('a CUI with RO is the same prospect: update, not new', async () => {
    const { preview, result } = await importCsv(a, ['Nume firmă,CUI,Website', 'QA Imp New SRL,99100001,other.example'])
    expect(preview.rows[0]).toMatchObject({ action: 'update', prospectId: (await byCif('RO99100001'))!.id })
    expect(result).toMatchObject({ created: 0, updated: 1 })
    expect((await db.select().from(prospects).where(eq(prospects.cifNormalized, '99100001'))).length).toBe(1)
  })

  it('a colleague’s duplicate stays theirs: only empty fields filled, status, name and notes untouched, a new note added', async () => {
    const theirs = await service.createProspect(b, { name: 'QA Imp Theirs SRL', cif: '99100002', website: 'https://theirs.example', phone: '0744 000 222' })
    await db.update(prospects).set({ status: 'qa_de_revenit' }).where(eq(prospects.id, theirs.id))
    await db.insert(prospectNotes).values({ prospectId: theirs.id, authorUserId: b.id, body: 'Nota lor' })

    const lines = [
      'Nume firmă,CUI,Website,CAEN,Status,Notițe,Stare firmă,Telefon',
      'QA Imp Other Name,99100002,other.example,6201,Necontactat,Notă nouă,Inactivă,"0744 000 222 / 0744 000 111"',
    ]
    const preview = await previewImport(a, buffer(lines), 'qa.csv', SOURCE)
    expect(preview.rows[0]).toMatchObject({ action: 'update', prospectId: theirs.id, ownerName: b.displayName })
    expect(preview.rows[0]?.fills.sort()).toEqual(['caenCode', 'isActive', 'phone'])
    await commitImport(a, preview.token, { mode: 'me' })

    const after = (await byCif('99100002'))!
    expect(after).toMatchObject({ name: 'QA Imp Theirs SRL', website: 'https://theirs.example', caenCode: '6201', status: 'qa_de_revenit', assignedUserId: b.id, isActive: false })
    const notes = await db.select().from(prospectNotes).where(eq(prospectNotes.prospectId, theirs.id)).orderBy(prospectNotes.createdAt)
    expect(notes.map((n) => [n.body, n.authorUserId])).toEqual([['Nota lor', b.id], ['Notă nouă', a.id]])
    const phones = await db.select().from(prospectContactPoints).where(and(eq(prospectContactPoints.prospectId, theirs.id), eq(prospectContactPoints.kind, 'phone')))
    expect(phones.map((p) => p.valueNormalized).sort()).toEqual(['+40744000111', '+40744000222'])
    expect(phones.filter((p) => p.isPrimary)).toHaveLength(1)
  })

  it('finds a prospect by phone: 0722 123 456 is +40722123456', async () => {
    const existing = await service.createProspect(a, { name: 'QA Imp Phone SRL', phone: '+40722123456' })
    const preview = await previewImport(a, buffer(['Nume firmă,Telefon,Email', 'Alt nume,0722 123 456,new@phone.example']), 'qa.csv', SOURCE)
    expect(preview.rows[0]).toMatchObject({ action: 'update', prospectId: existing.id, fills: ['email'] })
  })

  it('does not merge two companies with different CUIs that share a phone', async () => {
    await service.createProspect(a, { name: 'QA Imp Switchboard SRL', cif: '99100010', phone: '0721 000 010' })
    const preview = await previewImport(a, buffer(['Nume firmă,CUI,Telefon', 'QA Imp Branch SRL,99100011,0721 000 010']), 'qa.csv', SOURCE)
    expect(preview.rows[0]?.action).toBe('new')
  })

  it('a second row with the same CUI in the file is skipped', async () => {
    const { preview, result } = await importCsv(a, ['Nume firmă,CUI', 'QA Imp Twice SRL,99100020', 'QA Imp Twice SRL again,RO 99100020'])
    expect(preview.counts).toEqual({ new: 1, update: 0, skip: 1, error: 0 })
    expect(preview.rows[1]).toMatchObject({ line: 3, action: 'skip', reason: 'DUPLICATE_IN_FILE' })
    expect(result).toMatchObject({ created: 1, skipped: 1 })
  })

  it('reports a bad CUI and a missing name as errors with their line', async () => {
    const { preview, result } = await importCsv(a, ['Nume firmă,CUI,Telefon', 'QA Imp Bad SRL,abc,', ',99100030,', 'QA Imp Good SRL,99100031,'])
    expect(preview.rows.map((r) => [r.line, r.action, r.error])).toEqual([
      [2, 'error', 'INVALID_CUI'],
      [3, 'error', 'MISSING_NAME'],
      [4, 'new', undefined],
    ])
    expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [{ line: 2, code: 'INVALID_CUI' }, { line: 3, code: 'MISSING_NAME' }] })
  })

  it('preview writes nothing', async () => {
    const before = await countAll()
    await previewImport(a, buffer(['Nume firmă,CUI,Telefon,Notițe', 'QA Imp Ghost SRL,99100040,0722 999 040,o notă', 'QA Imp New SRL,99100001,,altă notă']), 'qa.csv', SOURCE)
    expect(await countAll()).toEqual(before)
  })

  it('distribution: without the assign right user and round_robin are refused, with it they work', async () => {
    const lines = ['Nume firmă,CUI', ...[1, 2, 3, 4].map((n) => `QA Imp RR ${n} SRL,9910005${n}`)]
    const preview = await previewImport(a, buffer(lines), 'qa.csv', SOURCE)
    await expect(commitImport(a, preview.token, { mode: 'round_robin', userIds: [a.id, b.id] })).rejects.toMatchObject({ code: 'IMPORT_NEEDS_REASSIGN', status: 403 })
    await expect(commitImport(a, preview.token, { mode: 'user', userIds: [b.id] })).rejects.toMatchObject({ status: 403 })

    const managerPreview = await previewImport(manager, buffer(lines), 'qa.csv', SOURCE)
    await expect(commitImport(manager, managerPreview.token, { mode: 'user', userIds: [crypto.randomUUID()] })).rejects.toBeInstanceOf(service.InvalidAssigneeError)
    await commitImport(manager, managerPreview.token, { mode: 'round_robin', userIds: [a.id, b.id] })
    const owners = (await db.select({ assignedUserId: prospects.assignedUserId }).from(prospects).where(like(prospects.cif, '9910005_'))).map((r) => r.assignedUserId)
    expect(owners.filter((id) => id === a.id)).toHaveLength(2)
    expect(owners.filter((id) => id === b.id)).toHaveLength(2)
  })

  it('the Responsabil column counts only for someone who can assign', async () => {
    const lines = ['Nume firmă,CUI,Responsabil (email)', `QA Imp Own SRL,99100060,${a.email.toUpperCase()}`, `QA Imp Own 2 SRL,99100061,${b.email}`]
    await importCsv(manager, lines)
    expect((await byCif('99100060'))?.assignedUserId).toBe(a.id)
    expect((await byCif('99100061'))?.assignedUserId).toBe(b.id)

    await importCsv(a, ['Nume firmă,CUI,Responsabil (email)', `QA Imp Own 3 SRL,99100062,${b.email}`])
    expect((await byCif('99100062'))?.assignedUserId).toBe(a.id)
  })

  it('a token works once, only for the person who made it, and each person keeps at most three', async () => {
    const lines = ['Nume firmă,CUI', 'QA Imp Token SRL,99100070']
    const first = await previewImport(a, buffer(lines), 'qa.csv', SOURCE)
    await expect(commitImport(b, first.token, { mode: 'me' })).rejects.toMatchObject({ code: 'IMPORT_TOKEN_EXPIRED', status: 404 })
    await commitImport(a, first.token, { mode: 'me' })
    await expect(commitImport(a, first.token, { mode: 'me' })).rejects.toMatchObject({ code: 'IMPORT_TOKEN_EXPIRED' })

    const tokens = []
    for (let i = 0; i < 4; i++) tokens.push((await previewImport(manager, buffer(lines), 'qa.csv', SOURCE)).token)
    await expect(commitImport(manager, tokens[0]!, { mode: 'me' })).rejects.toMatchObject({ code: 'IMPORT_TOKEN_EXPIRED' })
    await expect(commitImport(manager, tokens[3]!, { mode: 'me' })).resolves.toBeDefined()
  })

  it('writes in batches of 500 and records one audit row with the file and the counts', async () => {
    const lines = ['Nume firmă,CUI', ...Array.from({ length: 520 }, (_, i) => `QA Imp Bulk ${i} SRL,${98_000_000 + i}`)]
    const preview = await previewImport(a, buffer(lines), 'bulk.csv', SOURCE)
    const result = await commitImport(a, preview.token, { mode: 'me' })
    expect(result.created).toBe(520)
    expect((await db.select({ id: prospects.id }).from(prospects).where(and(eq(prospects.source, SOURCE), like(prospects.name, 'QA Imp Bulk %')))).length).toBe(520)

    const audits = await db.select().from(auditLog).where(and(eq(auditLog.action, 'prospect.import'), eq(auditLog.actorUserId, a.id)))
    const forFile = audits.filter((row) => (row.changes as { file?: unknown[] } | null)?.file?.[1] === 'bulk.csv')
    expect(forFile).toHaveLength(1)
    expect(forFile[0]?.changes).toMatchObject({ counts: [null, { new: 520, update: 0, skip: 0, error: 0 }] })
  })
})
