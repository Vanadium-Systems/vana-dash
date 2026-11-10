import type { StoredOffer } from '@/modules/pricing/offer'
import type { FilterClause } from '@/shared/lib/filters'
import type { ProspectRow, SortState } from '../prospects/types'

export interface SheetPerson {
  id: string
  name: string
  role: string | null
  isDecisionMaker: boolean
  doNotContact: boolean
  doNotContactReason: string | null
  position: number
}

export type ContactPointStatus = 'ok' | 'bounced' | 'unsubscribed' | 'invalid'

export interface SheetContactPoint {
  id: string
  personId: string | null
  kind: 'phone' | 'email'
  value: string
  label: string | null
  isPrimary: boolean
  status: ContactPointStatus
}

export interface SheetCollaborator {
  userId: string
  level: 'view' | 'edit'
  name: string
}

export interface SheetRequest {
  id: string
  kind: 'transfer' | 'access'
  fromUserId: string | null
  toUserId: string
  requestedByUserId: string
  requesterName: string
  note: string | null
  createdAt: string
}

export interface SheetSignal {
  id: string
  name: string
  groupKey: 'company' | 'activity' | 'contact'
  talkingTip: string | null
}

/** `GET /api/prospects/:id`: the list row plus what only the sheet needs (service.ts `getProspectSheet`). */
export interface ProspectSheet extends ProspectRow {
  foundingYear: number | null
  profit: string | null
  debt: string | null
  equity: string | null
  cash: string | null
  receivables: string | null
  inventory: string | null
  statusChangedAt: string
  lostReason: string | null
  claimedAt: string | null
  people: SheetPerson[]
  contactPoints: SheetContactPoint[]
  collaborators: SheetCollaborator[]
  pendingRequests: SheetRequest[]
  signals: SheetSignal[]
  offer: StoredOffer | null
}

export type TimelineKind = 'audit' | 'note' | 'task' | 'stage' | 'call' | 'email' | 'sequence' | 'voice'

export interface TimelineRow {
  id: string
  kind: TimelineKind
  at: string
  author: string | null
  data: Record<string, unknown>
}

export interface TimelinePage {
  entries: TimelineRow[]
  nextCursor: string | null
}

export interface SheetNote {
  id: string
  authorUserId: string | null
  authorName: string | null
  body: string
  mentions: string[]
  pinned: boolean
  createdAt: string
}

export interface VoiceNote {
  id: string
  taskId: string | null
  mime: string
  sizeBytes: number
  durationSeconds: number
  caption: string | null
  createdAt: string
  authorUserId: string | null
  authorName: string | null
  authorEmail: string | null
  canManage: boolean
}

export interface SheetTask {
  id: string
  kind: string
  title: string
  dueAt: string
  priority: 'low' | 'medium' | 'high'
  doneAt: string | null
  skippedAt: string | null
  description: string | null
  assigneeUserId: string
  assigneeName: string | null
  personName: string | null
}

export interface ContactCheck {
  ownerName: string | null
  claimedAt: string | null
  lastActivityAt: string | null
  lastActivityKind: 'note' | 'task' | 'email' | 'call' | null
  lastActivityBy: string | null
}

export interface Neighbors {
  prevId: string | null
  nextId: string | null
  index: number
  total: number
}

export interface DiscussedIn {
  conversationId: string
  title: string
  lastSharedAt: string
}

export interface ReleaseSettings {
  enabled: boolean
  idleDays: number
  warnDays: number
}

/** The list the sheet was opened from: its filters and order decide what ↑ ↓ mean. */
export interface ListState {
  f: FilterClause[]
  q: string
  sort: SortState | null
}
