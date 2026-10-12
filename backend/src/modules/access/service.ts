import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { roles, users } from '../../shared/db/schema/index.js'
import { availableFeatures, FEATURE_KEYS, featureLabel, pageGroupLabel, pageLabel, PAGES } from '../../shared/lib/features.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { recordAudit } from '../../shared/lib/audit.js'

// Ce poate face fiecare rol (PLAN.md C2). Regulile, pe scurt:
// - `admin` primește tot ce are firma, deci nu are listă și nu se poate edita;
// - `manager` îi pornește adminul funcționalitățile una câte una, inclusiv `echipa.administrare`;
//   fără ea nu administrează pe nimeni. Odată ce o are, creează și editează roluri `custom`,
//   dar numai cu funcționalități pe care le are el — altfel e escaladare.
// - `custom` se pornește gol sau copiat; ceilalți membri ai echipei îl pot avea, însă
//   funcționalitățile lui nu se schimbă dincolo de ce are rolul care le-a dat.

export class AccessError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const escalation = (key: string) =>
  new AccessError('PERMISSION_ESCALATION', 403, `Nu ai ${key}, deci nu îl poți da altcuiva`)

/** Funcționalitățile pe care actorul nu le poate da altora (la manager: tot ce nu are el). */
function lockedFeaturesFor(actor: SessionUser): string[] {
  if (actor.role?.kind === 'admin') return []
  return FEATURE_KEYS.filter((key) => !actor.features.includes(key))
}

function assertCanGrant(actor: SessionUser, keys: string[]) {
  if (actor.role?.kind === 'admin') return
  const blocked = keys.filter((key) => !actor.features.includes(key))
  if (blocked.length > 0) throw escalation(blocked[0] as string)
}

/** Catalogul pentru pagina Module: paginile cu funcționalitățile lor, în ordinea din nav. */
export function getCatalog() {
  const available = availableFeatures()
  return PAGES.map((page) => ({
    page: page.key,
    label: pageLabel(page.key),
    group: pageGroupLabel(page.group),
    viewFeature: page.viewFeature,
    features: available.filter((f) => f.page === page.key).map((f) => ({
      key: f.key,
      label: featureLabel(f.key),
      ownerOnly: f.ownerOnly === true,
    })),
  }))
}

export interface MatrixRole {
  id: string
  name: string
  kind: 'admin' | 'manager' | 'custom'
  features: string[]
  memberCount: number
  editable: boolean
  lockedFeatures: string[]
}

export async function getMatrix(actor: SessionUser) {
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      kind: roles.kind,
      features: roles.features,
      memberCount: sql<number>`count(${users.id})::int`,
    })
    .from(roles)
    .leftJoin(users, and(eq(users.roleId, roles.id), isNull(users.deletedAt)))
    .where(isNull(roles.deletedAt))
    .groupBy(roles.id)
    .orderBy(sql`CASE ${roles.kind} WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, ${roles.name}`)

  const locked = lockedFeaturesFor(actor)
  const availableKeys = availableFeatures().map((feature) => feature.key)
  const matrix: MatrixRole[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as MatrixRole['kind'],
    // Rolul Admin arată lista plină, nu goală, ca să se vadă în matrice ce are „de fapt".
    features: row.kind === 'admin' ? availableKeys : row.features,
    memberCount: row.memberCount,
    editable: row.kind !== 'admin',
    lockedFeatures: row.kind === 'admin' ? [] : locked,
  }))

  return { tenantFeatures: availableKeys, roles: matrix }
}

async function loadEditableRole(actor: SessionUser, roleId: string) {
  const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), isNull(roles.deletedAt)))
  if (!role) throw new AccessError('ROLE_NOT_FOUND', 404, 'Rolul nu există')
  if (role.kind === 'admin') {
    throw new AccessError('ROLE_LOCKED', 409, 'Rolul Admin are tot ce are firma și nu se modifică')
  }
  // „Nu atinge useri admin sau manager și nici rolurile lor" (C2) — aceeași regulă pe care o
  // aplică `assertCanManage` din modulul team, aici asupra rolului, nu asupra omului.
  if (actor.role?.kind !== 'admin' && role.kind === 'manager') {
    throw new AccessError('PERMISSION_ESCALATION', 403, 'Poți edita doar roluri create de tine')
  }
  return role
}

export async function setRoleFeature(actor: SessionUser, roleId: string, key: string, enabled: boolean) {
  if (!FEATURE_KEYS.includes(key)) throw new AccessError('FEATURE_UNKNOWN', 400, `Funcționalitate necunoscută: ${key}`)
  const role = await loadEditableRole(actor, roleId)
  if (enabled) assertCanGrant(actor, [key])
  // Regula „.view oprit": cheile rămân salvate, dar fără poarta paginii nu au efect. Deci
  // pornirea unei funcționalități lasă salvată o combinație inactivă — e exact ce vrea
  // Stefan („La repornire revin"), nu o corectăm aici.
  const next = enabled
    ? [...new Set([...role.features, key])].sort()
    : role.features.filter((f) => f !== key)
  await db.update(roles).set({ features: next, updatedAt: new Date() }).where(eq(roles.id, roleId))
  await recordAudit({
    action: enabled ? 'acces.rol.functionalitate.activata' : 'acces.rol.functionalitate.oprita',
    entityType: 'role',
    entityId: roleId,
    changes: { feature: [role.features.includes(key), enabled] },
  })
  return { features: next }
}

export async function setRolePage(actor: SessionUser, roleId: string, pageKey: string, enabled: boolean) {
  const page = PAGES.find((p) => p.key === pageKey)
  if (!page) throw new AccessError('PAGE_UNKNOWN', 400, `Pagină necunoscută: ${pageKey}`)
  const role = await loadEditableRole(actor, roleId)
  const keys = availableFeatures().filter((f) => f.page === pageKey).map((f) => f.key)
  if (enabled) assertCanGrant(actor, keys)
  const next = enabled
    ? [...new Set([...role.features, ...keys])].sort()
    : role.features.filter((f) => !keys.includes(f))
  await db.update(roles).set({ features: next, updatedAt: new Date() }).where(eq(roles.id, roleId))
  await recordAudit({
    action: enabled ? 'acces.rol.pagina.activata' : 'acces.rol.pagina.oprita',
    entityType: 'role',
    entityId: roleId,
    changes: { page: [null, `${pageKey}:${enabled}`] },
  })
  return { features: next }
}

export async function createRole(actor: SessionUser, input: { name: string; copyFromRoleId?: string }) {
  let features: string[] = []
  if (input.copyFromRoleId) {
    const [source] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, input.copyFromRoleId), isNull(roles.deletedAt)))
    if (!source) throw new AccessError('ROLE_NOT_FOUND', 404, 'Rolul sursă nu există')
    features = source.kind === 'admin' ? availableFeatures().map((f) => f.key) : [...source.features]
    assertCanGrant(actor, features)
  }
  const [role] = await db
    .insert(roles)
    .values({ name: input.name, kind: 'custom', features, createdByUserId: actor.id })
    .returning()
  if (!role) throw new Error('Rol necreat')
  await recordAudit({ action: 'acces.rol.creat', entityType: 'role', entityId: role.id, changes: { name: [null, role.name] } })
  return { id: role.id, name: role.name, kind: role.kind, features: role.features }
}

export async function renameRole(actor: SessionUser, roleId: string, name: string) {
  const role = await loadEditableRole(actor, roleId)
  await db.update(roles).set({ name, updatedAt: new Date() }).where(eq(roles.id, roleId))
  await recordAudit({ action: 'acces.rol.redenumit', entityType: 'role', entityId: roleId, changes: { name: [role.name, name] } })
  return { id: roleId, name }
}

export async function deleteRole(actor: SessionUser, roleId: string) {
  const role = await loadEditableRole(actor, roleId)
  const [member] = await db
    .select({ count: sql<number>`count(${users.id})::int` })
    .from(users)
    .where(and(eq(users.roleId, roleId), isNull(users.deletedAt)))
  if ((member?.count ?? 0) > 0) {
    throw new AccessError('ROLE_IN_USE', 409, `${member?.count} oameni au rolul ăsta`)
  }
  await db.update(roles).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(roles.id, roleId))
  await recordAudit({ action: 'acces.rol.sters', entityType: 'role', entityId: roleId, changes: { name: [role.name, null] } })
  return { ok: true }
}

/** Lista pentru „Scrie" — orice user activ (ruta e `self`), deci doar datele de contact. */
export async function listMembers() {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      lastSeenAt: users.lastSeenAt,
      roleId: roles.id,
      roleName: roles.name,
      roleKind: roles.kind,
    })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(isNull(users.deletedAt))
    .orderBy(roles.kind, users.displayName)

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    role: row.roleId
      ? { id: row.roleId, name: row.roleName as string, kind: row.roleKind as 'admin' | 'manager' | 'custom' }
      : null,
  }))
}
