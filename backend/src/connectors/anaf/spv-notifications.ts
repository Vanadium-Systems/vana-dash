// ANAF sends a "Documente noi SPV" email for every new document in the Private Virtual Space,
// one "- CIF <code>: <description>" line per document, and admin.portal@mfinante.ro answers
// form 150 by email. There is no OAuth API for SPV messages, so these emails are the only feed
// the server can read. Most lines are routine (the daily fiscal record), a few matter.

export type SpvItemKind = 'routine' | 'receipt' | 'important'

export interface SpvNotificationItem {
  cif: string
  text: string
  kind: SpvItemKind
  /** Receipts only: declaration type (D301, D100...), period YYYY-MM and the upload index. */
  declarationCode?: string
  period?: string
  anafIndex?: string
  registrationNumber?: string
}

const ROUTINE = [/fisa rol/i, /duplicat vector fiscal/i, /duplicat istoric declaratii/i]
const PROBLEM = /eroare|respins|nu este un document valid|neconform|nu are drept/i
// recipisa pentru CIF 123, tip D100, numar_inregistrare INTERNT-1253613335-2026/19-10-2026, perioada raportare 9.2026
const RECEIPT =
  /recipisa pentru CIF\s*(\d+),\s*tip\s*([A-Z0-9]+),\s*numar_inregistrare\s*(INTERNT-(\d+)-\d{4})[^,]*,\s*perioada raportare\s*(\d{1,2})\.(\d{4})/i

function classify(cif: string, text: string): SpvNotificationItem {
  const receipt = RECEIPT.exec(text)
  if (receipt && !PROBLEM.test(text)) {
    return {
      cif,
      text,
      kind: 'receipt',
      declarationCode: receipt[2]!.toUpperCase(),
      registrationNumber: receipt[3]!,
      anafIndex: receipt[4]!,
      period: `${receipt[6]}-${receipt[5]!.padStart(2, '0')}`,
    }
  }
  if (!PROBLEM.test(text) && ROUTINE.some((re) => re.test(text))) return { cif, text, kind: 'routine' }
  return { cif, text, kind: 'important' }
}

/** Lines of a "Documente noi SPV" email. An empty list means the body had no document lines. */
export function parseSpvDocumentsEmail(body: string): SpvNotificationItem[] {
  const items: SpvNotificationItem[] = []
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*-\s*CIF\s*(\d+)\s*:\s*(.+?)\s*$/i.exec(line)
    if (match) items.push(classify(match[1]!, match[2]!))
  }
  return items
}

export interface Form150Result {
  formNumber: string
  rejected: boolean
  text: string
}

/** The admin.portal answer to a form 150 request ("Depunere Formular 150 numar inregistrare N"). */
export function parseForm150Email(subject: string, body: string): Form150Result | null {
  const number = /formular\s*150\D*(\d{6,})/i.exec(`${subject} ${body}`)
  if (!number) return null
  const text = body.replace(/\s+/g, ' ').trim()
  return { formNumber: number[1]!, rejected: /respins/i.test(text), text }
}
