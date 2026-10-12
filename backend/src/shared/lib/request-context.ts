import { AsyncLocalStorage } from 'node:async_hooks'

// Cine e actorul requestului curent (PLAN.md C2). Serviciile nu primesc `actor` la fiecare
// apel — îliau din context, ca `created_by`/`updated_by` și înregistrările de audit să fie
// complete fără să fie uitate pe una dintre sutele de rute.
//
// Store-ul se deschide în hook-ul `onRequest` (restul ciclului requestului rulează în el) și
// se completează în `authenticate`, când știm cine e omul — același tipar ca în VanaGreen
// pentru contextul de tenant (ADR-0005).
//
// Joburile nu au request: rulează direct (store gol → actor null, adică „acțiune de sistem").

export interface RequestActor {
  userId: string | null
  ip: string | null
}

const storage = new AsyncLocalStorage<RequestActor>()

/** Deschide store-ul pentru un request. `done` e trecut înăuntru ca tot ce urmează după el
 *  (hook-uri, handler, răspuns) să ruleze în același context. */
export function runWithFreshActor<T>(actor: RequestActor, fn: () => T): T {
  return storage.run(actor, fn)
}

/** Store-ul mutabil al requestului, ca `authenticate` să completeze cine e omul. */
export function actorStore(): RequestActor | undefined {
  return storage.getStore()
}

export function currentActor(): RequestActor {
  return storage.getStore() ?? { userId: null, ip: null }
}
