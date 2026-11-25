import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { markSignatureRoles } from './pdf-signature-fields.js'
import { fillSignatureFields, generateSigningCertificate, inspectPdf, isSignedAppend, isSigningAvailable } from './pdf-signing.js'
import { closeBrowser, htmlToPdf, isPdfAvailable } from './pdf.js'

const execFileAsync = promisify(execFile)
const PYTHON = process.env.PDFSIGN_PYTHON ?? '/opt/pdfsign/bin/python'
const ready = isSigningAvailable() && isPdfAvailable() && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH ?? '')

// pyHanko, as the owner would do it on webSIGN: a signature field of its own, signed (optionally certified).
const OWNER_SIGN = `
import sys
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers
from pyhanko.sign.fields import MDPPerm, SigFieldSpec
src, dst, cert, key, field, mode = sys.argv[1:7]
signer = signers.SimpleSigner.load(key, cert)
writer = IncrementalPdfFileWriter(open(src, 'rb'))
fields.append_signature_field(writer, SigFieldSpec(field, box=(40, 760, 200, 800)))
extra = {'certify': True, 'docmdp_permissions': MDPPerm.FILL_FORMS} if mode == 'certify' else {}
meta = signers.PdfSignatureMetadata(field_name=field, name='Owner', **extra)
signers.PdfSigner(meta, signer=signer).sign_pdf(writer, output=open(dst, 'wb'))
`

async function pyhankoSign(pdf: Buffer, cert: { certPem: string; keyPem: string }, field: string, mode: 'plain' | 'certify'): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfsign-test-'))
  try {
    const p = { src: join(dir, 'in.pdf'), dst: join(dir, 'out.pdf'), cert: join(dir, 'c.pem'), key: join(dir, 'k.pem') }
    await Promise.all([writeFile(p.src, pdf), writeFile(p.cert, cert.certPem), writeFile(p.key, cert.keyPem)])
    await execFileAsync(PYTHON, ['-c', OWNER_SIGN, p.src, p.dst, p.cert, p.key, field, mode], { timeout: 60_000 })
    return await readFile(p.dst)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, tail])
}
/** A 16x8 black-on-transparent RGBA PNG: enough for pyHanko to draw. */
function tinyPng(): Buffer {
  const width = 16
  const height = 8
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x80)])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const HTML = `<!doctype html><html><body><h1>Contract QA</h1>
<p data-sign-role="Colaborator">Semnătură colaborator</p><div style="height:300pt"></div>
<p data-sign-role="Colaborator">Semnătură colaborator, anexa</p></body></html>`

describe.skipIf(!ready)('pdf-signing', () => {
  let ownerCert: { certPem: string; keyPem: string }
  let blank: Buffer
  let ownerSigned: Buffer
  let ownerCertified: Buffer
  const png = tinyPng()
  const fill = (pdf: Buffer, role = 'Colaborator') => fillSignatureFields({ pdf, role, certPem: ownerCert.certPem, keyPem: ownerCert.keyPem, signerName: 'Ion Popescu', signaturePng: png })

  beforeAll(async () => {
    ownerCert = await generateSigningCertificate('QA Owner')
    blank = await htmlToPdf(markSignatureRoles(HTML), { isolated: true, signatureFields: true })
    ownerSigned = await pyhankoSign(blank, ownerCert, 'Signature1', 'plain')
    ownerCertified = await pyhankoSign(blank, ownerCert, 'Signature1', 'certify')
  }, 120_000)

  afterAll(async () => {
    await closeBrowser()
  })

  it('starts from a PDF with two empty collaborator fields', async () => {
    const inspection = await inspectPdf(blank)
    expect(inspection.signatures).toEqual([])
    expect(inspection.emptyFields.sort()).toEqual(['Semnatura_Colaborator', 'Semnatura_Colaborator_2'])
  })

  it('fills both fields after the owner signed and leaves the owner signature valid (FORM_FILLING)', async () => {
    const out = await fill(ownerSigned)
    expect(out.fields.sort()).toEqual(['Semnatura_Colaborator', 'Semnatura_Colaborator_2'])
    expect(out.pdf.subarray(0, ownerSigned.length).equals(ownerSigned)).toBe(true)

    const { signatures, emptyFields } = await inspectPdf(out.pdf)
    expect(emptyFields).toEqual([])
    expect(signatures.map((s) => s.field).sort()).toEqual(['Semnatura_Colaborator', 'Semnatura_Colaborator_2', 'Signature1'])
    const owner = signatures.find((s) => s.field === 'Signature1')!
    expect(owner).toMatchObject({ intact: true, valid: true, modificationLevel: 'FORM_FILLING', coversWholeDocument: false })
    for (const s of signatures.filter((s) => s.field !== 'Signature1')) expect(s).toMatchObject({ intact: true, valid: true })
  }, 60_000)

  it('does the same for a certified (FILL_FORMS) owner signature', async () => {
    const out = await fill(ownerCertified)
    const { signatures } = await inspectPdf(out.pdf)
    expect(signatures).toHaveLength(3)
    const owner = signatures.find((s) => s.field === 'Signature1')!
    expect(owner).toMatchObject({ intact: true, valid: true, modificationLevel: 'FORM_FILLING' })
    expect(signatures.filter((s) => s.field !== 'Signature1').every((s) => s.intact && s.valid)).toBe(true)
  }, 60_000)

  it('flags a signature field added after the owner certified the file', async () => {
    const tampered = await pyhankoSign(ownerCertified, ownerCert, 'Extra_Field', 'plain')
    const { signatures } = await inspectPdf(tampered)
    const owner = signatures.find((s) => s.field === 'Signature1')!
    // The finding this test exists for: what pyHanko says about the certified signature once a new field appears.
    console.info('certified owner signature after an added field:', JSON.stringify(owner))
    expect(['NONE', 'FORM_FILLING']).not.toContain(owner.modificationLevel)
  }, 60_000)

  it('does not take a field added after the certified signature for a clean append', async () => {
    const tampered = await pyhankoSign(ownerCertified, ownerCert, 'Extra_Field', 'plain')
    expect(await isSignedAppend(ownerCertified, tampered)).toBe(false)
  }, 60_000)

  it('tells a real append from a changed or reversed file', async () => {
    const filled = (await fill(ownerSigned)).pdf
    expect(await isSignedAppend(ownerSigned, filled)).toBe(true)

    const changed = Buffer.from(filled)
    const at = Math.floor(ownerSigned.length / 2)
    changed[at] = changed[at]! ^ 0xff
    expect(await isSignedAppend(ownerSigned, changed)).toBe(false)

    expect(await isSignedAppend(filled, ownerSigned)).toBe(false)
    expect(await isSignedAppend(ownerSigned, ownerSigned)).toBe(false)
  }, 60_000)

  it('refuses to fill a file with no free field left', async () => {
    const filled = (await fill(ownerSigned)).pdf
    await expect(fill(filled)).rejects.toMatchObject({ code: 'PDF_SIGNATURE_RULE' })
    await expect(fill(ownerSigned, 'Martor')).rejects.toMatchObject({ code: 'PDF_SIGNATURE_RULE' })
  }, 60_000)
})
