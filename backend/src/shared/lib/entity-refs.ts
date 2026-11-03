import type { MessageRefType } from '../db/schema/chat.js'
import type { SessionUser } from './session.js'

// Objects shared into Mesaje. Each module registers an adapter for its own type, so chat reads
// prospects, invoices, threads, events, files and notes without importing those modules.
//
// `firm` objects belong to the company: a reader with the page's feature sees them live.
// `personal` objects (a thread, an event, a file, a note) are shown from the sender's snapshot;
// the reader only gets a way to open the original when they can already see it.

export type RefType = MessageRefType
export type RefSnapshot = { title: string } & Record<string, unknown>

/** A file copied into the conversation along with the card (archive files). */
export interface RefFile {
  filename: string
  contentType: string
  buffer: Buffer
}

export interface RefSnapshotResult {
  card: RefSnapshot
  file?: RefFile
}

export interface RefResolution {
  canOpen: boolean
  live?: RefSnapshot
  gone?: boolean
}

export interface RefAdapter {
  kind: 'firm' | 'personal'
  /**
   * With the sender. null = the sender cannot see the object (the route answers 404).
   * `preview`: only the card, for the composer's chip; no file is read.
   */
  snapshot(refId: string, sender: SessionUser, opts: { quote?: string; preview?: boolean }): Promise<RefSnapshotResult | null>
  /** With the reader, for all refs of one type on a page of messages at once. */
  resolve(refIds: string[], reader: SessionUser): Promise<Map<string, RefResolution>>
}

// Kept under the 50 MB chat limit on purpose: the copy is buffered on a 1.9 GB box.
export const MAX_REF_FILE_BYTES = 20 * 1024 * 1024

export class RefFileTooLargeError extends Error {
  constructor() {
    super('REF_FILE_TOO_LARGE')
    this.name = 'RefFileTooLargeError'
  }
}

const adapters = new Map<RefType, RefAdapter>()

export function registerRefType(type: RefType, adapter: RefAdapter): void {
  adapters.set(type, adapter)
}

export function refAdapter(type: RefType): RefAdapter | undefined {
  return adapters.get(type)
}

export function excerpt(text: string | null | undefined, max: number): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
