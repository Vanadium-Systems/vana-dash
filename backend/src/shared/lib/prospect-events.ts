import { EventEmitter } from 'node:events'

// In-process events around prospects. Email, booking and prospects emit; the sequence runner,
// automations and signals listen. It lives in shared/ so modules never import each other.

export interface ProspectEvents {
  'email.replied': { prospectId: string | null; address: string; enrollmentId?: string }
  'email.bounced': { address: string; sendId?: string }
  'email.opened': { address: string; sendId?: string }
  'task.done': { taskId: string; prospectId: string; kind: string; outcome: string | null }
  'meeting.booked': { prospectId: string; at: Date }
  'prospect.stage_changed': { prospectId: string; from: string | null; to: string; kind: 'open' | 'won' | 'lost' }
  'prospect.created': { prospectId: string; via: 'manual' | 'import'; importToken?: string }
}

const emitter = new EventEmitter()
emitter.setMaxListeners(50)

export function emitProspectEvent<K extends keyof ProspectEvents>(name: K, payload: ProspectEvents[K]): void {
  // Listeners are async; an error in one must not reach the request that emitted.
  for (const listener of emitter.listeners(name)) {
    Promise.resolve()
      .then(() => (listener as (p: ProspectEvents[K]) => unknown)(payload))
      .catch((err) => console.error(`[prospect-events] ${String(name)}:`, err))
  }
}

export function onProspectEvent<K extends keyof ProspectEvents>(name: K, listener: (payload: ProspectEvents[K]) => unknown): () => void {
  emitter.on(name, listener)
  return () => emitter.off(name, listener)
}
