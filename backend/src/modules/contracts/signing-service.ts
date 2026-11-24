import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { contractDocuments, contracts, contractSignEvents, contractSignRequests, dashboardConfig, users } from '../../shared/db/schema/index.js'
import type { SignRequestStatus } from '../../shared/db/schema/contract-signing.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { getCompany } from '../../shared/lib/company.js'
import { config } from '../../shared/config.js'
import { decryptField, encryptField } from '../../shared/lib/crypto.js'
import { sendEmail } from '../../shared/lib/email.js'
import { HttpError, httpError } from '../../shared/lib/http-error.js'
import { tr } from '../../shared/lib/i18n.js'
import { htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import { fillSignatureFields, generateSigningCertificate, inspectPdf, isSignedAppend } from '../../shared/lib/pdf-signing.js'
import { runAsTenant, withRlsBypass } from '../../shared/lib/tenancy.js'
import { readDocument, saveDocument } from '../../shared/lib/storage.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { getContract } from './registry-service.js'

const execFileAsync = promisify(execFile)
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Me = Pick<SessionUser, 'id' | 'isPlatformAdmin' | 'role'>

const SETTINGS_KEY = 'contract.signing'
const LINK_DAYS = 14
const DEFAULT_DOWNLOAD_DAYS = 30
const OTP_MINUTES = 10
const OTP_MAX_FAILURES = 5
const SESSION_MINUTES = 15
const MAX_SIGNATURE_PNG = 300 * 1024
// A simple electronic signature cannot replace the one the Labour Code requires (art. 16): employment
// contracts are signed with a qualified certificate or on paper, never through the link.
const NO_LINK_CATEGORIES = new Set(['angajare', 'cim', 'munca', 'employment'])
const ACTIVE: SignRequestStatus[] = ['sent', 'opened']

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

function sameHash(stored: string | null, value: string): boolean {
  if (!stored) return false
  const a = Buffer.from(stored, 'hex')
  const b = Buffer.from(sha256(value), 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── The company's signing certificate ─────────────────────────────────────────────────────────

interface StoredSigning {
  certPem?: string
  keyEnc?: string
  fingerprint?: string
  createdAt?: string
  downloadDays?: number
}

async function storedSigning(): Promise<StoredSigning> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, SETTINGS_KEY))
  return (row?.value ?? {}) as StoredSigning
}

async function saveSigning(next: StoredSigning) {
  await db
    .insert(dashboardConfig)
    .values({ key: SETTINGS_KEY, value: next })
    .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

/** What the settings page shows: never the key. */
export async function getSigningSettings() {
  const stored = await storedSigning()
  return {
    hasCertificate: Boolean(stored.certPem),
    fingerprint: stored.fingerprint ?? null,
    createdAt: stored.createdAt ?? null,
    downloadDays: stored.downloadDays ?? DEFAULT_DOWNLOAD_DAYS,
  }
}

export async function updateSigningSettings(input: { downloadDays: number }) {
  const stored = await storedSigning()
  await saveSigning({ ...stored, downloadDays: input.downloadDays })
  return getSigningSettings()
}

/** Self-signed, so Adobe shows "unknown signer"; the signing certificate page says how to check it (the hashes). */
export async function createSigningCertificate() {
  const company = await getCompany()
  if (!company.profile.name.trim()) throw httpError(400, 'COMPANY_PROFILE_INCOMPLETE')
  const { certPem, keyPem } = await generateSigningCertificate(`${company.profile.name.trim()} VanaDash`)
  const der = Buffer.from(certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64')
  const stored = await storedSigning()
  await saveSigning({ ...stored, certPem, keyEnc: await encryptField(keyPem), fingerprint: sha256(der), createdAt: new Date().toISOString() })
  await recordAudit({ action: 'contract.certificat.generat', entityType: 'contract_signing', changes: { amprenta: [stored.fingerprint ?? null, sha256(der)] } })
  return getSigningSettings()
}

async function signingKeys(): Promise<{ certPem: string; keyPem: string; fingerprint: string }> {
  const stored = await storedSigning()
  if (!stored.certPem || !stored.keyEnc) throw httpError(400, 'CONTRACT_SIGNING_CERT_MISSING')
  return { certPem: stored.certPem, keyPem: await decryptField(stored.keyEnc), fingerprint: stored.fingerprint ?? '' }
}

// ── Requests, from the contract page ──────────────────────────────────────────────────────────

const latestDocument = async (executor: Tx | typeof db, contractId: string) => {
  const [doc] = await executor
    .select()
    .from(contractDocuments)
    .where(and(eq(contractDocuments.contractId, contractId), isNull(contractDocuments.deletedAt), ne(contractDocuments.docType, 'sign_certificate')))
    .orderBy(desc(contractDocuments.createdAt))
    .limit(1)
  return doc ?? null
}

function publicLink(token: string) {
  return `${config.frontendOrigin}/semnare/${token}`
}

async function event(executor: Tx | typeof db, requestId: string, kind: (typeof contractSignEvents.$inferInsert)['kind'], meta: { ip?: string; userAgent?: string; sha?: string } = {}) {
  await executor.insert(contractSignEvents).values({ requestId, kind, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 400) ?? null, documentSha256: meta.sha ?? null })
}

/**
 * Sends the link. The last revision must already carry our signature (we sign first, on webSIGN),
 * unless the person sending says explicitly that it goes out unsigned.
 */
export async function createSignRequest(me: Me, contractId: string, input: { signerName: string; signerEmail: string; signerRole: string; unsigned: boolean }) {
  const contract = await getContract(me, contractId)
  if (NO_LINK_CATEGORIES.has(contract.category.trim().toLowerCase())) throw httpError(400, 'CONTRACT_SIGN_LINK_NOT_ALLOWED')
  if (contract.status === 'terminated' || contract.status === 'expired' || contract.status === 'signed') throw httpError(400, 'CONTRACT_SIGN_LINK_CLOSED')
  const doc = await latestDocument(db, contractId)
  if (!doc) throw httpError(400, 'CONTRACT_DOCUMENT_NOT_FOUND')
  await getSigningKeysOrFail()

  const inspection = await inspectPdf(await readDocument(doc.pdfStoragePath))
  const rolePattern = new RegExp(`^Semnatura_${input.signerRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d+)?$`, 'i')
  if (!inspection.emptyFields.some((f) => rolePattern.test(f))) throw httpError(400, 'CONTRACT_SIGN_NO_FIELD', { role: input.signerRole })
  const ownSigned = inspection.signatures.length > 0 && inspection.signatures.every((s) => s.intact)
  if (!ownSigned && !input.unsigned) throw httpError(409, 'CONTRACT_SIGN_OWN_SIGNATURE_MISSING')

  const token = randomBytes(32).toString('base64url')
  const request = await db.transaction(async (tx) => {
    await revokeActive(tx, contractId)
    await tx.update(contractDocuments).set({ signatures: inspection.signatures }).where(eq(contractDocuments.id, doc.id))
    const [row] = await tx
      .insert(contractSignRequests)
      .values({
        contractId,
        documentId: doc.id,
        signerName: input.signerName,
        signerEmail: input.signerEmail.toLowerCase(),
        signerRole: input.signerRole,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000),
        createdByUserId: me.id,
        updatedByUserId: me.id,
      })
      .returning()
    await event(tx, row!.id, 'sent', { sha: sha256(await readDocument(doc.pdfStoragePath)) })
    if (contract.status === 'draft') await tx.update(contracts).set({ status: 'to_sign', updatedAt: new Date() }).where(eq(contracts.id, contractId))
    return row!
  })
  const company = await getCompany()
  await sendEmail({
    to: request.signerEmail,
    from: config.emailFromNoreply || undefined,
    subject: tr('emails.contractSign.linkSubject', { company: company.profile.name, title: contract.title }),
    text: tr('emails.contractSign.linkBody', { name: request.signerName, company: company.profile.name, title: contract.title, link: publicLink(token), days: LINK_DAYS }),
  })
  await recordAudit({ action: 'contract.trimis.la.semnat', entityType: 'contract', entityId: contractId, changes: { semnatar: [null, request.signerEmail] } })
  return { id: request.id, link: publicLink(token), expiresAt: request.expiresAt.toISOString() }
}

async function getSigningKeysOrFail() {
  const stored = await storedSigning()
  if (!stored.certPem) throw httpError(400, 'CONTRACT_SIGNING_CERT_MISSING')
}

/** A newer revision of the contract (or a new request) makes the old links useless. */
export async function revokeActive(tx: Tx, contractId: string): Promise<void> {
  const revoked = await tx
    .update(contractSignRequests)
    .set({ status: 'revoked', sessionHash: null, updatedAt: new Date() })
    .where(and(eq(contractSignRequests.contractId, contractId), inArray(contractSignRequests.status, ACTIVE)))
    .returning({ id: contractSignRequests.id })
  for (const row of revoked) await event(tx, row.id, 'revoked')
}

export async function revokeSignRequest(me: Me, requestId: string) {
  const [request] = await db.select().from(contractSignRequests).where(eq(contractSignRequests.id, requestId))
  if (!request) throw httpError(404, 'CONTRACT_SIGN_REQUEST_NOT_FOUND')
  await getContract(me, request.contractId)
  if (!ACTIVE.includes(request.status)) throw httpError(400, 'CONTRACT_SIGN_REQUEST_CLOSED')
  await db.transaction(async (tx) => {
    await tx.update(contractSignRequests).set({ status: 'revoked', sessionHash: null, updatedAt: new Date(), updatedByUserId: me.id }).where(eq(contractSignRequests.id, requestId))
    await event(tx, requestId, 'revoked')
  })
}

/** The requests of a contract for its page, without any hash; someone else's contract answers 404. */
export async function listSignRequests(me: Me, contractId: string) {
  await getContract(me, contractId)
  const rows = await db.select().from(contractSignRequests).where(eq(contractSignRequests.contractId, contractId)).orderBy(desc(contractSignRequests.createdAt))
  return rows.map((r) => ({
    id: r.id,
    signerName: r.signerName,
    signerEmail: r.signerEmail,
    signerRole: r.signerRole,
    status: r.status !== 'signed' && ACTIVE.includes(r.status) && r.expiresAt < new Date() ? 'expired' : r.status,
    expiresAt: r.expiresAt.toISOString(),
    signedAt: r.signedAt?.toISOString() ?? null,
    signedDocumentId: r.signedDocumentId,
    certificateDocumentId: r.certificateDocumentId,
    declineReason: r.declineReason,
    createdAt: r.createdAt.toISOString(),
  }))
}

// ── The public side: /semnare/:token ──────────────────────────────────────────────────────────

export interface Visitor {
  ip: string
  userAgent: string
}

/**
 * The only cross-company read: the token says which company the request belongs to. Everything after
 * runs as that company (runAsTenant), so its policies apply as for any request.
 */
async function withRequest<T>(token: string, fn: (request: typeof contractSignRequests.$inferSelect) => Promise<T>): Promise<T> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw httpError(404, 'CONTRACT_SIGN_LINK_NOT_FOUND')
  const [found] = await withRlsBypass(() =>
    db.select({ id: contractSignRequests.id, tenantId: contractSignRequests.tenantId }).from(contractSignRequests).where(eq(contractSignRequests.tokenHash, sha256(token))),
  )
  if (!found) throw httpError(404, 'CONTRACT_SIGN_LINK_NOT_FOUND')
  return runAsTenant(found.tenantId, async () => {
    const [request] = await db.select().from(contractSignRequests).where(eq(contractSignRequests.id, found.id))
    return fn(request!)
  })
}

function assertOpen(request: typeof contractSignRequests.$inferSelect) {
  if (request.status === 'revoked') throw httpError(410, 'CONTRACT_SIGN_LINK_REVOKED')
  if (request.status === 'locked') throw httpError(423, 'CONTRACT_SIGN_LINK_LOCKED')
  if (request.status === 'declined') throw httpError(410, 'CONTRACT_SIGN_LINK_DECLINED')
  if (request.status === 'signed') throw httpError(409, 'CONTRACT_SIGN_ALREADY_SIGNED')
  if (request.expiresAt < new Date()) throw httpError(410, 'CONTRACT_SIGN_LINK_EXPIRED')
}

function maskEmail(email: string) {
  const [user, domain] = email.split('@')
  return `${user!.slice(0, 2)}***@${domain}`
}

export async function getPublicRequest(token: string, visitor: Visitor) {
  return withRequest(token, async (request) => {
    const [contract] = await db.select({ title: contracts.title }).from(contracts).where(eq(contracts.id, request.contractId))
    const company = await getCompany()
    if (request.status === 'sent') {
      await db.update(contractSignRequests).set({ status: 'opened', updatedAt: new Date() }).where(eq(contractSignRequests.id, request.id))
      await event(db, request.id, 'opened', visitor)
    }
    const expired = ACTIVE.includes(request.status) && request.expiresAt < new Date()
    return {
      company: company.profile.name,
      title: contract?.title ?? '',
      signerName: request.signerName,
      signerEmail: maskEmail(request.signerEmail),
      status: expired ? 'expired' : request.status === 'sent' ? 'opened' : request.status,
      expiresAt: request.expiresAt.toISOString(),
      canDownload: request.status === 'signed' && Boolean(request.downloadUntil && request.downloadUntil > new Date()),
    }
  })
}

export async function sendOtp(token: string, visitor: Visitor) {
  return withRequest(token, async (request) => {
    assertOpen(request)
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await db
      .update(contractSignRequests)
      .set({ otpHash: sha256(`${request.id}:${code}`), otpExpiresAt: new Date(Date.now() + OTP_MINUTES * 60_000), updatedAt: new Date() })
      .where(eq(contractSignRequests.id, request.id))
    await event(db, request.id, 'otp_sent', visitor)
    const company = await getCompany()
    await sendEmail({
      to: request.signerEmail,
      from: config.emailFromNoreply || undefined,
      subject: tr('emails.contractSign.codeSubject', { code }),
      text: tr('emails.contractSign.codeBody', { code, minutes: OTP_MINUTES, company: company.profile.name }),
    })
    return { sentTo: maskEmail(request.signerEmail) }
  })
}

/** A right code opens a 15-minute session bound to this request; five wrong ones lock the link and tell the sender. */
export async function verifyOtp(token: string, code: string, visitor: Visitor) {
  return withRequest(token, async (request) => {
    assertOpen(request)
    const fresh = request.otpExpiresAt && request.otpExpiresAt > new Date()
    if (!fresh || !sameHash(request.otpHash, `${request.id}:${code}`)) {
      const attempts = request.otpAttempts + 1
      const locked = attempts >= OTP_MAX_FAILURES
      await db
        .update(contractSignRequests)
        .set({ otpAttempts: attempts, status: locked ? 'locked' : request.status, otpHash: locked ? null : request.otpHash, updatedAt: new Date() })
        .where(eq(contractSignRequests.id, request.id))
      await event(db, request.id, locked ? 'locked' : 'otp_fail', visitor)
      if (locked) await tellOwner(request, 'locked')
      throw httpError(locked ? 423 : 400, locked ? 'CONTRACT_SIGN_LINK_LOCKED' : 'CONTRACT_SIGN_CODE_WRONG', { left: OTP_MAX_FAILURES - attempts })
    }
    const session = randomBytes(32).toString('base64url')
    await db
      .update(contractSignRequests)
      .set({ otpHash: null, otpAttempts: 0, sessionHash: sha256(session), sessionExpiresAt: new Date(Date.now() + SESSION_MINUTES * 60_000), updatedAt: new Date() })
      .where(eq(contractSignRequests.id, request.id))
    const pdf = await readDocument(await documentPath(request.documentId))
    await event(db, request.id, 'otp_ok', { ...visitor, sha: sha256(pdf) })
    return { session, sessionMinutes: SESSION_MINUTES, pageCount: await pageCount(pdf), documentSha256: sha256(pdf) }
  })
}

function assertSession(request: typeof contractSignRequests.$inferSelect, session: string | undefined) {
  if (!session || !request.sessionExpiresAt || request.sessionExpiresAt < new Date() || !sameHash(request.sessionHash, session)) {
    throw httpError(401, 'CONTRACT_SIGN_SESSION_REQUIRED')
  }
}

async function documentPath(documentId: string) {
  const [doc] = await db.select({ path: contractDocuments.pdfStoragePath }).from(contractDocuments).where(eq(contractDocuments.id, documentId))
  if (!doc) throw httpError(404, 'CONTRACT_DOCUMENT_NOT_FOUND')
  return doc.path
}

async function pageCount(pdf: Buffer): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'signpages-'))
  try {
    await writeFile(join(dir, 'in.pdf'), pdf)
    const { stdout } = await execFileAsync('pdfinfo', [join(dir, 'in.pdf')], { timeout: 20_000 })
    return Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1] ?? 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** One page as PNG (pdftoppm), so the phone needs no PDF viewer and the page CSP stays img-src 'self'. */
export async function renderPage(token: string, session: string | undefined, page: number): Promise<Buffer> {
  return withRequest(token, async (request) => {
    assertOpen(request)
    assertSession(request, session)
    const pdf = await readDocument(await documentPath(request.documentId))
    const dir = await mkdtemp(join(tmpdir(), 'signpage-'))
    try {
      await writeFile(join(dir, 'in.pdf'), pdf)
      await execFileAsync('pdftoppm', ['-png', '-r', '110', '-f', String(page), '-l', String(page), '-singlefile', join(dir, 'in.pdf'), join(dir, 'out')], { timeout: 30_000 })
      return await readFile(join(dir, 'out.png'))
    } catch {
      throw httpError(404, 'CONTRACT_SIGN_PAGE_NOT_FOUND')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/

export async function signRequest(token: string, session: string | undefined, input: { signaturePng: string; consent: true }, visitor: Visitor) {
  const match = PNG_DATA_URL.exec(input.signaturePng)
  const png = match ? Buffer.from(match[1]!, 'base64') : null
  if (!png || png.length > MAX_SIGNATURE_PNG || png.subarray(1, 4).toString('latin1') !== 'PNG') throw httpError(400, 'CONTRACT_SIGN_IMAGE_INVALID')

  return withRequest(token, async (request) => {
    assertOpen(request)
    assertSession(request, session)
    const keys = await signingKeys()
    const downloadDays = (await getSigningSettings()).downloadDays

    const result = await db.transaction(async (tx) => {
      // One signature at a time per contract: the second waits here and starts from the first one's file.
      await tx.execute(sql`SELECT 1 FROM ${contracts} WHERE "id" = ${request.contractId} FOR UPDATE`)
      const [current] = await tx.select().from(contractSignRequests).where(eq(contractSignRequests.id, request.id)).for('update')
      assertOpen(current!)
      const latest = await latestDocument(tx, request.contractId)
      if (!latest || latest.id !== request.documentId) throw httpError(409, 'CONTRACT_SIGN_DOCUMENT_CHANGED')

      const before = await readDocument(latest.pdfStoragePath)
      const signed = await fillSignatureFields({ pdf: before, role: request.signerRole, certPem: keys.certPem, keyPem: keys.keyPem, signerName: request.signerName, signaturePng: png }).catch(
        (err: unknown) => {
          // pdfsign.py refuses a file that only starts like a PNG: that is the person's drawing, not a server fault.
          if (err instanceof HttpError && err.code === 'PDF_SIGNATURE_RULE' && String(err.params.reason ?? '').startsWith('signature image')) {
            throw httpError(400, 'CONTRACT_SIGN_IMAGE_INVALID')
          }
          throw err
        },
      )
      if (!signed.pdf.subarray(0, before.length).equals(before)) throw new Error('signed PDF does not start with the previous revision')
      const inspection = await inspectPdf(signed.pdf)
      const now = new Date()
      const path = await saveDocument(`contracts/registry/${request.contractId}/semnat_link_${now.getTime()}.pdf`, signed.pdf)
      const [signedDoc] = await tx
        .insert(contractDocuments)
        .values({
          contractId: request.contractId,
          billingClientId: latest.billingClientId,
          docType: latest.docType,
          addendumId: latest.addendumId,
          pdfStoragePath: path,
          isSigned: true,
          signedAt: now,
          sourceDocumentId: latest.id,
          signatures: inspection.signatures,
        })
        .returning()
      await event(tx, request.id, 'signed', { ...visitor, sha: sha256(signed.pdf) })
      const events = await tx.select().from(contractSignEvents).where(eq(contractSignEvents.requestId, request.id)).orderBy(contractSignEvents.at)
      const certificatePdf = await signingCertificatePdf({ request: current!, before, after: signed.pdf, fields: signed.fields, events, fingerprint: keys.fingerprint })
      const certificatePath = await saveDocument(`contracts/registry/${request.contractId}/certificat_${now.getTime()}.pdf`, certificatePdf)
      const [certificateDoc] = await tx
        .insert(contractDocuments)
        .values({ contractId: request.contractId, docType: 'sign_certificate', pdfStoragePath: certificatePath, isSigned: true, signedAt: now, sourceDocumentId: signedDoc!.id })
        .returning()
      await tx
        .update(contractSignRequests)
        .set({
          status: 'signed',
          signedAt: now,
          signedDocumentId: signedDoc!.id,
          certificateDocumentId: certificateDoc!.id,
          downloadUntil: new Date(now.getTime() + downloadDays * 86_400_000),
          sessionHash: null,
          updatedAt: now,
        })
        .where(eq(contractSignRequests.id, request.id))
      await tx
        .update(contracts)
        .set({ status: 'signed', signedOn: sql`coalesce(${contracts.signedOn}, ${now.toISOString().slice(0, 10)}::date)`, updatedAt: now })
        .where(eq(contracts.id, request.contractId))
      return { pdf: signed.pdf, certificate: certificatePdf }
    })

    await recordAudit({ action: 'contract.semnat.prin.link', entityType: 'contract', entityId: request.contractId, changes: { semnatar: [null, request.signerEmail] } })
    const [contract] = await db.select({ title: contracts.title }).from(contracts).where(eq(contracts.id, request.contractId))
    const attachments = [
      { filename: 'contract-semnat.pdf', content: result.pdf },
      { filename: 'certificat-semnare.pdf', content: result.certificate },
    ]
    const ownerEmail = await ownerEmailOf(request.contractId)
    const company = await getCompany()
    await sendEmail({
      to: request.signerEmail,
      from: config.emailFromNoreply || undefined,
      subject: tr('emails.contractSign.signedSubject', { title: contract?.title ?? '' }),
      text: tr('emails.contractSign.signedBodySigner', { name: request.signerName, company: company.profile.name, days: downloadDays }),
      attachments,
    })
    if (ownerEmail) {
      await sendEmail({
        to: ownerEmail,
        subject: tr('emails.contractSign.signedSubject', { title: contract?.title ?? '' }),
        text: tr('emails.contractSign.signedBodyOwner', { name: request.signerName, title: contract?.title ?? '' }),
        attachments,
      })
    }
    return { signed: true }
  })
}

export async function declineRequest(token: string, session: string | undefined, reason: string, visitor: Visitor) {
  return withRequest(token, async (request) => {
    assertOpen(request)
    assertSession(request, session)
    await db
      .update(contractSignRequests)
      .set({ status: 'declined', declineReason: reason, sessionHash: null, updatedAt: new Date() })
      .where(eq(contractSignRequests.id, request.id))
    await event(db, request.id, 'declined', visitor)
    await tellOwner({ ...request, declineReason: reason }, 'declined')
    return { declined: true }
  })
}

/**
 * The other way to sign: with a qualified certificate of their own. The file must be our revision with
 * at least one more intact signature appended, nothing else changed.
 */
export async function uploadQualified(token: string, session: string | undefined, pdf: Buffer, visitor: Visitor) {
  return withRequest(token, async (request) => {
    assertOpen(request)
    assertSession(request, session)
    const downloadDays = (await getSigningSettings()).downloadDays
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM ${contracts} WHERE "id" = ${request.contractId} FOR UPDATE`)
      const latest = await latestDocument(tx, request.contractId)
      if (!latest || latest.id !== request.documentId) throw httpError(409, 'CONTRACT_SIGN_DOCUMENT_CHANGED')
      const before = await readDocument(latest.pdfStoragePath)
      if (!(await isSignedAppend(before, pdf))) throw httpError(400, 'CONTRACT_SIGN_NOT_AN_APPEND')
      const inspection = await inspectPdf(pdf)
      const now = new Date()
      const path = await saveDocument(`contracts/registry/${request.contractId}/semnat_qes_${now.getTime()}.pdf`, pdf)
      const [doc] = await tx
        .insert(contractDocuments)
        .values({ contractId: request.contractId, billingClientId: latest.billingClientId, docType: latest.docType, addendumId: latest.addendumId, pdfStoragePath: path, isSigned: true, signedAt: now, sourceDocumentId: latest.id, signatures: inspection.signatures })
        .returning()
      await event(tx, request.id, 'signed', { ...visitor, sha: sha256(pdf) })
      await tx
        .update(contractSignRequests)
        .set({ status: 'signed', signedAt: now, signedDocumentId: doc!.id, downloadUntil: new Date(now.getTime() + downloadDays * 86_400_000), sessionHash: null, updatedAt: now })
        .where(eq(contractSignRequests.id, request.id))
      await tx.update(contracts).set({ status: 'signed', signedOn: sql`coalesce(${contracts.signedOn}, ${now.toISOString().slice(0, 10)}::date)`, updatedAt: now }).where(eq(contracts.id, request.contractId))
    })
    await tellOwner(request, 'signed')
    return { signed: true }
  })
}

/** Before signing: the revision being read (session needed). After: the signed file, until download_until. */
export async function downloadForSigner(token: string, session: string | undefined, visitor: Visitor): Promise<{ pdf: Buffer; fileName: string }> {
  return withRequest(token, async (request) => {
    if (request.status === 'signed') {
      if (!request.downloadUntil || request.downloadUntil < new Date() || !request.signedDocumentId) throw httpError(410, 'CONTRACT_SIGN_DOWNLOAD_EXPIRED')
      await event(db, request.id, 'downloaded', visitor)
      return { pdf: await readDocument(await documentPath(request.signedDocumentId)), fileName: 'contract-semnat.pdf' }
    }
    assertOpen(request)
    assertSession(request, session)
    return { pdf: await readDocument(await documentPath(request.documentId)), fileName: 'contract.pdf' }
  })
}

async function ownerEmailOf(contractId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(contracts)
    .innerJoin(users, eq(users.id, contracts.ownerUserId))
    .where(eq(contracts.id, contractId))
  return row?.email ?? null
}

async function tellOwner(request: typeof contractSignRequests.$inferSelect, what: 'locked' | 'declined' | 'signed') {
  const ownerEmail = await ownerEmailOf(request.contractId)
  if (!ownerEmail) return
  const [contract] = await db.select({ title: contracts.title }).from(contracts).where(eq(contracts.id, request.contractId))
  await sendEmail({
    to: ownerEmail,
    subject: tr(`emails.contractSign.owner.${what}Subject`, { title: contract?.title ?? '' }),
    text: tr(`emails.contractSign.owner.${what}Body`, { name: request.signerName, title: contract?.title ?? '', reason: request.declineReason ?? '' }),
  })
}

// ── The signing certificate: one page that says who signed what, when and from where ─────────

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function signingCertificatePdf(input: {
  request: typeof contractSignRequests.$inferSelect
  before: Buffer
  after: Buffer
  fields: string[]
  events: (typeof contractSignEvents.$inferSelect)[]
  fingerprint: string
}): Promise<Buffer> {
  if (!isPdfAvailable()) throw httpError(400, 'PDF_GENERATION_UNAVAILABLE')
  const company = await getCompany()
  const [contract] = await db.select({ title: contracts.title, number: contracts.number, externalNumber: contracts.externalNumber }).from(contracts).where(eq(contracts.id, input.request.contractId))
  const when = (d: Date) => new Intl.DateTimeFormat('ro-RO', { dateStyle: 'long', timeStyle: 'medium', timeZone: company.timeZone }).format(d)
  const row = (label: string, value: string) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
  const events = input.events
    .map((e) => `<tr><td>${escapeHtml(when(e.at))}</td><td>${escapeHtml(tr(`emails.contractSign.certificate.events.${e.kind}`))}</td><td>${escapeHtml(e.ip ?? '')}</td><td class="ua">${escapeHtml(e.userAgent ?? '')}</td></tr>`)
    .join('')
  const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><style>
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 6mm; }
    h1 { font-size: 17px; margin: 0 0 4px; } p { margin: 4px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; } th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
    th { color: #555; font-weight: normal; width: 34%; } .ua { font-size: 9px; color: #555; word-break: break-all; } code { font-size: 10px; word-break: break-all; }
  </style></head><body>
    <h1>${escapeHtml(tr('emails.contractSign.certificate.title'))}</h1>
    <p>${escapeHtml(tr('emails.contractSign.certificate.intro', { company: company.profile.name }))}</p>
    <table>
      ${row(tr('emails.contractSign.certificate.document'), contract?.title ?? '')}
      ${row(tr('emails.contractSign.certificate.signer'), `${input.request.signerName} <${input.request.signerEmail}>`)}
      ${row(tr('emails.contractSign.certificate.role'), input.request.signerRole)}
      ${row(tr('emails.contractSign.certificate.fields'), input.fields.join(', '))}
      ${row(tr('emails.contractSign.certificate.hashBefore'), sha256(input.before))}
      ${row(tr('emails.contractSign.certificate.hashAfter'), sha256(input.after))}
      ${row(tr('emails.contractSign.certificate.seal'), input.fingerprint)}
    </table>
    <table><tr><th>${escapeHtml(tr('emails.contractSign.certificate.when'))}</th><th>${escapeHtml(tr('emails.contractSign.certificate.what'))}</th><th>IP</th><th>${escapeHtml(tr('emails.contractSign.certificate.browser'))}</th></tr>${events}</table>
    <p>${escapeHtml(tr('emails.contractSign.certificate.howToCheck'))}</p>
  </body></html>`
  return htmlToPdf(html, { isolated: true })
}
