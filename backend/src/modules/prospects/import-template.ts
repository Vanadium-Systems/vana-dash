import ExcelJS from 'exceljs'
import { tr, type TrKey } from '../../shared/lib/i18n.js'

// Order of the template columns; the header text of each is in the locale files, and the parser
// recognises every one of them (import-service.test.ts keeps both in step).
const COLUMNS = ['name', 'cui', 'phone', 'email', 'contact', 'website', 'caen', 'employees', 'revenue', 'year', 'status', 'notes', 'owner'] as const
// Only the name is needed to create a row; the tax id is what finds the companies that already exist.
const REQUIRED = new Set<(typeof COLUMNS)[number]>(['name'])

const key = (path: string) => `prospectImport.${path}` as TrKey

export async function buildImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()

  const data = workbook.addWorksheet(tr(key('sheetData')))
  data.addRow(COLUMNS.map((c) => tr(key(`columns.${c}.header`))))
  data.addRow(COLUMNS.map((c) => tr(key(`columns.${c}.example`))))
  data.getRow(1).font = { bold: true }
  data.columns.forEach((column) => {
    column.width = 22
  })
  // Text format on the phone and tax id columns keeps a leading zero when someone types over the example.
  for (const c of ['cui', 'phone'] as const) data.getColumn(COLUMNS.indexOf(c) + 1).numFmt = '@'
  data.views = [{ state: 'frozen', ySplit: 1 }]

  const guide = workbook.addWorksheet(tr(key('sheetGuide')))
  guide.addRow([tr(key('guideColumn')), tr(key('guideRequired')), tr(key('guideFormat'))])
  guide.getRow(1).font = { bold: true }
  for (const c of COLUMNS) {
    guide.addRow([tr(key(`columns.${c}.header`)), tr(key(REQUIRED.has(c) ? 'required' : 'optional')), tr(key(`columns.${c}.help`))])
  }
  guide.getColumn(1).width = 26
  guide.getColumn(2).width = 16
  guide.getColumn(3).width = 90

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
