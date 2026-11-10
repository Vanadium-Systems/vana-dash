/**
 * Integration test on a real Postgres (test/setup.ts). The export has the list's visibility:
 * an agent without `clienti.toti` never gets a colleague's prospect, and the audit row carries
 * counts and filters, not prospect data.
 */
import ExcelJS from 'exceljs'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, prospects } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { exportProspects } from './export-service.js'
import * as service from './service.js'

const userIds: string[] = []
const AGENT = ['clienti.view', 'clienti.prospectare', 'clienti.export']

let a: SessionUser
let b: SessionUser

beforeAll(async () => {
  a = await createTestUser('exp-a', userIds, { features: AGENT })
  b = await createTestUser('exp-b', userIds, { features: [...AGENT, 'clienti.toti'] })
  await service.createProspect(a, { name: 'QA Exp Mine SRL', cif: '99200001', phone: '0722 200 001', email: 'mine@exp.example', contactName: 'Ana', revenue: 1234.5 })
  await service.createProspect(b, { name: 'QA Exp Theirs SRL', cif: '99200002' })
  await service.createProspect(a, { name: '=QA Exp HYPERLINK("http://evil.example")', cif: '99200003' })
})

afterAll(async () => {
  await db.delete(prospects).where(inArray(prospects.cif, ['99200001', '99200002', '99200003']))
  await db.delete(auditLog).where(and(eq(auditLog.action, 'prospect.export'), inArray(auditLog.actorUserId, userIds)))
  await cleanupTestUsers(userIds)
})

describe('exportProspects', () => {
  it('an agent without clienti.toti exports their own, not a colleague’s; the file is csv with BOM and ;', async () => {
    const file = await exportProspects(a, { f: [], q: 'exp', format: 'csv' })
    const text = file.body.toString('utf-8')
    expect(text.startsWith('﻿')).toBe(true)
    expect(text).toContain('QA Exp Mine SRL;99200001;')
    expect(text).toContain(';0722 200 001;mine@exp.example;Ana;')
    expect(text).not.toContain('QA Exp Theirs SRL')
    expect(file.filename).toMatch(/^prospects-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(file.contentType).toContain('text/csv')
  })

  it('clienti.toti exports everyone’s, and a text starting with = is neutralised', async () => {
    const text = (await exportProspects(b, { f: [], q: 'exp', format: 'csv' })).body.toString('utf-8')
    expect(text).toContain('QA Exp Theirs SRL')
    expect(text).toContain(`"'=QA Exp HYPERLINK(""http://evil.example"")"`)
  })

  it('xlsx opens with a header row and numbers as numbers', async () => {
    const file = await exportProspects(a, { f: [], q: 'QA Exp Mine', format: 'xlsx' })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(file.body as unknown as ExcelJS.Buffer)
    const sheet = workbook.worksheets[0]!
    expect(sheet.rowCount).toBe(2)
    expect(sheet.getRow(2).getCell(1).value).toBe('QA Exp Mine SRL')
    expect(sheet.getRow(2).getCell(12).value).toBe(1234.5)
  })

  it('writes one audit row with rows, filters and format, and no prospect data', async () => {
    await exportProspects(a, { f: [], q: 'QA Exp Mine', format: 'csv' })
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.action, 'prospect.export'), eq(auditLog.actorUserId, a.id)))
    const last = rows.at(-1)
    expect(last?.changes).toEqual({ rows: [null, 1], f: [null, []], q: [null, 'QA Exp Mine'], format: [null, 'csv'] })
    expect(JSON.stringify(last)).not.toContain('99200001')
  })
})
