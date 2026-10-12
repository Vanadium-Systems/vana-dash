import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { userTokens } from '../db/schema/index.js'
import { tr } from './i18n.js'

// Token-uri de unică folosire: invitație, resetare de parolă, înscriere (PLAN.md C2).
//
// În DB se păstrează doar hash-ul SHA-256. Tokenul clar se întoarce o singură dată, la
// creare, ca să poată fi pus în link — și nu mai apare niciodată: nici în loguri, nici în
// răspunsuri după aceea. Cine ar citi rândul din DB nu poate construi linkul.

export const TOKEN_TTL_HOURS = { invite: 72, reset: 1, signup: 24 } as const
export type TokenKind = keyof typeof TOKEN_TTL_HOURS

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Creează tokenul și întoarce valoarea clară (doar apelantul o trimite prin email). */
export async function createUserToken(userId: string, kind: TokenKind): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const [row] = await db
    .insert(userTokens)
    .values({
      userId,
      kind,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS[kind] * 3_600_000),
    })
    .returning()
  if (!row) throw new Error(tr('errors.auth.tokenNotCreated'))
  return token
}

export type ConsumeResult = { userId: string } | { error: 'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_USED' }

/**
 * Validează și consumă un token. Un token deja folosit se respinge chiar dacă nu a expirat
 * (nu e single-use altfel), iar un token expirat se deosebește de unul invalid — linkul expirat
 * trebuie să poată cere altul, nu să spună „adresă greșită".
 */
export async function consumeUserToken(token: string, kind: TokenKind): Promise<ConsumeResult> {
  const [row] = await db
    .select()
    .from(userTokens)
    .where(and(eq(userTokens.tokenHash, hash(token)), eq(userTokens.kind, kind), isNull(userTokens.deletedAt)))
  if (!row) return { error: 'TOKEN_INVALID' }
  if (row.usedAt) return { error: 'TOKEN_USED' }
  if (row.expiresAt.getTime() <= Date.now()) return { error: 'TOKEN_EXPIRED' }
  // `used_at IS NULL` in the UPDATE itself: two requests with the same link cannot both pass.
  const claimed = await db
    .update(userTokens)
    .set({ usedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(userTokens.id, row.id), isNull(userTokens.usedAt)))
    .returning({ id: userTokens.id })
  if (claimed.length === 0) return { error: 'TOKEN_USED' }
  return { userId: row.userId }
}
