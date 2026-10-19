/**
 * Integration test — pg real (test/setup.ts). Acoperă filtrarea listProspects (inclusiv bug-ul
 * găsit manual: Postgres nu permite referirea unui alias din SELECT în clauza WHERE — filtrul de
 * prioritate trebuia să refolosească expresia CASE WHEN brută, nu alias-ul `priority`), CRUD-ul
 * de bază și promovarea la client.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, billingClients, prospects, users } from '../../shared/db/schema/index.js'
import * as service from './service.js'

const prospectIds: string[] = []
const billingClientIds: string[] = []

afterAll(async () => {
  // Ordinea contează — prospects.billingClientId e FK către billing_clients.
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  if (billingClientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, billingClientIds))
})

describe('listProspects — filtre', () => {
  let hotId: string
  let warmId: string

  beforeAll(async () => {
    const hot = await service.createProspect({
      name: 'QA HOT FIRMA SRL',
      cif: 'QA-SVC-1',
      employeeCount: 10,
      revenue: 5_000_000,
      profit: 500_000,
      debt: 100_000,
      equity: 2_000_000,
      cash: 300_000,
      website: 'https://qa-hot.example',
      phone: '0700000000',
      email: 'qa@hot.example',
      contactName: 'Ion Popescu',
      source: 'qa-batch',
    })
    hotId = hot!.id
    prospectIds.push(hotId)

    const warm = await service.createProspect({
      name: 'QA WARM FIRMA SRL',
      cif: 'QA-SVC-2',
      employeeCount: 2,
      revenue: 100_000,
      source: 'qa-batch',
    })
    warmId = warm!.id
    prospectIds.push(warmId)

    await service.updateProspect(hotId, { status: 'aprobat' })
  })

  it('filtrează după search (nume sau cif) fără să crape (bug reprodus manual: alias în WHERE)', async () => {
    const bySearch = await service.listProspects({ search: 'QA HOT' })
    expect(bySearch.some((p) => p.id === hotId)).toBe(true)

    const byCif = await service.listProspects({ search: 'QA-SVC-2' })
    expect(byCif.some((p) => p.id === warmId)).toBe(true)
  })

  it('filtrează după search și pe telefon/email/persoană de contact (nu doar nume/cif)', async () => {
    expect((await service.listProspects({ search: '0700000000' })).some((p) => p.id === hotId)).toBe(true)
    expect((await service.listProspects({ search: 'qa@hot.example' })).some((p) => p.id === hotId)).toBe(true)
    expect((await service.listProspects({ search: 'Ion Popescu' })).some((p) => p.id === hotId)).toBe(true)
    expect((await service.listProspects({ search: 'nu-exista-nicaieri' })).some((p) => p.id === hotId)).toBe(false)
  })

  it('filtrează după priority — folosește expresia CASE WHEN, nu alias-ul din SELECT', async () => {
    const hotRows = await service.listProspects({ priority: 'HOT', source: 'qa-batch' })
    expect(hotRows.map((p) => p.id)).toContain(hotId)
    expect(hotRows.map((p) => p.id)).not.toContain(warmId)
  })

  it('filtrează după status', async () => {
    const approved = await service.listProspects({ status: 'aprobat', source: 'qa-batch' })
    expect(approved.map((p) => p.id)).toEqual([hotId])
  })

  it('filtrează după source', async () => {
    const bySource = await service.listProspects({ source: 'qa-batch' })
    expect(bySource).toHaveLength(2)
  })

  it('fiecare rând are câmpul priority derivat, nu stocat', async () => {
    const rows = await service.listProspects({ source: 'qa-batch' })
    const hotRow = rows.find((p) => p.id === hotId)
    expect(hotRow?.priority).toBe('HOT')
  })
})

describe('createProspect / updateProspect — scor recalculat', () => {
  it('calculează scorul la creare din datele financiare', async () => {
    const row = await service.createProspect({
      name: 'QA SCORE FIRMA SRL',
      cif: 'QA-SVC-3',
      employeeCount: 10,
      revenue: 3_000_000,
      profit: 300_000,
      debt: 50_000,
      equity: 1_000_000,
      cash: 200_000,
      website: 'https://qa.example',
      phone: '0700000001',
      email: 'a@qa.example',
      contactName: 'X',
    })
    prospectIds.push(row!.id)
    expect(Number(row!.score)).toBeGreaterThan(0)
  })

  it('actualizarea parțială (doar notes) NU resetează datele financiare și recalculează scorul la fel', async () => {
    const created = await service.createProspect({ name: 'QA UPDATE FIRMA SRL', cif: 'QA-SVC-4', employeeCount: 10, revenue: 2_000_000 })
    prospectIds.push(created!.id)
    const scoreBefore = created!.score

    const updated = await service.updateProspect(created!.id, { notes: 'notă QA' })
    expect(updated?.notes).toBe('notă QA')
    expect(updated?.revenue).toBe(created!.revenue)
    expect(updated?.score).toBe(scoreBefore)
  })
})

describe('deleteProspect', () => {
  it('soft-delete — nu mai apare în listProspects', async () => {
    const created = await service.createProspect({ name: 'QA DELETE FIRMA SRL', cif: 'QA-SVC-5' })
    prospectIds.push(created!.id)

    await service.deleteProspect(created!.id)
    const rows = await service.listProspects({ search: 'QA DELETE FIRMA' })
    expect(rows).toHaveLength(0)
  })
})

describe('promoteProspect', () => {
  it('creează billing_client și leagă prospectul, status devine aprobat', async () => {
    const created = await service.createProspect({ name: 'QA PROMOTE FIRMA SRL', cif: '11223344' })
    prospectIds.push(created!.id)

    const promoted = await service.promoteProspect(created!.id, { address: 'Str. Test nr. 1' })
    expect(promoted?.billingClientId).toBeTruthy()
    expect(promoted?.status).toBe('aprobat')
    billingClientIds.push(promoted!.billingClientId!)

    const [client] = await db.select().from(billingClients).where(eq(billingClients.id, promoted!.billingClientId!))
    expect(client?.name).toBe('QA PROMOTE FIRMA SRL')
    expect(client?.address).toBe('Str. Test nr. 1')
  })

  it('respinge promovarea dacă lipsește CIF-ul (prospect + input)', async () => {
    const created = await service.createProspect({ name: 'QA NOCIF FIRMA SRL' })
    prospectIds.push(created!.id)

    await expect(service.promoteProspect(created!.id, { address: 'Str. Test nr. 2' })).rejects.toThrow(/CIF/)
  })
})

describe('markProspectUnsubscribedByEmail (2026-08-11)', () => {
  it('setează status=dezabonat pe potrivire exactă de email, case-insensitive', async () => {
    const created = await service.createProspect({ name: 'QA UNSUB FIRMA SRL', email: 'Contact@Example.COM' })
    prospectIds.push(created!.id)

    const updated = await service.markProspectUnsubscribedByEmail('contact@example.com')
    expect(updated?.id).toBe(created!.id)
    expect(updated?.status).toBe('dezabonat')
  })

  it('e no-op (null) când niciun prospect nu are emailul respectiv', async () => {
    const updated = await service.markProspectUnsubscribedByEmail('nimeni@nu-exista.example.com')
    expect(updated).toBeNull()
  })

  it('nu atinge un prospect soft-deletat cu același email', async () => {
    const created = await service.createProspect({ name: 'QA UNSUB DELETED SRL', email: 'deleted@example.com' })
    prospectIds.push(created!.id)
    await service.deleteProspect(created!.id)

    const updated = await service.markProspectUnsubscribedByEmail('deleted@example.com')
    expect(updated).toBeNull()
  })
})

describe('scoring config', () => {
  it('getScoringConfig creează un rând default dacă nu există niciunul', async () => {
    const config = await service.getScoringConfig()
    expect(config).toBeTruthy()
    expect(Number(config.hotThreshold)).toBeGreaterThan(0)
  })
})

describe('catalog statusuri prospect (Wave 0/1, sprint de-hardcodare 2026-08-20)', () => {
  it('listProspectStatuses întoarce cele 10 seed-uite, ordonate după sortOrder', async () => {
    const rows = await service.listProspectStatuses()
    expect(rows.length).toBeGreaterThanOrEqual(10)
    expect(rows[0]!.key).toBe('necontactat')
    expect(rows[0]!.isDefault).toBe(true)
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.sortOrder).toBeGreaterThan(rows[i - 1]!.sortOrder)
  })

  it('createProspectStatus adaugă un status nou la finalul ordinii', async () => {
    const before = await service.listProspectStatuses()
    const created = await service.createProspectStatus({ key: 'qa_status_nou', label: 'QA Status Nou', colorToken: 'indigo' })
    expect(created.sortOrder).toBe(before.length)

    const updated = await service.updateProspectStatus(created.id, { label: 'QA Status Editat', colorToken: 'blue' })
    expect(updated?.label).toBe('QA Status Editat')

    const deleted = await service.deleteProspectStatus(created.id)
    expect(deleted?.deletedAt).toBeTruthy()
  })

  it('createProspectStatus respinge un key deja folosit (409)', async () => {
    await expect(service.createProspectStatus({ key: 'necontactat', label: 'Duplicat', colorToken: 'slate' })).rejects.toThrow(
      service.ProspectStatusKeyTakenError,
    )
  })

  it('deleteProspectStatus respinge (409) dacă un prospect activ mai folosește statusul', async () => {
    const status = await service.createProspectStatus({ key: 'qa_status_in_uz', label: 'QA În uz', colorToken: 'red' })
    const prospect = await service.createProspect({ name: 'QA STATUS IN USE SRL', cif: 'QA-STATUS-1' })
    prospectIds.push(prospect!.id)
    await service.updateProspect(prospect!.id, { status: 'qa_status_in_uz' })

    await expect(service.deleteProspectStatus(status.id)).rejects.toThrow(service.ProspectStatusInUseError)

    // curățare — reasignează prospectul, apoi șterge statusul, ca alte teste să nu vadă rândul orfan
    await service.updateProspect(prospect!.id, { status: 'necontactat' })
    await service.deleteProspectStatus(status.id)
  })

  it('reorderProspectStatuses rescrie sortOrder în ordinea dată', async () => {
    const rows = await service.listProspectStatuses()
    const reversedIds = rows.map((r) => r.id).reverse()
    const reordered = await service.reorderProspectStatuses(reversedIds)
    expect(reordered.map((r) => r.id)).toEqual(reversedIds)

    // restaurăm ordinea originală, ca alte teste (care presupun necontactat primul) să nu pice
    await service.reorderProspectStatuses(rows.map((r) => r.id))
  })

  it('reorderProspectStatuses respinge orderedIds care nu corespund exact statusurilor active', async () => {
    await expect(service.reorderProspectStatuses(['00000000-0000-0000-0000-000000000000'])).rejects.toThrow(
      service.InvalidProspectStatusError,
    )
  })

  it('updateProspect respinge un status care nu există în catalogul activ', async () => {
    const created = await service.createProspect({ name: 'QA BADSTATUS FIRMA SRL', cif: 'QA-STATUS-2' })
    prospectIds.push(created!.id)
    await expect(service.updateProspect(created!.id, { status: 'status_inexistent' })).rejects.toThrow(service.InvalidProspectStatusError)
  })
})

describe('responsabil per prospect', () => {
  const email = 'qa-prospect-owner@example.com'
  let prospectId: string
  let ownerId: string

  beforeAll(async () => {
    await db.delete(users).where(eq(users.email, email))
    const [owner] = await db.insert(users).values({ email, passwordHash: 'x', displayName: 'QA Owner' }).returning()
    ownerId = owner!.id
    const prospect = await service.createProspect({ name: 'QA OWNER FIRMA SRL', cif: 'QA-SVC-OWNER' })
    prospectId = prospect!.id
    prospectIds.push(prospectId)
  })

  afterAll(async () => {
    await db.delete(auditLog).where(eq(auditLog.entityId, prospectId))
    await db.update(prospects).set({ assignedUserId: null }).where(eq(prospects.id, prospectId))
    await db.delete(users).where(eq(users.id, ownerId))
  })

  it('assigns an active colleague and writes the change to the history', async () => {
    const row = await service.updateProspect(prospectId, { assignedUserId: ownerId })
    expect(row?.assignedUserId).toBe(ownerId)
    const entries = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, prospectId), eq(auditLog.action, 'prospect.responsabil.schimbat')))
    expect(entries).toHaveLength(1)
    expect(entries[0]!.changes).toEqual({ responsabil: [null, 'QA Owner'] })
    expect((await service.listAssignees()).some((a) => a.id === ownerId)).toBe(true)
  })

  it('refuses someone who is not an active colleague', async () => {
    await db.update(users).set({ status: 'disabled' }).where(eq(users.id, ownerId))
    await expect(service.updateProspect(prospectId, { assignedUserId: ownerId })).rejects.toBeInstanceOf(service.InvalidAssigneeError)
    await db.update(users).set({ status: 'active' }).where(eq(users.id, ownerId))
  })
})
