import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { archiveFolderShares, archiveFolders, users } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { config } from '../../shared/config.js'
import { tr, trFor } from '../../shared/lib/i18n.js'

// Accesul pe un folder (PLAN.md C2, „Arhivă și calendar per om"): dreptul se ține pe folder și
// se moștenește în subarbore. Trei surse, toate luate în calcul într-o singură interogare:
// proprietarul spațiului (`owner_user_id`, propagat la creare pe întreg subarbore), share-urile
// explicite și — doar pentru admin și managerul cu `arhiva.administrare` — toate spațiile.
//
// Numărul e un rang, ca „cel mai puternic" să fie un simplu `MAX(lvl)`: 0 = fără acces,
// 1 = vede, 2 = editează. Filtrarea se face în SQL (CTE recursiv pe `parent_id`), nu în JS —
// lista de foldere accesibile nu se aduce în aplicație ca să fie filtrată acolo.

export type AccessLevel = 0 | 1 | 2

export const NO_ACCESS = 0 as const
export const VIEW_ACCESS = 1 as const
export const EDIT_ACCESS = 2 as const

/** Vede conținutul tuturor spațiilor și poate atribui folderele (decizie Stefan, 2026-09-30). */
export function managesAllSpaces(me: SessionUser): boolean {
  return me.features.includes('arhiva.administrare')
}

/**
 * CTE-ul care calculează nivelul de acces per folder: pornește de la sursele de drept
 * (spațiul propriu, share-urile, „toate spațiile" pt. administrare) și propagă nivelul în
 * subarbore, ca un copil să nu aibă nevoie de rând propriu.
 */
export function accessibleFoldersCte(me: SessionUser): SQL {
  const manageAll = managesAllSpaces(me)
  return sql`
    WITH RECURSIVE granted AS (
      SELECT f."id" AS id, 2 AS lvl
        FROM "archive_folders" f
       WHERE f."owner_user_id" = ${me.id}
      UNION
      SELECT s."folder_id", CASE s."level" WHEN 'edit' THEN 2 ELSE 1 END
        FROM "archive_folder_shares" s
       WHERE s."user_id" = ${me.id} AND s."deleted_at" IS NULL
      ${manageAll ? sql`UNION SELECT f."id", 1 FROM "archive_folders" f WHERE f."deleted_at" IS NULL` : sql``}
    ), spread AS (
      SELECT id, lvl FROM granted
      UNION
      SELECT c."id", sp.lvl
        FROM "archive_folders" c
        JOIN spread sp ON c."parent_id" = sp.id
       WHERE c."deleted_at" IS NULL
    ), access AS (
      SELECT id, MAX(lvl)::int AS lvl FROM spread GROUP BY id
    )
  `
}

/**
 * `folder_paths`: drumul de la cel mai de sus folder accesibil până la fiecare folder — pe
 * coloane `path_ids` / `path_names`, ca la căutare și la breadcrumb.
 *
 * Pornește **doar** de la vârfurile accesibile (folder al cărui părinte nu-l poate vedea omul):
 * un folder primit prin share e vârful lui, deci drumul său nu mai conține strămoșii pe care omul
 * nu-i are acces; altfel fiecare folder ar apărea o dată pentru fiecare strămoș accesibil.
 *
 * `NOT (f.id = ANY(fp.path_ids))` e obligatoriu: `UNION ALL` nu deduplică, deci pe un arbore cu
 * ciclu recurența nu se termină. S-a întâmplat pe 2026-10-01: o variantă veche a migrării 0065
 * a făcut rădăcina propriul părinte, iar 15 interogări au scris ~700 GB de fișiere temporare
 * pe Postgres-ul de dev. Orice CTE recursiv nou pe `parent_id` folosește `UNION` sau gardul ăsta.
 */
export function accessiblePathsCte(me: SessionUser): SQL {
  return sql`
    ${accessibleFoldersCte(me)}
    , folder_paths AS (
      SELECT a.id, ARRAY[a.id] AS path_ids, ARRAY[f.name] AS path_names
        FROM access a
        JOIN "archive_folders" f ON f."id" = a.id
       WHERE f."deleted_at" IS NULL
         AND a.lvl >= 1
         AND NOT EXISTS (
           SELECT 1 FROM "archive_folders" p
            WHERE p."id" = f."parent_id" AND p."deleted_at" IS NULL
              AND p."id" IN (SELECT a2.id FROM access a2 WHERE a2.lvl >= 1)
         )
      UNION ALL
      SELECT f.id, fp.path_ids || f.id, fp.path_names || f.name
        FROM folder_paths fp
        JOIN "archive_folders" f ON f."parent_id" = fp.id
       WHERE f."deleted_at" IS NULL
         AND NOT (f.id = ANY(fp.path_ids))
    )
  `
}

/** Nivelul efectiv al omului pe un folder anume — pt. cereri directe după id (mutare, download). */
export async function folderAccessLevel(me: SessionUser, folderId: string): Promise<AccessLevel> {
  const rows = await db.execute<{ lvl: number }>(sql`
    ${accessibleFoldersCte(me)}
    SELECT COALESCE((SELECT a.lvl FROM access a WHERE a.id = ${folderId}), 0)::int AS lvl
  `)
  return (rows[0]?.lvl ?? 0) as AccessLevel
}

/**
 * Rădăcina spațiului unui om, creată la prima atingere (nu la invite — un user nou fără
 * `arhiva.view` n-ar avea cine să-i creeze spațiul).
 */
function spaceRootName(user: { displayName: string | null; email: string }) {
  return trFor(config.defaultLocale, 'errors.archive.spaceName', { name: user.displayName ?? user.email.split('@')[0] })
}

async function findOrCreateRoot(owner: { id: string; displayName: string | null; email: string }) {
  const [existing] = await db
    .select({ id: archiveFolders.id, ownerUserId: archiveFolders.ownerUserId })
    .from(archiveFolders)
    .where(
      and(eq(archiveFolders.ownerUserId, owner.id), isNull(archiveFolders.parentId), isNull(archiveFolders.deletedAt)),
    )
  if (existing) return existing

  const [created] = await db
    .insert(archiveFolders)
    .values({ name: spaceRootName(owner), ownerUserId: owner.id })
    .returning({ id: archiveFolders.id, ownerUserId: archiveFolders.ownerUserId })
  if (!created) throw new Error(tr('errors.archive.spaceNotCreated'))
  return created
}

/** Rădăcina spațiului omului, creată la prima atingere (nu la invite — un user nou fără
 *  `arhiva.view` n-ar avea cine să-i creeze spațiul), cu owner-ul ei. */
export async function ensureSpaceRow(me: SessionUser): Promise<{ id: string; ownerUserId: string }> {
  return findOrCreateRoot(me)
}

/** Doar id-ul rădăcinii — ce se folosește drept „rădăcină" în navigare și în listare. */
export async function ensureSpaceRoot(me: SessionUser): Promise<string> {
  return (await findOrCreateRoot(me)).id
}

/**
 * Rădăcina spațiului în care scriu joburile de arhivare automată — a lui Stefan
 * (`is_platform_admin`). Joburile rulează ca „sistem" și au nevoie de un spațiu anume, nu de un
 *ul oarecare: fără această funcție ar crea folderele în spațiul primei persoane întâlnite.
 */
export async function systemArchiveRoot(): Promise<string> {
  const [owner] = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(and(eq(users.isPlatformAdmin, true), isNull(users.deletedAt)))
  if (!owner) throw new Error(tr('errors.archive.noPlatformAdmin'))
  return (await findOrCreateRoot(owner)).id
}

export interface FolderShare {
  id: string
  userId: string
  level: 'view' | 'edit'
  displayName: string | null
  email: string
}

/** Ce cine are share pe folder — lista din dialogul „Partajează" (owner sau admin). */
export async function listFolderShares(folderId: string): Promise<FolderShare[]> {
  const rows = await db
    .select({
      id: archiveFolderShares.id,
      userId: archiveFolderShares.userId,
      level: archiveFolderShares.level,
      displayName: users.displayName,
      email: users.email,
    })
    .from(archiveFolderShares)
    .innerJoin(users, eq(users.id, archiveFolderShares.userId))
    .where(and(eq(archiveFolderShares.folderId, folderId), isNull(archiveFolderShares.deletedAt)))
    .orderBy(users.displayName, users.email)
  return rows
}

export interface SpaceRoot {
  id: string
  name: string
  ownerUserId: string
  ownerName: string
}

const SPACE_ROOT_COLUMNS = {
  id: archiveFolders.id,
  name: archiveFolders.name,
  ownerUserId: archiveFolders.ownerUserId,
  ownerName: sql<string>`COALESCE(NULLIF(${users.displayName}, ''), ${users.email})`,
}

/** Rădăcinile tuturor spațiilor, cu numele omului — „Toate spațiile" (administrare). */
export async function listAllSpaceRoots(): Promise<SpaceRoot[]> {
  return db
    .select(SPACE_ROOT_COLUMNS)
    .from(archiveFolders)
    .innerJoin(users, eq(users.id, archiveFolders.ownerUserId))
    .where(and(isNull(archiveFolders.parentId), isNull(archiveFolders.deletedAt), isNull(users.deletedAt)))
    .orderBy(sql`COALESCE(NULLIF(${users.displayName}, ''), ${users.email})`)
}

/** Rădăcinile spațiului unui anumit om — „Atribuie folderele lui" din Echipă. */
export async function listSpaceRootsOf(ownerUserId: string): Promise<SpaceRoot[]> {
  return db
    .select(SPACE_ROOT_COLUMNS)
    .from(archiveFolders)
    .innerJoin(users, eq(users.id, archiveFolders.ownerUserId))
    .where(
      and(
        eq(archiveFolders.ownerUserId, ownerUserId),
        isNull(archiveFolders.parentId),
        isNull(archiveFolders.deletedAt),
      ),
    )
}