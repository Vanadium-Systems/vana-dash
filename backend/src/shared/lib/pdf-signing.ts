import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { PdfSignatureInfo } from '../db/schema/contract-documents.js'
import { httpError } from './http-error.js'

const execFileAsync = promisify(execFile)

// pyHanko in its own venv (infra/backend.Dockerfile, backend/signing/requirements.txt): pdf-lib rewrites
// the whole file, which would break a qualified signature made before; pyHanko only appends a revision.
const PYTHON = process.env.PDFSIGN_PYTHON ?? '/opt/pdfsign/bin/python'
const SCRIPT = fileURLToPath(new URL('../../../signing/pdfsign.py', import.meta.url))
const TIMEOUT_MS = 60_000

export function isSigningAvailable(): boolean {
  return existsSync(PYTHON) && existsSync(SCRIPT)
}

/** Runs pdfsign.py in a scratch folder of /tmp that is removed whatever happens (keys included). */
async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  if (!isSigningAvailable()) throw httpError(400, 'PDF_SIGNING_UNAVAILABLE')
  const dir = await mkdtemp(join(tmpdir(), 'pdfsign-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function run(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(PYTHON, [SCRIPT, ...args], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const failure = err as { code?: number; stderr?: string }
    // Exit 2: the file breaks a rule (no field left to sign, not an append); the caller says which.
    if (failure.code === 2) throw httpError(400, 'PDF_SIGNATURE_RULE', { reason: (failure.stderr ?? '').trim().slice(0, 200) })
    throw err
  }
}

export async function generateSigningCertificate(commonName: string): Promise<{ certPem: string; keyPem: string }> {
  return withScratch(async () => JSON.parse(await run(['gen-cert', '--cn', commonName])) as { certPem: string; keyPem: string })
}

export interface PdfInspection {
  signatures: PdfSignatureInfo[]
  emptyFields: string[]
}

export async function inspectPdf(pdf: Buffer): Promise<PdfInspection> {
  return withScratch(async (dir) => {
    const path = join(dir, 'in.pdf')
    await writeFile(path, pdf)
    return JSON.parse(await run(['inspect', path])) as PdfInspection
  })
}

/** Signs every empty Semnatura_<role> field with the company's certificate and the drawn signature as appearance. */
export async function fillSignatureFields(input: {
  pdf: Buffer
  role: string
  certPem: string
  keyPem: string
  signerName: string
  signaturePng: Buffer
}): Promise<{ pdf: Buffer; fields: string[] }> {
  return withScratch(async (dir) => {
    const paths = { src: join(dir, 'in.pdf'), dst: join(dir, 'out.pdf'), cert: join(dir, 'c.pem'), key: join(dir, 'k.pem'), image: join(dir, 's.png') }
    await Promise.all([
      writeFile(paths.src, input.pdf),
      writeFile(paths.cert, input.certPem),
      writeFile(paths.key, input.keyPem, { mode: 0o600 }),
      writeFile(paths.image, input.signaturePng),
    ])
    const out = JSON.parse(
      await run(['fill', paths.src, paths.dst, '--role', input.role, '--cert', paths.cert, '--key', paths.key, '--name', input.signerName, '--image', paths.image]),
    ) as { fields: string[] }
    return { pdf: await readFile(paths.dst), fields: out.fields }
  })
}

/** True when `next` is `previous` with at least one more signature appended and every signature intact. */
export async function isSignedAppend(previous: Buffer, next: Buffer): Promise<boolean> {
  try {
    await withScratch(async (dir) => {
      await Promise.all([writeFile(join(dir, 'old.pdf'), previous), writeFile(join(dir, 'new.pdf'), next)])
      await run(['check-append', join(dir, 'old.pdf'), join(dir, 'new.pdf')])
    })
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'PDF_SIGNATURE_RULE') return false
    throw err
  }
}
