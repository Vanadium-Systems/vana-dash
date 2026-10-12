import argon2 from 'argon2'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { users } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { tr, trFor } from '../../shared/lib/i18n.js'
import { DISPLAY_CURRENCIES, ENABLED_LOCALES } from '../../shared/lib/locale.js'
import { sendEmail } from '../../shared/lib/email.js'
import { consumeUserToken, createUserToken } from '../../shared/lib/user-tokens.js'
import { loadSessionUser, DEFAULT_NOTIFICATION_PREFS, type SessionUser } from '../../shared/lib/session.js'
import { AcceptInviteSchema, ChangePasswordSchema, ForgotPasswordSchema, LoginBodySchema, PatchMeSchema, ResetPasswordSchema } from './schema.js'
import { verifyCredentials } from './service.js'

export const SESSION_COOKIE = 'vana_session'
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
// The app-wide limit (20MB) exists for email attachments; a route anyone can call gets a small one.
const PUBLIC_BODY_LIMIT = 16 * 1024

/** Răspunsul de sesiune: același pentru login și pentru `/me`, ca frontendul să aibă o formă. */
export function sessionPayload(me: SessionUser) {
  return {
    user: {
      id: me.id,
      email: me.email,
      displayName: me.displayName,
      role: me.role ? { id: me.role.id, name: me.role.name, kind: me.role.kind } : null,
      status: me.status,
    },
    features: me.features,
    isPlatformAdmin: me.isPlatformAdmin,
    mailboxes: me.mailboxes,
    notificationPrefs: me.notificationPrefs ?? { ...DEFAULT_NOTIFICATION_PREFS },
    navLayout: me.navLayout ?? null,
    updatesSeenAt: me.updatesSeenAt,
    locale: me.locale,
    enabledLocales: ENABLED_LOCALES,
    displayCurrency: me.displayCurrency,
    displayCurrencies: DISPLAY_CURRENCIES,
  }
}

export async function authRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/api/auth/login',
    {
      bodyLimit: PUBLIC_BODY_LIMIT,
      config: {
        // Brute-force protection: 5 attempts per IP every 15 minutes
        rateLimit: { max: 5, timeWindow: '15 minutes' },
      },
      schema: { body: LoginBodySchema },
    },
    async (req, reply) => {
      const { email, password } = req.body
      const setSessionCookie = (token: string) =>
        reply.setCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          secure: config.isProduction,
          sameSite: 'lax',
          path: '/',
          maxAge: SESSION_MAX_AGE_SECONDS,
        })

      const user = await verifyCredentials(email, password)
      // Un user dezactivat primește același răspuns ca unul inexistent — altfel formularul
      // de login ar confirma că adresa există.
      if (!user || user.status !== 'active') {
        return reply.code(401).send({ success: false, error: tr('errors.auth.invalidCredentials') })
      }

      const me = await loadSessionUser(user.id)
      if (!me) return reply.code(401).send({ success: false, error: tr('errors.auth.invalidCredentials') })

      const token = await reply.jwtSign(
        { sub: user.id, sv: user.sessionVersion },
        { expiresIn: SESSION_MAX_AGE_SECONDS },
      )
      return setSessionCookie(token).send({ success: true, data: sessionPayload(me) })
    },
  )

  server.post('/api/auth/logout', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ success: true })
  })

  server.get(
    '/api/auth/me',
    { preHandler: [app.authenticate] },
    async (req) => ({ success: true, data: sessionPayload(req.me) }),
  )

  // What the pages before login need to pick a language. Nothing about the company or its people.
  server.get('/api/auth/locale', async () => ({
    success: true,
    data: { defaultLocale: config.defaultLocale, enabledLocales: ENABLED_LOCALES },
  }))
}

// ── Parole, profil și acceptarea invitației (PLAN.md C2, BE-8) ───────────────────────────────
//
// Rate limit pe rutele publice: 5/minut/IP. Nu există Turnstile în vana-dash (nu e nevoie
// cât timp formele publice nu sunt pe un domeniu public; vine odată cu înscrierea din Etapa 3).
// Răspunsul e identic pentru orice adresă, existentă sau nu — altfel formularul ar confirma
// cine are cont.

const PASSWORD_MIN = 12

function assertPasswordStrength(password: string) {
  // Minim 12 caractere, fără reguli de compoziție (decizie Stefan): o parolă lungă e mai
  // bună decât una scurtă cu „!1".
  if (password.length < PASSWORD_MIN) {
    return tr('errors.auth.passwordTooShort', { min: PASSWORD_MIN })
  }
  return null
}

export async function passwordRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/api/auth/forgot-password',
    { bodyLimit: PUBLIC_BODY_LIMIT, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: ForgotPasswordSchema } },
    async (req, reply) => {
      const { email } = req.body
      const [user] = await db
        .select({ id: users.id, email: users.email, displayName: users.displayName, status: users.status, locale: users.locale })
        .from(users)
        .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)))
      // Same answer whether the address has an account or not. The email goes out after the
      // reply: awaiting it made a known address slower than an unknown one, and a provider
      // error turned into a 500 only for addresses that exist.
      if (user && user.status !== 'invited') {
        const sendResetLink = async () => {
          const token = await createUserToken(user.id, 'reset')
          const link = `${config.frontendOrigin}/reset-password?token=${token}`
          await sendEmail({
            to: user.email,
            from: config.emailFromNoreply,
            subject: trFor(user.locale, 'emails.reset.subject'),
            text: [
              trFor(user.locale, 'emails.invite.greeting'),
              '',
              trFor(user.locale, 'emails.reset.requested'),
              link,
              '',
              trFor(user.locale, 'emails.reset.validitySelf'),
            ].join('\n'),
          })
        }
        void sendResetLink().catch((err) => req.log.error({ err }, '[auth] reset email not sent'))
      }
      return reply.code(204).send()
    },
  )

  server.post(
    '/api/auth/reset-password',
    { bodyLimit: PUBLIC_BODY_LIMIT, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: ResetPasswordSchema } },
    async (req, reply) => {
      const { token, password } = req.body
      const weak = assertPasswordStrength(password)
      if (weak) return reply.code(400).send({ success: false, error: weak })

      // Token invalid și token expirat primesc același cod: linkul expirat trebuie să poată cere
      // altul din pagina de resetare, nu să spună „adresă greșită".
      const consumed = await consumeUserToken(token, 'reset')
      if ('error' in consumed) {
        return reply.code(400).send({ success: false, error: { code: 'RESET_TOKEN_EXPIRED' } })
      }
      // sv++ invalidează toate sesiunile, inclusiv cea din care s-a cerut resetarea.
      await db
        .update(users)
        .set({ passwordHash: await argon2.hash(password), sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
        .where(eq(users.id, consumed.userId))
      await recordAudit({ action: 'parola.resetata', entityType: 'user', entityId: consumed.userId })
      return reply.code(204).send()
    },
  )

  server.post(
    '/api/auth/accept-invite',
    { bodyLimit: PUBLIC_BODY_LIMIT, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: AcceptInviteSchema } },
    async (req, reply) => {
      const { token, password } = req.body
      const weak = assertPasswordStrength(password)
      if (weak) return reply.code(400).send({ success: false, error: weak })

      const consumed = await consumeUserToken(token, 'invite')
      if ('error' in consumed) {
        // Linkul folosit deja înseamnă de obicei un cont activ: pagina trimite la login, nu la
        // „cere altă invitație".
        const code = consumed.error === 'TOKEN_USED' ? 'INVITE_USED' : 'INVITE_EXPIRED'
        return reply.code(400).send({ success: false, error: { code } })
      }
      const [existing] = await db
        .select({ status: users.status })
        .from(users)
        .where(and(eq(users.id, consumed.userId), isNull(users.deletedAt)))
      // Omul a fost dezactivat între invitare și acceptare: linkul nu mai aduce nimic, altfel
      // ar putea să-și redea singur accesul în aplicație.
      if (!existing || existing.status === 'disabled') {
        return reply.code(400).send({ success: false, error: { code: 'INVITE_EXPIRED' } })
      }
      const [user] = await db
        .update(users)
        .set({
          passwordHash: await argon2.hash(password),
          status: 'active',
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, consumed.userId))
        .returning()
      if (!user) return reply.code(400).send({ success: false, error: { code: 'INVITE_EXPIRED' } })

      // Loghează omul imediat după acceptare — altfel ar trebui să scrie parola a doua oară.
      const tokenJwt = await reply.jwtSign({ sub: user.id, sv: user.sessionVersion }, { expiresIn: SESSION_MAX_AGE_SECONDS })
      const me = await loadSessionUser(user.id)
      await recordAudit({ action: 'echipa.invitatie.acceptata', entityType: 'user', entityId: user.id })
      return reply
        .setCookie(SESSION_COOKIE, tokenJwt, {
          httpOnly: true,
          secure: config.isProduction,
          sameSite: 'lax',
          path: '/',
          maxAge: SESSION_MAX_AGE_SECONDS,
        })
        .send({ success: true, data: me ? sessionPayload(me) : null })
    },
  )

  // ── Profilul meu (self) ──────────────────────────────────────────────────────────────────

  server.patch('/api/auth/me', { preHandler: [app.authenticate], schema: { body: PatchMeSchema } }, async (req, reply) => {
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
    if (req.body.locale !== undefined) {
      if (!ENABLED_LOCALES.includes(req.body.locale)) {
        return reply.code(400).send({ success: false, error: tr('errors.auth.localeNotEnabled') })
      }
      patch.locale = req.body.locale
    }
    if (req.body.displayCurrency !== undefined) patch.displayCurrency = req.body.displayCurrency
    if (req.body.displayName !== undefined) patch.displayName = req.body.displayName
    if (req.body.updatesSeenAt !== undefined) {
      patch.updatesSeenAt = new Date(Math.min(Date.parse(req.body.updatesSeenAt), Date.now()))
    }
    if (req.body.notificationPrefs !== undefined) {
      patch.notificationPrefs = {
        ...DEFAULT_NOTIFICATION_PREFS,
        ...req.me.notificationPrefs,
        ...req.body.notificationPrefs,
      }
    }
    await db.update(users).set(patch).where(eq(users.id, req.me.id))
    const fresh = await loadSessionUser(req.me.id)
    return { success: true, data: fresh ? sessionPayload(fresh) : null }
  })

  server.post('/api/auth/me/password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ChangePasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: tr('errors.auth.newPasswordInvalid') })
    }
    const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, req.me.id))
    if (!row || !(await argon2.verify(row.passwordHash, parsed.data.currentPassword))) {
      return reply.code(401).send({ success: false, error: tr('errors.auth.currentPasswordWrong') })
    }
    const weak = assertPasswordStrength(parsed.data.newPassword)
    if (weak) return reply.code(400).send({ success: false, error: weak })

    // sv++ delogă celelalte dispozitive; sesiunea curentă rămâne validă doar dacă tokenul
    // poartă noua valoare — de aceea semnăm un token nou mai jos.
    const nextVersion = req.me.sessionVersion + 1
    await db
      .update(users)
      .set({ passwordHash: await argon2.hash(parsed.data.newPassword), sessionVersion: nextVersion, updatedAt: new Date() })
      .where(eq(users.id, req.me.id))
    await recordAudit({ action: 'parola.schimbata', entityType: 'user', entityId: req.me.id })

    const token = await reply.jwtSign({ sub: req.me.id, sv: nextVersion }, { expiresIn: SESSION_MAX_AGE_SECONDS })
    return reply
      .setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_MAX_AGE_SECONDS,
      })
      .send({ success: true, data: { otherSessionsRevoked: true } })
  })
}
