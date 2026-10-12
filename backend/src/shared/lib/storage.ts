import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { tr } from './i18n.js'

// Stocare locală pentru documentele generate/descărcate (XML e-Factura, PDF facturi).
// STORAGE_DIR e un folder local în dev și un volum Docker în prod.
// În DB se salvează doar calea relativă — niciodată conținutul.

function resolveSafe(relativePath: string): string {
  const root = path.resolve(config.storageDir)
  const full = path.resolve(root, relativePath)
  if (!full.startsWith(root + path.sep)) {
    throw new Error(tr('errors.files.pathOutsideStorage', { relativePath }))
  }
  return full
}

export async function saveDocument(relativePath: string, content: string | Buffer): Promise<string> {
  const full = resolveSafe(relativePath)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, content)
  return relativePath
}

export async function readDocument(relativePath: string): Promise<Buffer> {
  return readFile(resolveSafe(relativePath))
}
