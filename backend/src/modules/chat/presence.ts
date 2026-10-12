// Prezența și bus-ul de evenimente pentru Mesaje (PLAN.md C3), tot în memorie: un singur
// container backend. Dacă ajunge vreodată pe două instanțe, prezența (singurul lucru care
// ține stare) trece pe Redis sau LISTEN/NOTIFY — evenimentele din `publish` sunt deja grupate
// pe om, deci migrarea rămâne locală, nu se schimbă contractul.
//
// De ce prezența cere DOUĂ semne: „am o conexiune SSE deschisă" nu ajunge. Când aplicația
// merge în background, WebView-ul poate ține socketul deschis fără să livreze nimic, iar
// serverul nu primește nicio eroare (write-ul se pierde în bufferul telefonului). Deci:
// online = conexiune deschisă ȘI semn de viață recent de la client (`POST /api/chat/heartbeat`,
// la 45s cât timp pagina e vizibilă). Un device care doarme trece singur în „away", deci
// destinatarul primește push. `users.last_seen_at` e altă poveste: îl scrie `authenticate`,
// cel mult o dată pe minut.

import { conversationPartnerIds } from './service.js'

const HEARTBEAT_TIMEOUT_MS = 90_000
const AWAY_DELAY_MS = 30_000

export type ChatEvent =
  | { type: 'message.created'; conversationId: string; message: unknown }
  | { type: 'message.updated'; conversationId: string; message: unknown }
  | { type: 'conversation.updated'; conversationId: string }
  | { type: 'read'; conversationId: string; userId: string; messageId: string }
  | { type: 'presence'; userId: string; presence: 'online' | 'away'; lastSeenAt: string | null }

interface Connection {
  id: string
  write: (event: ChatEvent) => void
}

const connections = new Map<string, Set<Connection>>()
const lastSignOfLife = new Map<string, number>()
const pendingAwayTimers = new Map<string, NodeJS.Timeout>()

export function openConnection(userId: string, connection: Connection): void {
  const set = connections.get(userId) ?? new Set<Connection>()
  set.add(connection)
  connections.set(userId, set)
  markAlive(userId)

  // Reconectarea înainte de întârzierea de 30s anulează „away" — altfel prezența ar clipi la
  // fiecare reîncărcare de pagină.
  const timer = pendingAwayTimers.get(userId)
  if (timer) {
    clearTimeout(timer)
    pendingAwayTimers.delete(userId)
  }
  void announce(userId, 'online')
}

export function closeConnection(userId: string, connectionId: string): void {
  const set = connections.get(userId)
  if (!set) return
  if (![...set].some((connection) => connection.id === connectionId)) return
  for (const connection of set) {
    if (connection.id === connectionId) set.delete(connection)
  }
  if (set.size > 0) return
  connections.delete(userId)

  // 30s de întârziere, ca o reîncărcare de pagină sau un switch repede între tab-uri să nu
  // aprindă și stingă prezența în fața colegilor.
  const timer = setTimeout(() => {
    pendingAwayTimers.delete(userId)
    if ((connections.get(userId)?.size ?? 0) > 0) return
    void announce(userId, 'away')
  }, AWAY_DELAY_MS)
  timer.unref?.()
  pendingAwayTimers.set(userId, timer)
}

/** Prezența se anunță celor cu care omul are conversație — singurii care o privesc. */
async function announce(userId: string, presence: 'online' | 'away'): Promise<void> {
  try {
    const partners = await conversationPartnerIds(userId)
    const event: ChatEvent = { type: 'presence', userId, presence, lastSeenAt: new Date().toISOString() }
    publish(event, partners)
  } catch (err) {
    console.error(`[chat] prezența lui ${userId} n-a putut fi anunțată: ${String(err)}`)
  }
}

export function markAlive(userId: string): void {
  lastSignOfLife.set(userId, Date.now())
}

export function hasOpenConnection(userId: string): boolean {
  return (connections.get(userId)?.size ?? 0) > 0
}

function isOnline(userId: string): boolean {
  if (!hasOpenConnection(userId)) return false
  return Date.now() - (lastSignOfLife.get(userId) ?? 0) < HEARTBEAT_TIMEOUT_MS
}

export function presenceFor(userId: string): 'online' | 'away' {
  return isOnline(userId) ? 'online' : 'away'
}

/** Trimite un eveniment tuturor conexiunilor deschise ale unui om. */
function publishToUser(userId: string, event: ChatEvent): void {
  const set = connections.get(userId)
  if (!set || set.size === 0) return
  for (const connection of [...set]) {
    try {
      connection.write(event)
    } catch {
      // Socket mort, scris pe un registru încă deschis (device adormit) — îl scoatem.
      closeConnection(userId, connection.id)
    }
  }
}

export function publish(event: ChatEvent, userIds: string[]): void {
  for (const userId of userIds) publishToUser(userId, event)
}

/** Doar pentru teste — golește registrul între cazuri, ca un om să nu rămână „online" pe fals. */
export function resetPresenceForTests(): void {
  for (const timer of pendingAwayTimers.values()) clearTimeout(timer)
  pendingAwayTimers.clear()
  connections.clear()
  lastSignOfLife.clear()
}
