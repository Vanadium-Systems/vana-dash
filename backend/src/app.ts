import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import sensible from '@fastify/sensible'
import Fastify, { type FastifyError } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { accessRoutes } from './modules/access/routes.js'
import { accountingRoutes } from './modules/accounting/routes.js'
import { alertsRoutes } from './modules/alerts/routes.js'
import { archiveRoutes } from './modules/archive/routes.js'
import { assetsRoutes } from './modules/assets/routes.js'
import { assistantRoutes } from './modules/assistant/routes.js'
import { settingsRoutes } from './modules/settings/routes.js'
import { authRoutes, passwordRoutes, SESSION_COOKIE } from './modules/auth/routes.js'
import { auditRoutes } from './modules/audit/routes.js'
import { calendarRoutes } from './modules/calendar/routes.js'
import { bookingRoutes } from './modules/booking/routes.js'
import { chatRoutes } from './modules/chat/routes.js'
import { contractsRoutes } from './modules/contracts/routes.js'
import { supportRoutes } from './modules/support/routes.js'
import { cryptoRoutes } from './modules/crypto/routes.js'
import { emailDraftsRoutes } from './modules/email/drafts-routes.js'
import { emailImagesRoutes } from './modules/email/images-routes.js'
import { emailInboundRoutes } from './modules/email/inbound-routes.js'
import { emailOrganizeRoutes } from './modules/email/organize-routes.js'
import { emailRoutes } from './modules/email/routes.js'
import { emailSequencesRoutes } from './modules/email/sequences-routes.js'
import { emailSettingsRoutes } from './modules/email/settings-routes.js'
import { financialsRoutes } from './modules/financials/routes.js'
import { invoicingRoutes } from './modules/invoicing/routes.js'
import { jeffbotRoutes } from './modules/jeffbot/routes.js'
import { metricRoutes } from './modules/metrics/routes.js'
import { monitoringRoutes } from './modules/monitoring/routes.js'
import { sentryWebhookRoutes } from './modules/webhooks/sentry-routes.js'
import { vanagreenAlertRoutes } from './modules/webhooks/vanagreen-routes.js'
import { vanagreenIngestRoutes } from './modules/vanagreen-ingest/routes.js'
import { notesRoutes } from './modules/notes/routes.js'
import { planRoutes } from './modules/plan/routes.js'
import { platformRoutes } from './modules/platforms/routes.js'
import { pricingRoutes } from './modules/pricing/routes.js'
import { prospectsRoutes } from './modules/prospects/routes.js'
import { pushRoutes } from './modules/push/routes.js'
import { reconciliationRoutes } from './modules/reconciliation/routes.js'
import { reportsRoutes } from './modules/reports/routes.js'
import { searchRoutes } from './modules/search/routes.js'
import { teamRoutes } from './modules/team/routes.js'
import { tendersRoutes } from './modules/tenders/routes.js'
import { wishlistRoutes } from './modules/wishlist/routes.js'
import { config } from './shared/config.js'
import { authPlugin } from './shared/middleware/auth.js'
import { featureGuardPlugin } from './shared/middleware/feature-guard.js'

export async function buildServer() {
  const app = Fastify({
    logger: config.isProduction
      ? true
      : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } },
    // Default Fastify (1MB) e prea mic pt. atașamente email (base64 în body JSON,
    // modules/email) — single user autentificat, nu API public, risc de abuz redus.
    bodyLimit: 20 * 1024 * 1024,
    // Backend nu e expus direct (fără port publicat în docker-compose), singurul hop e
    // Caddy pe rețeaua internă — trustProxy=true e sigur și necesar ca request.ip (folosit
    // de rate-limit) să reflecte clientul real, nu IP-ul containerului Caddy pentru toate
    // cererile deodată (altfel rate-limit-ul devine un singur bucket global, nu per-client).
    trustProxy: true,
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  // Fără asta, orice eșec de validare Zod (schema: { body/querystring: ... }) cădea pe eroarea
  // implicită Fastify — { error: "Bad Request", message: "<zod issues>" } — iar api.ts (FE)
  // citește doar `body.error` din envelope-ul {success,data,error}, niciodată `message`. Stefan
  // vedea un toast "Bad Request" fără niciun detaliu la orice edit respins de-o regulă de
  // business (ex. benzile puncte de lucru trebuie strict crescătoare) — arăta ca "nu pot
  // modifica" bandă, deși salvarea era doar respinsă silențios cu motivul ascuns.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.code === 'FST_ERR_VALIDATION' && error.validation?.length) {
      const zodError = error.validation[0]?.params?.zodError as { issues: Array<{ path: (string | number)[]; message: string }> } | undefined
      const message = zodError
        ? zodError.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
        : error.message
      return reply.code(400).send({ success: false, error: message })
    }
    const statusCode = error.statusCode ?? 500
    if (statusCode >= 500) request.log.error(error)
    return reply.code(statusCode).send({ success: false, error: statusCode >= 500 ? 'Eroare internă' : error.message })
  })

  await app.register(helmet)
  await app.register(cors, { origin: config.frontendOrigin, credentials: true })
  await app.register(cookie)
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  })
  // 300/min global era prea strâns: single user, dar pe mai multe device-uri simultan
  // (laptop + APK telefon, același IP) — poll-urile independente (unread-counts
  // /15s, alerts /60s, thread /30s) plus navigare activă (fiecare pagină pornește ~10 query-uri
  // în paralel) treceau de prag, cu 429 pe TOATE rutele deodată (bucket comun). Incident
  // 2026-08-27: 429-uri în serie pe email + metrics + financials + auth/me. Ridicat la 900/min.
  await app.register(rateLimit, { max: 900, timeWindow: '1 minute' })
  await app.register(sensible)
  await app.register(authPlugin)
  // După authPlugin: hook-ul lui mută `authenticate` în preValidation, iar guard-ul trebuie
  // să vadă astea ca să știe care rute sunt autentificate.
  await app.register(featureGuardPlugin)

  app.get('/health', async () => ({ status: 'ok' }))

  await app.register(authRoutes)
  await app.register(passwordRoutes)
  await app.register(accessRoutes)
  await app.register(auditRoutes)
  await app.register(teamRoutes)
  await app.register(chatRoutes)
  await app.register(platformRoutes)
  await app.register(metricRoutes)
  await app.register(accountingRoutes)
  await app.register(invoicingRoutes)
  await app.register(reconciliationRoutes)
  await app.register(financialsRoutes)
  await app.register(pricingRoutes)
  await app.register(prospectsRoutes)
  await app.register(emailRoutes)
  await app.register(emailImagesRoutes)
  await app.register(emailInboundRoutes)
  await app.register(emailOrganizeRoutes)
  await app.register(emailDraftsRoutes)
  await app.register(emailSequencesRoutes)
  await app.register(emailSettingsRoutes)
  await app.register(monitoringRoutes)
  await app.register(sentryWebhookRoutes)
  await app.register(vanagreenAlertRoutes)
  await app.register(vanagreenIngestRoutes)
  await app.register(archiveRoutes)
  await app.register(calendarRoutes)
  await app.register(bookingRoutes)
  await app.register(contractsRoutes)
  await app.register(supportRoutes)
  await app.register(notesRoutes)
  await app.register(wishlistRoutes)
  await app.register(planRoutes)
  await app.register(alertsRoutes)
  await app.register(reportsRoutes)
  await app.register(pushRoutes)
  await app.register(assistantRoutes)
  await app.register(cryptoRoutes)
  await app.register(jeffbotRoutes)
  await app.register(assetsRoutes)
  await app.register(settingsRoutes)
  await app.register(tendersRoutes)
  await app.register(searchRoutes)

  return app
}
