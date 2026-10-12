import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// A text shown on screen belongs in src/locales, in each language. The lint rule catches a
// literal written in JSX; this test catches the rest (a label map, a toast, a helper), by
// looking for Romanian diacritics in string literals and JSX text. Comments are not looked at.

const SRC = resolve(__dirname, '..')
const DIACRITICS = /[ăâîșțĂÂÎȘȚşţŞŢ]/

/** Paths (relative to src) that keep Romanian on purpose, each with its reason. */
const KEPT_IN_ROMANIAN: Array<[path: string, why: string]> = [
  ['locales/', 'the texts themselves'],
  ['modules/help/guides.ts', 'guides carry both languages in the file'],
  ['modules/updates/releases.ts', 'release notes carry both languages in the file'],
  ['shared/lib/locale.ts', 'the name of the Romanian language, in Romanian'],
  ['modules/accounting/AddendumFormDialog.tsx', 'a default clause that goes into a Romanian contract'],
]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path)
  }
  return out
}

function romanianLiterals(file: string): string[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    if (isText && DIACRITICS.test(node.text)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      found.push(`${relative(SRC, file)}:${line}  ${node.text.trim().slice(0, 60)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('Romanian text in frontend code', () => {
  it('lives only in src/locales and in the files that carry both languages', () => {
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
