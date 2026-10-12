import { and, desc, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { emailThreads, financialRecords, prospects } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { searchFiles } from '../archive/service.js'
import { searchEvents } from '../calendar/service.js'
import { mailboxAddresses, threadVisibleTo } from '../email/mailboxes.js'

// Căutarea din Ctrl K (PLAN.md C2, BE-9). Fiecare grupă de rezultate poartă funcționalitatea
// care o deschide: grupa fără funcționalitate nu e interogată deloc (nici goală nu apare), iar
// emailul e filtrat și pe cutiile omului. Serverul decide ce vede omul — Ctrl K nu e o scurgere
// printr-o rută nouă necuplată.

export interface SearchItem {
  id: string
  label: string
  sublabel: string | null
  /** Unde duce rezultatul în UI. */
  to: string
}

export interface SearchGroup {
  group: string
  /** Funcționalitatea care a produs grupa — frontendul o știe deja, nu o ascunde. */
  feature: string
  items: SearchItem[]
}

export interface SearchOptions {
  limit?: number
}

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10

async function searchInvoices(term: string, limit: number): Promise<SearchGroup | null> {
  const like = `%${term}%`
  const rows = await db
    .select({
      id: financialRecords.id,
      documentNumber: financialRecords.documentNumber,
      counterpartyName: financialRecords.counterpartyName,
      direction: financialRecords.direction,
    })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        or(ilike(financialRecords.documentNumber, like), ilike(financialRecords.counterpartyName, like)),
      ),
    )
    .orderBy(desc(financialRecords.issuedAt))
    .limit(limit)
  if (rows.length === 0) return null
  return {
    group: 'Facturi',
    feature: 'facturi.view',
    items: rows.map((r) => ({
      id: r.id,
      label: r.documentNumber ?? `#${r.id.slice(0, 8)}`,
      sublabel: [r.direction === 'out' ? 'emisă' : 'primită', r.counterpartyName].filter(Boolean).join(' · ') || null,
      to: `/accounting?tab=${r.direction === 'out' ? 'emise' : 'primite'}&record=${r.id}`,
    })),
  }
}

async function searchProspects(term: string, limit: number): Promise<SearchGroup | null> {
  const like = `%${term}%`
  const rows = await db
    .select({ id: prospects.id, name: prospects.name, contactName: prospects.contactName, cif: prospects.cif, status: prospects.status })
    .from(prospects)
    .where(
      and(
        isNull(prospects.deletedAt),
        isNull(prospects.archivedAt),
        or(
          ilike(prospects.name, like),
          ilike(prospects.contactName, like),
          ilike(prospects.cif, like),
          ilike(prospects.email, like),
          ilike(prospects.phone, like),
        ),
      ),
    )
    .orderBy(desc(prospects.updatedAt))
    .limit(limit)
  if (rows.length === 0) return null
  return {
    group: 'Clienți',
    feature: 'clienti.view',
    items: rows.map((r) => ({
      id: r.id,
      label: r.name,
      sublabel: [r.contactName, r.cif, r.status].filter(Boolean).join(' · ') || null,
      to: `/pricing?prospect=${r.id}`,
    })),
  }
}

async function searchThreads(me: SessionUser, term: string, limit: number): Promise<SearchGroup | null> {
  // Adresele cutiilor se calculează o dată și se folosesc drept condiție pe fir, la fel ca în
  // lista de emailuri (BE-4) — un fir din cutia altcuia nu apare nici aici.
  const visible = threadVisibleTo(await mailboxAddresses(me))
  const like = `%${term}%`
  const rows = await db
    .select({ id: emailThreads.id, subject: emailThreads.subject, lastMessageAt: emailThreads.lastMessageAt })
    .from(emailThreads)
    .where(
      and(
        isNull(emailThreads.deletedAt),
        visible,
        or(ilike(emailThreads.subject, like), sql`EXISTS (SELECT 1 FROM unnest(${emailThreads.participants}) p WHERE p ILIKE ${like})`),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(limit)
  if (rows.length === 0) return null
  return {
    group: 'Email',
    feature: 'email.view',
    items: rows.map((r) => ({
      id: r.id,
      label: r.subject,
      sublabel: r.lastMessageAt.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }),
      to: `/email?thread=${r.id}`,
    })),
  }
}

// Arhiva și calendarul își păstrează filtrul de acces în modulul lor (spațiu per om, share-uri,
// participanți); aici doar se formatează rezultatul, ca filtrul să nu existe în două locuri.
async function searchArchive(me: SessionUser, term: string, limit: number): Promise<SearchGroup | null> {
  const rows = (await searchFiles(me, term)).slice(0, limit)
  if (rows.length === 0) return null
  return {
    group: 'Arhivă',
    feature: 'arhiva.view',
    items: rows.map((r) => ({
      id: r.id,
      label: r.name,
      sublabel: r.folderPath.map((f) => f.name).join(' / ') || null,
      to: `/archive?folder=${r.folderId}`,
    })),
  }
}

async function searchCalendar(me: SessionUser, term: string, limit: number): Promise<SearchGroup | null> {
  const rows = await searchEvents(me, term, limit)
  if (rows.length === 0) return null
  return {
    group: 'Calendar',
    feature: 'calendar.view',
    items: rows.map((r) => {
      const start = new Date(r.startAt)
      const when = start.toLocaleString(
        'ro-RO',
        r.allDay
          ? { timeZone: 'Europe/Bucharest', dateStyle: 'medium' }
          : { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' },
      )
      return {
        id: r.id,
        label: r.title,
        // Numele proprietarului doar când nu e calendarul omului — altfel ar fi zgomot.
        sublabel: r.ownerUserId === me.id ? when : `${when} · ${r.ownerName}`,
        // Ziua din București, nu din UTC: un eveniment la 00:30 ar cădea altfel în ziua de dinainte.
        to: `/calendar?date=${start.toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' })}`,
      }
    }),
  }
}

/** Grupele se interoghează în paralel, fiecare doar dacă omul are funcționalitatea ei. */
export async function search(me: SessionUser, q: string, options: SearchOptions = {}): Promise<SearchGroup[]> {
  const term = q.trim()
  if (term.length < 2) return []
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  const groups = await Promise.all([
    me.features.includes('facturi.view') ? searchInvoices(term, limit) : null,
    me.features.includes('clienti.view') ? searchProspects(term, limit) : null,
    me.features.includes('email.view') ? searchThreads(me, term, limit) : null,
    me.features.includes('arhiva.view') ? searchArchive(me, term, limit) : null,
    me.features.includes('calendar.view') ? searchCalendar(me, term, limit) : null,
  ])
  return groups.filter((g): g is SearchGroup => g !== null)
}
