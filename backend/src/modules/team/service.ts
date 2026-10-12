import { randomBytes } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { roles, userMailboxes, userTokens, users } from '../../shared/db/schema/index.js'
import { config } from '../../shared/config.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { sendEmail } from '../../shared/lib/email.js'
import { effectiveFeatures, type SessionUser } from '../../shared/lib/session.js'
import { createUserToken } from '../../shared/lib/user-tokens.js'
import { AccessError, listMembers } from '../access/service.js'

// Membrii echipei (PLAN.md C2): invitare, rol, stare, cutii de email. Lista e `self` — orice
// user activ o vede, ca să îi poată scrie cuiva din Mesaje (push B). Tot restul cere
// `echipa.administrare`, prin guard.

export { listMembers }

const isAdmin = (me: SessionUser) => me.role?.kind === 'admin'
const isManager = (me: SessionUser) => me.role?.kind === 'manager'

/** Ultimul admin activ nu poate fi dezactivat sau retrogradat — altfel nimeni nu mai intră. */
async function assertNotLastAdmin(userId: string) {
  const [target] = await db.select({ roleKind: roles.kind, status: users.status }).from(users).leftJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (target?.roleKind !== 'admin' || target.status !== 'active') return
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(roles.kind, 'admin'), eq(users.status, 'active'), isNull(users.deletedAt)))
  if (count <= 1) {
    throw new AccessError('LAST_ADMIN', 409, 'Ești ultimul admin activ. Mai întâi dă altcineva rolul de Admin.')
  }
}

/** Managerul nu atinge useri admin sau manager, nici rolurile lor (nici la schimbarea de rol). */
async function assertCanManage(actor: SessionUser, targetId: string) {
  if (isAdmin(actor)) return
  const [target] = await db
    .select({ roleKind: roles.kind })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, targetId), isNull(users.deletedAt)))
  if (target?.roleKind === 'admin' || target?.roleKind === 'manager') {
    throw new AccessError('PERMISSION_ESCALATION', 403, 'Poți administra doar oameni cu roluri create de tine')
  }
}

export async function inviteMember(actor: SessionUser, input: { email: string; displayName?: string; roleId: string }) {
  const email = input.email.toLowerCase()
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  if (existing) throw new AccessError('EMAIL_TAKEN', 409, 'Există deja un cont cu adresa asta')

  const [role] = await db.select().from(roles).where(and(eq(roles.id, input.roleId), isNull(roles.deletedAt)))
  if (!role) throw new AccessError('ROLE_NOT_FOUND', 404, 'Rolul nu există')
  if (!isAdmin(actor)) {
    if (role.kind === 'admin') throw new AccessError('PERMISSION_ESCALATION', 403, 'Nu poți da rolul de Admin')
    if (role.kind === 'manager') throw new AccessError('PERMISSION_ESCALATION', 403, 'Nu poți da rolul de Manager')
    // Rolul custom primit de la altcineva poate conține chei pe care actorul nu le are.
    const beyond = effectiveFeatures(role.features, 'custom').filter((key) => !actor.features.includes(key))
    if (beyond.length > 0) {
      throw new AccessError('PERMISSION_ESCALATION', 403, `Nu ai ${beyond[0]}, deci nu îl poți da altcuiva`)
    }
  }

  // Parola se generează aleator și se aruncă: userul o pune la acceptarea invitației.
  const [created] = await db
    .insert(users)
    .values({
      email,
      displayName: input.displayName ?? null,
      // Parola se pune la acceptarea invitației; până atunci coloarea trebuie să fie NOT NULL,
      // deci hash al unei valori aleatoare imposibile de ghicit (niciun login nu se potrivește).
      passwordHash: `invitat:${randomBytes(32).toString('hex')}`,
      roleId: role.id,
      status: 'invited',
      locale: config.defaultLocale,
      displayCurrency: config.defaultDisplayCurrency,
    })
    .returning()
  if (!created) throw new Error('User necreat')

  const token = await createUserToken(created.id, 'invite')
  await sendInviteEmail(email, input.displayName ?? null, token)
  await recordAudit({
    action: 'echipa.invitare',
    entityType: 'user',
    entityId: created.id,
    changes: { email: [null, email], role: [null, role.name] },
  })
  return { id: created.id, status: created.status }
}

async function sendInviteEmail(to: string, displayName: string | null, token: string) {
  const link = `${config.frontendOrigin}/accept-invite?token=${token}`
  const greeting = displayName ? `Salut, ${displayName},` : 'Salut,'
  await sendEmail({
    to,
    from: config.emailFromNoreply,
    subject: 'Ai primit acces în VanaDash',
    text: [
      `${greeting}`,
      '',
      'Stefan te-a adăugat în echipa VanaDash, aplicația internă Vanadium Systems.',
      'Alege-ți parola aici, apoi intri:',
      link,
      '',
      'Linkul e valabil 72 de ore. Dacă nu te aștepta nimeni, ignoră-l — cer altul de la admin.',
    ].join('\n'),
  })
}

export async function updateMember(actor: SessionUser, userId: string, input: { displayName?: string; roleId?: string; status?: 'active' | 'disabled' }) {
  await assertCanManage(actor, userId)
  if (input.status === 'disabled' || input.roleId) await assertNotLastAdmin(userId)

  const [before] = await db
    .select({ displayName: users.displayName, roleName: roles.name, roleKind: roles.kind, status: users.status, roleId: users.roleId })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!before) throw new AccessError('USER_NOT_FOUND', 404, 'Utilizatorul nu există')

  if (input.roleId && !isAdmin(actor)) {
    const [newRole] = await db.select().from(roles).where(eq(roles.id, input.roleId))
    if (newRole?.kind !== 'custom') {
      throw new AccessError('PERMISSION_ESCALATION', 403, 'Poți da doar roluri create de tine')
    }
  }

  // Dezactivarea crește session_version → sesiunile lui moare imediat (401), fără delogare
  // manuală și fără să aștepte expirarea tokenului.
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
  if (input.displayName !== undefined) patch.displayName = input.displayName
  if (input.roleId !== undefined) patch.roleId = input.roleId
  if (input.status !== undefined) {
    patch.status = input.status
    if (input.status === 'disabled') patch.sessionVersion = sql`${users.sessionVersion} + 1` as unknown as number
  }
  await db.update(users).set(patch).where(eq(users.id, userId))

  // Dezactivarea arde și linkurile nefolosite ale omului (invitație, resetare): altfel un
  // token vechi rămâne o poartă de intrare într-un cont oprit.
  if (input.status === 'disabled') {
    await db
      .update(userTokens)
      .set({ usedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(userTokens.userId, userId), isNull(userTokens.usedAt)))
  }

  await recordAudit({
    action: input.status === 'disabled' ? 'echipa.dezactivare' : 'echipa.actualizare',
    entityType: 'user',
    entityId: userId,
    changes: {
      displayName: [before?.displayName ?? null, input.displayName ?? before?.displayName ?? null],
      role: [before?.roleName ?? null, input.roleId ? (await roleName(input.roleId)) : (before?.roleName ?? null)],
      status: [before?.status ?? null, input.status ?? before?.status ?? null],
    },
  })
  return { id: userId }
}

async function roleName(roleId: string) {
  const [role] = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, roleId))
  return role?.name ?? null
}

export async function resendInvite(actor: SessionUser, userId: string) {
  await assertCanManage(actor, userId)
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!user) throw new AccessError('USER_NOT_FOUND', 404, 'Utilizatorul nu există')
  if (user.status !== 'invited') {
    throw new AccessError('ALREADY_ACTIVE', 409, 'Omul și-a pus deja parola — nu mai e nevoie de link')
  }
  const token = await createUserToken(user.id, 'invite')
  await sendInviteEmail(user.email, user.displayName, token)
  await recordAudit({ action: 'echipa.invitare.retrimisa', entityType: 'user', entityId: userId })
  return { ok: true }
}

/** Trimite link de resetare a parolei unui om — admin sau manager, ca la invitație. */
export async function sendPasswordReset(actor: SessionUser, userId: string) {
  await assertCanManage(actor, userId)
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)))
  if (!user) throw new AccessError('USER_NOT_FOUND', 404, 'Utilizatorul nu există')
  if (user.status === 'invited') {
    throw new AccessError('STILL_INVITED', 409, 'Omul n-a acceptat invitația încă — retrimite-i invitația')
  }
  const token = await createUserToken(user.id, 'reset')
  const link = `${config.frontendOrigin}/reset-password?token=${token}`
  await sendEmail({
    to: user.email,
    from: config.emailFromNoreply,
    subject: 'Resetare parolă VanaDash',
    text: [
      'Salut,',
      '',
      'Pentru contul tău din VanaDash s-a cerut resetarea parolei. Alege una nouă aici:',
      link,
      '',
      'Linkul e valabil o oră și poate fi folosit o singură dată. Dacă nu l-ai cerut tu,',
      'spune-i administratorului — schimbă parola și nu folosi linkul.',
    ].join('\n'),
  })
  await recordAudit({ action: 'echipa.parola.resetare', entityType: 'user', entityId: userId })
  return { ok: true }
}

export async function getMemberMailboxes(userId: string) {
  const rows = await db
    .select({ key: userMailboxes.identityKey })
    .from(userMailboxes)
    .where(and(eq(userMailboxes.userId, userId), isNull(userMailboxes.deletedAt)))
  return { identityKeys: rows.map((r) => r.key) }
}

/**
 * Cutii de email ale unui om. Adminul are toate implicit (fără rânduri); altfel se scriu
 * cheile. Managerul poate da doar cutii pe care le are el (`email.cutii`).
 */
export async function setMemberMailboxes(actor: SessionUser, userId: string, identityKeys: string[]) {
  await assertCanManage(actor, userId)
  const [target] = await db.select({ roleKind: roles.kind }).from(users).leftJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, userId))
  if (target?.roleKind === 'admin') {
    // Adminul are toate cutiile; scrierea unor rânduri i-ar restrânge accesul fără motiv.
    return { identityKeys: [] }
  }
  if (isManager(actor)) {
    const own = actor.mailboxes ?? []
    const beyond = identityKeys.filter((key) => !own.includes(key))
    if (beyond.length > 0) {
      throw new AccessError('PERMISSION_ESCALATION', 403, `Nu ai cutia ${beyond[0]}, deci nu o poți da altcuiva`)
    }
  }
  await db.delete(userMailboxes).where(eq(userMailboxes.userId, userId))
  if (identityKeys.length > 0) {
    await db.insert(userMailboxes).values(identityKeys.map((key) => ({ userId, identityKey: key })))
  }
  await recordAudit({
    action: 'echipa.cutii.schimbate',
    entityType: 'user',
    entityId: userId,
    // `cutii`, nu `identityKeys`: câmpurile cu „key" în nume sunt redactate de `recordAudit`
    // (regula pentru cheile de API), iar cine a primit ce cutie e exact ce trebuie să rămână
    // lizibil în istoric.
    changes: { cutii: [null, identityKeys.join(', ')] },
  })
  return { identityKeys }
}
