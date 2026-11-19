import argon2 from 'argon2'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { users } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { errorBody, fail } from '../../shared/lib/http-error.js'
import { tr, trFor } from '../../shared/lib/i18n.js'
import { DISPLAY_CURRENCIES, ENABLED_LOCALES } from '../../shared/lib/locale.js'
import { sendEmail } from '../../shared/lib/email.js'
import { consumeUserToken, createUserToken } from '../../shared/lib/user-tokens.js'
import { revokeUserApiTokens } from '../../shared/lib/api-tokens.js'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  listUserDevices,
  markPasswordConfirmed,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_IDLE_DAYS,
  revokeFamily,
  revokeUserSessions,
  rotateSession,
  startSession,
} from '../../shared/lib/sessions.js'
import { loadSessionUser, DEFAULT_NOTIFICATION_PREFS, type SessionUser } from '../../shared/lib/session.js'
import { AcceptInviteSchema, ChangePasswordSchema, ConfirmPasswordSchema, SessionFamilyParamsSchema, ForgotPasswordSchema, LoginBodySchema, PatchMeSchema, ResetPasswordSchema } from './schema.js'
import { isDemoInstall, verifyCredentials } from './service.js'
import { getOwnerTenantId, runAsTenant, withRlsBypass } from '../../shared/lib/tenancy.js'

export const SESSION_COOKIE = 'vana_session'
// The access cookie outlives its JWT (15 minutes) so the browser keeps sending it; an expired JWT
// answers 401 and the client refreshes. The refresh cookie is the one that keeps the person logged in.
const SESSION_COOKIE_MAX_AGE_SECONDS = REFRESH_IDLE_DAYS * 24 * 60 * 60
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
    tenant: me.tenant
      ? {
          id: me.tenant.id,
          name: me.tenant.name,
          isPlatformOwner: me.tenant.isPlatformOwner,
          country: me.tenant.country,
          timeZone: me.tenant.timeZone,
          currency: me.tenant.currency,
        }
      : null,
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
    motionPref: me.motionPref ?? 'system',
    themePalette: me.themePalette ?? 'vanadium',
    hideAmounts: me.hideAmounts ?? false,
    soundOn: me.soundOn ?? false,
  }
}

function setAccessCookie(reply: FastifyReply, accessJwt: string) {
  return reply.setCookie(SESSION_COOKIE, accessJwt, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  })
}

function setRefreshCookie(reply: FastifyReply, refreshToken: string) {
  return reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: config.isProduction,
    // Strict: the only reader is the app itself, never a link from another site.
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  })
}

function clearAuthCookies(reply: FastifyReply) {
  return reply.clearCookie(SESSION_COOKIE, { path: '/' }).clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH })
}

async function signAccess(reply: FastifyReply, user: { id: string; sessionVersion: number; tenantId?: string }, sessionId: string) {
  return reply.jwtSign(
    { sub: user.id, sv: user.sessionVersion, sid: sessionId, ...(user.tenantId ? { tid: user.tenantId } : {}) },
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  )
}

/** Runs `fn` in the person's own company. Sessions, password and devices live there, also while a
 *  platform admin looks at another company (X-Tenant-Id moves the request's context, not these). */
function asHome<T>(me: Pick<SessionUser, 'tenant'>, fn: () => Promise<T>): Promise<T> {
  return runAsTenant(me.tenant?.id ?? getOwnerTenantId(), fn)
}

/** Starts a login session (new family) and sets both cookies. */
async function issueSession(req: FastifyRequest, reply: FastifyReply, me: SessionUser) {
  const { sessionId, refreshToken } = await asHome(me, () =>
    startSession(me.id, me.sessionVersion, { ip: req.ip, userAgent: req.headers['user-agent'] }),
  )
  const accessJwt = await signAccess(reply, { id: me.id, sessionVersion: me.sessionVersion, tenantId: me.tenant?.id }, sessionId)
  setAccessCookie(reply, accessJwt)
  setRefreshCookie(reply, refreshToken)
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

      // Before login there is no company in the context; email addresses are unique across companies.
      const user = await withRlsBypass(() => verifyCredentials(email, password))
      // Un user dezactivat primește același răspuns ca unul inexistent — altfel formularul
      // de login ar confirma că adresa există.
      if (!user || user.status !== 'active') {
        return fail(reply, 401, 'INVALID_CREDENTIALS', { message: tr('errors.auth.invalidCredentials') })
      }

      // One user by id, read before any company is in the context; the company comes from the row.
      const me = await withRlsBypass(() => loadSessionUser(user.id))
      if (!me) return fail(reply, 401, 'INVALID_CREDENTIALS', { message: tr('errors.auth.invalidCredentials') })

      await issueSession(req, reply, me)
      return reply.send({ success: true, data: sessionPayload(me) })
    },
  )

  server.post('/api/auth/logout', { preHandler: [app.authenticate] }, async (req, reply) => {
    const familyId = req.session?.familyId
    if (familyId) await asHome(req.me, () => revokeFamily(familyId, 'logout'))
    return clearAuthCookies(reply).send({ success: true })
  })

  // Exchanges the refresh cookie for a new pair. Public: it runs exactly when the access token has
  // expired. A refresh token that was already replaced coming back = copied; the family is revoked.
  server.post(
    '/api/auth/refresh',
    { bodyLimit: PUBLIC_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const presented = req.cookies[REFRESH_COOKIE]
      const unauthorized = () => clearAuthCookies(reply).code(401).send(errorBody(401, 'SESSION_EXPIRED'))
      if (!presented) return unauthorized()

      // No access token, so no company yet: the refresh token's row says which one. Looked up by
      // the hash of a random secret.
      const result = await withRlsBypass(() => rotateSession(presented, { ip: req.ip, userAgent: req.headers['user-agent'] }))
      if (result.kind === 'reuse') {
        await recordAudit({ action: 'sesiune.refolosita', entityType: 'user', entityId: result.userId, actorUserId: null })
        return unauthorized()
      }
      if (result.kind === 'invalid') return unauthorized()

      const session = result.session
      const me = await runAsTenant(session.tenantId, () => loadSessionUser(session.userId))
      const tenantBlocked = me?.tenant && me.tenant.status !== 'active' && !me.tenant.isPlatformOwner
      if (!me || me.status !== 'active' || me.sessionVersion !== session.sessionVersion || tenantBlocked) {
        await runAsTenant(session.tenantId, () => revokeFamily(session.familyId, me?.status === 'active' ? 'password' : 'disabled'))
        return unauthorized()
      }
      const accessJwt = await signAccess(reply, { id: me.id, sessionVersion: me.sessionVersion, tenantId: me.tenant?.id }, session.id)
      setAccessCookie(reply, accessJwt)
      if (result.kind === 'rotated') setRefreshCookie(reply, result.refreshToken)
      return reply.send({ success: true })
    },
  )

  // Sensitive actions (a new API token, changing someone's role or status) ask for the password
  // again when the last confirmation in this session is older than 10 minutes.
  server.post(
    '/api/auth/confirm-password',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: { body: ConfirmPasswordSchema },
    },
    async (req, reply) => {
      const [row] = await asHome(req.me, () => db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, req.me.id)))
      if (!row || !(await argon2.verify(row.passwordHash, req.body.password))) {
        return fail(reply, 401, 'CURRENT_PASSWORD_WRONG', { message: tr('errors.auth.currentPasswordWrong') })
      }
      const familyId = req.session?.familyId
      if (familyId) await asHome(req.me, () => markPasswordConfirmed(familyId))
      return reply.send({ success: true })
    },
  )

  server.get('/api/me/sessions', { preHandler: [app.authenticate] }, async (req) => {
    const devices = await asHome(req.me, () => listUserDevices(req.me.id))
    return { success: true, data: devices.map((device) => ({ ...device, current: device.familyId === req.session?.familyId })) }
  })

  server.delete(
    '/api/me/sessions/:familyId',
    { preHandler: [app.authenticate], schema: { params: SessionFamilyParamsSchema } },
    async (req, reply) => {
      const devices = await asHome(req.me, () => listUserDevices(req.me.id))
      // Someone else's session (or one already gone) answers 404, as for any personal object.
      if (!devices.some((device) => device.familyId === req.params.familyId)) {
        return fail(reply, 404, 'SESSION_NOT_FOUND', { message: tr('errors.auth.sessionNotFound') })
      }
      await asHome(req.me, () => revokeFamily(req.params.familyId, 'logout'))
      return reply.send({ success: true })
    },
  )

  server.post('/api/me/sessions/revoke-others', { preHandler: [app.authenticate] }, async (req, reply) => {
    await asHome(req.me, () => revokeUserSessions(req.me.id, 'logout', req.session?.familyId))
    return reply.send({ success: true })
  })

  server.get(
    '/api/auth/me',
    { preHandler: [app.authenticate] },
    async (req) => ({
      success: true,
      data: {
        ...sessionPayload(req.me),
        isDemo: await isDemoInstall(),
      },
    }),
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
      // No session: the address is unique across companies, and the row says whose it is.
      const [user] = await withRlsBypass(() =>
        db
          .select({ id: users.id, email: users.email, displayName: users.displayName, status: users.status, locale: users.locale, tenantId: users.tenantId })
          .from(users)
          .where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt))),
      )
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
        void runAsTenant(user.tenantId, sendResetLink).catch((err) => req.log.error({ err }, '[auth] reset email not sent'))
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
      if (weak) return fail(reply, 400, 'PASSWORD_TOO_SHORT', { message: weak })

      // Token invalid și token expirat primesc același cod: linkul expirat trebuie să poată cere
      // altul din pagina de resetare, nu să spună „adresă greșită".
      const consumed = await consumeUserToken(token, 'reset')
      if ('error' in consumed) {
        return fail(reply, 400, 'RESET_TOKEN_EXPIRED')
      }
      const passwordHash = await argon2.hash(password)
      await runAsTenant(consumed.tenantId, async () => {
        // sv++ invalidează toate sesiunile, inclusiv cea din care s-a cerut resetarea.
        await db
          .update(users)
          .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
          .where(eq(users.id, consumed.userId))
        await revokeUserApiTokens(consumed.userId)
        await revokeUserSessions(consumed.userId, 'password')
        await recordAudit({ action: 'parola.resetata', entityType: 'user', entityId: consumed.userId })
      })
      return reply.code(204).send()
    },
  )

  server.post(
    '/api/auth/accept-invite',
    { bodyLimit: PUBLIC_BODY_LIMIT, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { body: AcceptInviteSchema } },
    async (req, reply) => {
      const { token, password } = req.body
      const weak = assertPasswordStrength(password)
      if (weak) return fail(reply, 400, 'PASSWORD_TOO_SHORT', { message: weak })

      const consumed = await consumeUserToken(token, 'invite')
      if ('error' in consumed) {
        // Linkul folosit deja înseamnă de obicei un cont activ: pagina trimite la login, nu la
        // „cere altă invitație".
        const code = consumed.error === 'TOKEN_USED' ? 'INVITE_USED' : 'INVITE_EXPIRED'
        return fail(reply, 400, code)
      }
      return runAsTenant(consumed.tenantId, async () => {
        const [existing] = await db
          .select({ status: users.status })
          .from(users)
          .where(and(eq(users.id, consumed.userId), isNull(users.deletedAt)))
        // Omul a fost dezactivat între invitare și acceptare: linkul nu mai aduce nimic, altfel
        // ar putea să-și redea singur accesul în aplicație.
        if (!existing || existing.status === 'disabled') {
          return fail(reply, 400, 'INVITE_EXPIRED')
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
        if (!user) return fail(reply, 400, 'INVITE_EXPIRED')

        // Loghează omul imediat după acceptare — altfel ar trebui să scrie parola a doua oară.
        const me = await loadSessionUser(user.id)
        await recordAudit({ action: 'echipa.invitatie.acceptata', entityType: 'user', entityId: user.id })
        if (me) await issueSession(req, reply, me)
        return reply.send({ success: true, data: me ? sessionPayload(me) : null })
      })
    },
  )

  // ── Profilul meu (self) ──────────────────────────────────────────────────────────────────

  server.patch('/api/auth/me', { preHandler: [app.authenticate], schema: { body: PatchMeSchema } }, async (req, reply) => {
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
    if (req.body.locale !== undefined) {
      if (!ENABLED_LOCALES.includes(req.body.locale)) {
        return fail(reply, 400, 'LOCALE_NOT_ENABLED', { message: tr('errors.auth.localeNotEnabled') })
      }
      patch.locale = req.body.locale
    }
    if (req.body.displayCurrency !== undefined) patch.displayCurrency = req.body.displayCurrency
    if (req.body.displayName !== undefined) patch.displayName = req.body.displayName
    if (req.body.motionPref !== undefined) patch.motionPref = req.body.motionPref
    if (req.body.themePalette !== undefined) patch.themePalette = req.body.themePalette
    if (req.body.hideAmounts !== undefined) patch.hideAmounts = req.body.hideAmounts
    if (req.body.soundOn !== undefined) patch.soundOn = req.body.soundOn
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

  server.post(
    '/api/auth/me/password',
    {
      preHandler: [app.authenticate],
      // Keyed on the person, after authentication: a stolen session must not get to guess the
      // current password at the global rate, from however many addresses.
      config: { rateLimit: { max: 5, timeWindow: '15 minutes', hook: 'preHandler', keyGenerator: (req) => `password:${req.me?.id ?? req.ip}` } },
    },
    async (req, reply) => {
      // The person's own company: a platform admin looking at another one changes their own password.
      return asHome(req.me, async () => {
        const parsed = ChangePasswordSchema.safeParse(req.body)
        if (!parsed.success) {
          return fail(reply, 400, 'NEW_PASSWORD_INVALID', { message: tr('errors.auth.newPasswordInvalid') })
        }
        const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, req.me.id))
        if (!row || !(await argon2.verify(row.passwordHash, parsed.data.currentPassword))) {
          return fail(reply, 401, 'CURRENT_PASSWORD_WRONG', { message: tr('errors.auth.currentPasswordWrong') })
        }
        const weak = assertPasswordStrength(parsed.data.newPassword)
        if (weak) return fail(reply, 400, 'PASSWORD_TOO_SHORT', { message: weak })

        // sv++ delogă celelalte dispozitive; sesiunea curentă rămâne validă doar dacă tokenul
        // poartă noua valoare — de aceea semnăm un token nou mai jos.
        const nextVersion = req.me.sessionVersion + 1
        await db
          .update(users)
          .set({ passwordHash: await argon2.hash(parsed.data.newPassword), sessionVersion: nextVersion, updatedAt: new Date() })
          .where(eq(users.id, req.me.id))
        await revokeUserApiTokens(req.me.id)
        await recordAudit({ action: 'parola.schimbata', entityType: 'user', entityId: req.me.id })

        // Every other device is logged out (session_version moved on); this one starts a fresh family.
        await revokeUserSessions(req.me.id, 'password')
        await issueSession(req, reply, { ...req.me, sessionVersion: nextVersion })
        return reply.send({ success: true, data: { otherSessionsRevoked: true } })
      })
    },
  )
}
