import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// A text a person reads belongs in src/locales, in each language. This test finds Romanian
// written straight into code: string literals with diacritics, outside the places listed below.
// Comments are not looked at, and neither are log lines, which are for the operator.

const SRC = resolve(__dirname, '../..')
const DIACRITICS = /[ăâîșțĂÂÎȘȚşţŞŢ]/

/** Paths (relative to src) that keep Romanian on purpose, each with its reason. */
const KEPT_IN_ROMANIAN: Array<[path: string, why: string]> = [
  ['locales/', 'the texts themselves'],
  ['scripts/', 'one-off maintenance scripts, read by the operator'],
  ['shared/testing/', 'test helpers'],
  ['shared/db/seed-demo.ts', 'demo rows, written in both languages'],
  ['shared/lib/contract-template-bodies.ts', 'contracts are Romanian legal documents'],
  ['shared/lib/contract-templates.ts', 'contracts are Romanian legal documents'],
  ['shared/lib/pdf-signature-fields.ts', 'finds the signature lines of the Romanian contracts'],
  ['shared/lib/documents.ts', 'the invoice PDF is a Romanian fiscal document'],
  ['shared/lib/financial-archive.ts', 'folder names of the fiscal archive'],
  ['shared/lib/payment-confirmation.ts', 'email to a client'],
  ['shared/config.ts', 'unsubscribe line of emails to clients'],
  ['connectors/anaf/', 'e-Factura XML and declarations for the Romanian tax authority'],
  ['modules/accounting/d301.ts', 'VAT declarations'],
  ['modules/accounting/quarterly-package.ts', 'package for the accountant'],
  ['modules/pricing/price-sheet.ts', 'price sheet sent to clients'],
  ['modules/prospects/import-service.ts', 'column names of the Romanian company registry export'],
  ['modules/email/service.ts', 'unsubscribe footer of emails to clients'],
  ['modules/email/routes.ts', 'unsubscribe page shown to email recipients'],
  ['modules/assistant/tools/', 'tool descriptions, read by the model'],
  ['modules/assistant/system-prompt.ts', 'instructions for the model'],
  ['jobs/billing-cycle-rollover.ts', 'emails to clients'],
  ['jobs/poll-anaf-upload-status.ts', 'email to a client, with the invoice attached'],
]

const LOG_CALL = /(^|\.)(log|logger|console)\.(trace|debug|info|warn|error|fatal|log)$/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) out.push(path)
  }
  return out
}

function isInsideLogCall(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && LOG_CALL.test(parent.expression.getText())) return true
    if (ts.isFunctionLike(parent)) return false
  }
  return false
}

function romanianLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    const isText =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    if (isText && DIACRITICS.test(node.text) && !isInsideLogCall(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      found.push(`${relative(SRC, file)}:${line}  ${node.text.trim().slice(0, 60)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('Romanian text in backend code', () => {
  it('lives only in src/locales and in the documents that stay Romanian', () => {
    const files = sourceFiles(SRC).filter((file) => !KEPT_IN_ROMANIAN.some(([path]) => relative(SRC, file).startsWith(path)))
    expect(files.flatMap(romanianLiterals)).toEqual([])
  })

  it('every exception still exists', () => {
    const gone = KEPT_IN_ROMANIAN.filter(([path]) => {
      try {
        statSync(join(SRC, path))
        return false
      } catch {
        return true
      }
    })
    expect(gone.map(([path]) => path)).toEqual([])
  })
})
