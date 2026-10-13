import { readDocument } from '../../shared/lib/storage.js'
import type { EmailAttachment } from '../../shared/lib/email.js'

// 2026-08-11 — poze inserate în editorul rich-text (Compose/Templates). Stocare locală (ca
// documentele generate — shared/lib/storage.ts), NU R2: bucket-ul R2 existent (modul Arhivă)
// e privat cu URL-uri presemnate de 15 min (nepotrivit pt. o poză dintr-un email care poate fi
// deschis peste săptămâni), iar accesul public pe R2 se activează la nivel de TOT bucket-ul —
// ar expune facturile private din Arhivă. Decizie Stefan: volum mic (1-2 poze), nu justifică
// un bucket R2 nou separat doar pt. asta.

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB — poze într-un email, nu arhivă foto
export const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
export const IMAGE_FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/i
const STORAGE_SUBDIR = 'email-images'

export function emailImageStoragePath(filename: string): string {
  return `${STORAGE_SUBDIR}/${filename}`
}

export function contentTypeForImageFilename(filename: string): string {
  const ext = filename.split('.').pop()!.toLowerCase()
  return Object.entries(ALLOWED_MIME_TO_EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream'
}

const STORED_IMAGE_SRC_RE = /src="\/api\/email-images\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))"/gi

/**
 * Rescrie `<img src="/api/email-images/xyz.png">` (URL public, folosit de editor la compunere)
 * în `<img src="cid:xyz.png">` + atașament MIME cu `contentId` potrivit, ÎNAINTE de trimiterea
 * reală prin Resend. Motiv (feedback Stefan, testat live pe Gmail mobil): un `<img src>` cu
 * URL extern e tratat de majoritatea clienților de mail ca "imagine externă" — ascunsă/necerută
 * automat până la un click explicit ("afișează imaginile"), exact ce s-a văzut (iconiță mică,
 * generică, nu poza reală). O poză ATAȘATĂ cu Content-ID se randează direct, fără friction.
 *
 * NU modifică ce se STOCHEAZĂ (bodyHtml în DB, draft, template) — acolo rămâne URL-ul public,
 * ca editorul/thread view-ul (care NU rezolvă `cid:`, doar HTTP normal) să continue să
 * funcționeze la redeschidere. Transformarea se aplică STRICT pe payload-ul trimis la Resend.
 */
export async function inlineStoredImages(html: string): Promise<{ html: string; attachments: EmailAttachment[] }> {
  const filenames = new Set<string>()
  for (const match of html.matchAll(STORED_IMAGE_SRC_RE)) filenames.add(match[1]!)
  if (filenames.size === 0) return { html, attachments: [] }

  const attachments: EmailAttachment[] = []
  for (const filename of filenames) {
    try {
      const content = await readDocument(emailImageStoragePath(filename))
      attachments.push({ filename, content, contentId: filename })
    } catch (err) {
      // Poza a dispărut de pe disc între upload și trimitere (foarte improbabil, nume unic
      // generat) — izolat per poză, restul trimiterii continuă, doar imaginea asta rămâne ruptă.
      console.error('[email] inline poză "%s" eșuat (fișier lipsă?):', filename, err)
    }
  }

  const inlinedHtml = html.replace(STORED_IMAGE_SRC_RE, (full, filename: string) =>
    attachments.some((a) => a.contentId === filename) ? `src="cid:${filename}"` : full,
  )
  return { html: inlinedHtml, attachments }
}
