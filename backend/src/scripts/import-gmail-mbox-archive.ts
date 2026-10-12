import { eq, and } from 'drizzle-orm'
import PostalMime from 'postal-mime'
import { findOrCreateThread, normalizeSubject, touchThread } from '../modules/email/inbound-service.js'
import { db, sql } from '../shared/db/client.js'
import { emailAttachments, emailMessages } from '../shared/db/schema/index.js'
import { saveDocument } from '../shared/lib/storage.js'

// One-off run, before the MX records are moved: it brings the Gmail history (the account in
// env GMAIL_ACCOUNT, received and sent messages tied to the company's addresses) into the app
// with folder='archive', so Gmail can be left behind. The source is a Google Takeout export
// (.mbox) of one label, not the Gmail API over OAuth: a permanent credential is not worth
// keeping for something that runs once.
//
// Threading identic cu fluxul live (findOrCreateThread/touchThread reutilizate din
// inbound-service.ts) — dacă vine un reply nou pe același subiect+participanți, se leagă de
// threadul importat, nu creează unul nou.

const GMAIL_ACCOUNT = (process.env.GMAIL_ACCOUNT ?? '').toLowerCase()
if (!GMAIL_ACCOUNT) throw new Error('Set GMAIL_ACCOUNT to the address the .mbox export belongs to')

interface ParsedRecipient {
  address?: string
}

function splitMboxMessages(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const blocks: string[][] = []
  let current: string[] | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const isBoundary = line.startsWith('From ') && (i === 0 || lines[i - 1] === '')
    if (isBoundary) {
      if (current) blocks.push(current)
      current = []
      continue
    }
    if (current) {
      // Unescape mboxrd: Gmail Takeout adaugă un '>' în plus la orice linie de body care ar
      // putea fi confundată cu un separator ('From ' sau '>From ', '>>From ' etc.).
      current.push(/^>+From /.test(line) ? line.slice(1) : line)
    }
  }
  if (current) blocks.push(current)

  return blocks.map((b) => b.join('\n')).filter((b) => b.trim().length > 0)
}

function extractAddress(recipient: ParsedRecipient | undefined): string {
  return recipient?.address?.trim() ?? ''
}

/**
 * Direcția din headerul `X-Gmail-Labels` (setat de Gmail însuși pe fiecare mesaj din export) —
 * mult mai fiabil decât From-address, pt. că Stefan răspunde din Gmail folosind alias-uri
 * "send mail as" (stefan@/contact@vanadium.systems), nu adresa Gmail brută. Suportă atât label-ul
 * englezesc ('Sent'), cât și cel din interfața românească ('Mesaje trimise'). Fallback pe
 * From-address doar dacă headerul lipsește (mbox non-Gmail).
 */
function detectDirection(email: Awaited<ReturnType<typeof PostalMime.parse>>, fromAddress: string): 'in' | 'out' {
  const gmailLabels = email.headers.find((h) => h.key === 'x-gmail-labels')?.value
  if (gmailLabels) {
    return /(^|,)\s*(sent|mesaje trimise)\s*(,|$)/i.test(gmailLabels) ? 'out' : 'in'
  }
  return fromAddress.toLowerCase() === GMAIL_ACCOUNT ? 'out' : 'in'
}

/** `content` din postal-mime poate fi ArrayBuffer | Uint8Array | string — normalizăm la Buffer. */
function toBuffer(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === 'string') return Buffer.from(content, 'utf8')
  if (content instanceof Uint8Array) return Buffer.from(content)
  return Buffer.from(content)
}

async function persistAttachment(
  messageId: string,
  index: number,
  attachment: { filename: string | null; mimeType: string; content: ArrayBuffer | Uint8Array | string },
): Promise<void> {
  const safeFilename = (attachment.filename ?? `attachment-${index}`).replace(/[^A-Za-z0-9._-]/g, '_')
  const buffer = toBuffer(attachment.content)
  const storagePath = await saveDocument(`email-attachments/${messageId}/${safeFilename}`, buffer)
  await db.insert(emailAttachments).values({
    messageId,
    filename: attachment.filename ?? safeFilename,
    storagePath,
    contentType: attachment.mimeType || null,
  })
}

async function main() {
  const mboxPath = process.argv[2]
  const dryRun = process.argv.includes('--dry-run')

  if (!mboxPath) {
    console.error('Utilizare: tsx src/scripts/import-gmail-mbox-archive.ts <cale-fisier.mbox> [--dry-run]')
    process.exitCode = 1
    return
  }

  const fs = await import('node:fs/promises')
  const raw = await fs.readFile(mboxPath, 'utf8')
  const blocks = splitMboxMessages(raw)
  console.log(`[gmail-import] ${blocks.length} mesaje găsite în ${mboxPath}${dryRun ? ' (DRY RUN — nimic nu se scrie în DB)' : ''}`)

  // Parsăm întâi tot (ca să putem sorta cronologic — thread.lastMessageAt trebuie să reflecte
  // mesajul REAL cel mai recent, nu ordinea din fișier), apoi inserăm secvențial, cel mai vechi
  // primul, ca fiecare touchThread() succesiv să avanseze corect data.
  const parsed = await Promise.all(
    blocks.map(async (block, i) => {
      try {
        return { i, email: await PostalMime.parse(block) }
      } catch (err) {
        console.error(`[gmail-import] mesaj #${i} — parsare eșuată, sărit: ${String(err)}`)
        return null
      }
    }),
  )

  const usable = parsed
    .filter((p): p is { i: number; email: Awaited<ReturnType<typeof PostalMime.parse>> } => p !== null)
    .map((p) => ({ ...p, date: p.email.date ? new Date(p.email.date) : new Date(0) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (usable.length > 0) {
    const outCount = usable.filter((u) => detectDirection(u.email, extractAddress(u.email.from)) === 'out').length
    const first = usable[0]!.date.toLocaleDateString('ro-RO')
    const last = usable[usable.length - 1]!.date.toLocaleDateString('ro-RO')
    console.log(`[gmail-import] interval: ${first} → ${last} | primite: ${usable.length - outCount}, trimise: ${outCount}`)
  }

  let imported = 0
  let skippedDuplicate = 0
  let skippedNoFrom = 0
  let attachmentsImported = 0

  for (const { i, email, date } of usable) {
    const fromAddress = extractAddress(email.from)
    if (!fromAddress) {
      skippedNoFrom++
      console.warn(`[gmail-import] mesaj #${i} fără From valid, sărit`)
      continue
    }
    const toAddress = (email.to ?? []).map(extractAddress).filter(Boolean).join(', ')
    const subject = email.subject ?? '(fără subiect)'
    const bodyText = email.text ?? email.html ?? null
    const direction = detectDirection(email, fromAddress)
    const messageId = email.messageId ?? null

    if (messageId) {
      const [existing] = await db
        .select({ id: emailMessages.id })
        .from(emailMessages)
        .where(and(eq(emailMessages.sourceMessageId, messageId), eq(emailMessages.inboundSource, 'gmail-import')))
        .limit(1)
      if (existing) {
        skippedDuplicate++
        continue
      }
    }

    if (dryRun) {
      imported++
      attachmentsImported += email.attachments.length
      continue
    }

    const participants = Array.from(new Set([fromAddress, toAddress].filter(Boolean)))
    const thread = await findOrCreateThread(subject, participants)
    await touchThread(thread, participants, date)

    const [message] = await db
      .insert(emailMessages)
      .values({
        threadId: thread.id,
        direction,
        sourceMessageId: messageId,
        inboundSource: 'gmail-import',
        fromAddress,
        toAddress,
        subject,
        bodyText,
        receivedAt: direction === 'in' ? date : null,
        createdAt: date,
        isRead: true,
        folder: direction === 'in' ? 'archive' : undefined,
      })
      .returning()

    if (!message) {
      console.error(`[gmail-import] mesaj #${i} (${normalizeSubject(subject)}) — insert eșuat, sărit`)
      continue
    }

    imported++

    for (const [idx, attachment] of email.attachments.entries()) {
      try {
        await persistAttachment(message.id, idx, attachment)
        attachmentsImported++
      } catch (err) {
        console.error(`[gmail-import] atașament "${attachment.filename}" (mesaj #${i}) eșuat: ${String(err)}`)
      }
    }
  }

  console.log(
    `[gmail-import] gata — importate: ${imported}, duplicate sărite: ${skippedDuplicate}, fără From: ${skippedNoFrom}, atașamente: ${attachmentsImported}, total procesate: ${usable.length}`,
  )
}

main()
  .catch((err) => {
    console.error('[gmail-import] eșuat:', err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
