import ExcelJS from 'exceljs'
import { recordAudit } from '../../shared/lib/audit.js'
import { tr, type TrKey } from '../../shared/lib/i18n.js'
import { currentLocale } from '../../shared/lib/request-context.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { EXPORT_MAX_ROWS, type ExportQuery } from './import-schema.js'
import * as service from './service.js'

export class ExportTooManyError extends Error {
  readonly code = 'EXPORT_TOO_MANY_ROWS'
  constructor() {
    super(tr('errors.prospects.exportTooMany', { max: EXPORT_MAX_ROWS.toLocaleString(currentLocale()) }))
  }
}

const COLUMNS = ['name', 'cui', 'status', 'owner', 'score', 'priority', 'phone', 'email', 'person', 'caen', 'employees', 'revenue', 'value', 'currency', 'expectedClose', 'lastActivity', 'source'] as const

type Cell = string | number | null

// A text cell that starts with one of these is run as a formula by Excel and Sheets, and the
// prospect data comes from files and registers nobody here wrote.
const FORMULA_START = /^[=+\-@\t\r]/
const csvText = (v: string) => (FORMULA_START.test(v) ? `'${v}` : v)

const day = (d: Date | string | null) => (d === null ? null : (d instanceof Date ? d.toISOString() : d).slice(0, 10))
const num = (v: string | null) => (v === null ? null : Number(v))

function csvCell(v: Cell, decimalComma: boolean): string {
  if (v === null) return ''
  const text = typeof v === 'number' ? (decimalComma ? String(v).replace('.', ',') : String(v)) : csvText(v)
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export async function exportProspects(me: Pick<SessionUser, 'id' | 'features'>, query: ExportQuery) {
  const found = await service.listForExport(me, { f: query.f, q: query.q }, EXPORT_MAX_ROWS + 1)
  if (found.length > EXPORT_MAX_ROWS) throw new ExportTooManyError()

  const header = COLUMNS.map((c) => tr(`prospectImport.export.columns.${c}` as TrKey))
  const rows: Cell[][] = found.map((p) => [
    p.name,
    p.cif,
    p.statusLabel ?? p.status,
    p.ownerName,
    num(p.score),
    p.priority,
    p.primaryPhone,
    p.primaryEmail,
    p.primaryPerson,
    p.caenCode,
    p.employeeCount,
    num(p.revenue),
    num(p.valueAmount),
    p.valueCurrency,
    day(p.expectedCloseAt),
    day(p.lastActivityAt),
    p.source,
  ])

  await recordAudit({
    action: 'prospect.export',
    entityType: 'prospect',
    actorUserId: me.id,
    changes: { rows: [null, rows.length], f: [null, query.f], q: [null, query.q ?? null], format: [null, query.format] },
  })

  const stamp = new Date().toISOString().slice(0, 10)
  if (query.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(tr('prospectImport.export.sheet'))
    sheet.addRow(header).font = { bold: true }
    for (const row of rows) sheet.addRow(row)
    sheet.columns.forEach((column) => {
      column.width = 20
    })
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    return {
      filename: `prospects-${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Buffer.from(await workbook.xlsx.writeBuffer()),
    }
  }

  const decimalComma = currentLocale() === 'ro'
  const lines = [header, ...rows].map((row) => row.map((v) => csvCell(v, decimalComma)).join(';'))
  return {
    filename: `prospects-${stamp}.csv`,
    contentType: 'text/csv; charset=utf-8',
    // The BOM is what makes Excel read the file as UTF-8.
    body: Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf-8'),
  }
}
