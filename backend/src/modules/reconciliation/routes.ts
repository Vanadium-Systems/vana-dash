import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { bankConnectors } from '../../connectors/index.js'
import { buildAuthorizeUrl } from '../../connectors/revolut/oauth.js'
import { triggerBankSyncNow } from '../../jobs/sync-bank.js'
import {
  BankAccountCreateSchema,
  BankAccountUpdateSchema,
  IdParamsSchema,
  MatchCreateSchema,
  RevolutExchangeCodeSchema,
  TransactionsQuerySchema,
  VanagreenSettingsUpdateSchema,
  VerifyVanagreenTenantSchema,
} from './schema.js'
import { fail, HttpError } from '../../shared/lib/http-error.js'
import { PaymentError } from '../../shared/lib/payments.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'

export async function reconciliationRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── Conturi bancare ────────────────────────────────────────────────────────

  server.get('/api/reconciliation/providers', { preHandler: [app.authenticate] }, async () => {
    const data = Object.values(bankConnectors).map((c) => ({ type: c.type, displayName: c.displayName }))
    return { success: true, data }
  })

  server.get('/api/reconciliation/accounts', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listAccounts() }
  })

  server.post(
    '/api/reconciliation/accounts',
    { preHandler: [app.authenticate], schema: { body: BankAccountCreateSchema } },
    async (req, reply) => {
      if (!bankConnectors[req.body.provider]) {
        return fail(reply, 400, 'BANK_PROVIDER_UNKNOWN')
      }
      return reply.code(201).send({ success: true, data: await service.createAccount(req.body) })
    },
  )

  server.patch(
    '/api/reconciliation/accounts/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: BankAccountUpdateSchema } },
    async (req, reply) => {
      const account = await service.updateAccount(req.params.id, req.body)
      if (!account) return fail(reply, 404, 'BANK_ACCOUNT_NOT_FOUND')
      return { success: true, data: account }
    },
  )

  server.delete(
    '/api/reconciliation/accounts/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const deleted = await service.softDeleteAccount(req.params.id)
      if (!deleted) return fail(reply, 404, 'BANK_ACCOUNT_NOT_FOUND')
      return { success: true }
    },
  )

  server.post(
    '/api/reconciliation/accounts/:id/sync',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const account = await service.getAccount(req.params.id)
      if (!account) return fail(reply, 404, 'BANK_ACCOUNT_NOT_FOUND')
      await triggerBankSyncNow(req.params.id)
      return { success: true, data: await service.getAccount(req.params.id) }
    },
  )

  // ── Revolut OAuth2 + JWT client assertion (per cont) ────────────────────────

  server.post(
    '/api/reconciliation/accounts/:id/generate-certificate',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const account = await service.getAccount(req.params.id)
      if (!account) return fail(reply, 404, 'BANK_ACCOUNT_NOT_FOUND')
      const data = await service.generateCertificateForAccount(req.params.id)
      return { success: true, data }
    },
  )

  // Pasul 1: Stefan deschide URL-ul în browser și consimte contul Revolut.
  server.get(
    '/api/reconciliation/accounts/:id/authorize-url',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const account = await service.getAccount(req.params.id)
      if (!account) return fail(reply, 404, 'BANK_ACCOUNT_NOT_FOUND')
      if (!account.clientId || !account.certificatePem) {
        return fail(reply, 400, 'BANK_ACCOUNT_SETUP_INCOMPLETE', { message: tr('errors.reconciliation.configureFirst') })
      }
      return { success: true, data: { url: buildAuthorizeUrl(account.clientId, account.id) } }
    },
  )

  // Pasul 2: codul din redirect e schimbat pe token-uri (criptate în DB).
  server.post(
    '/api/reconciliation/accounts/:id/exchange-code',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: RevolutExchangeCodeSchema } },
    async (req, reply) => {
      try {
        const account = await service.exchangeRevolutCode(req.params.id, req.body.code)
        return { success: true, data: account }
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'Revolut code exchange failed')
        return fail(reply, 502, 'BANK_UNAVAILABLE')
      }
    },
  )

  // ── Tranzacții + matching ──────────────────────────────────────────────────

  server.get(
    '/api/reconciliation/transactions',
    { preHandler: [app.authenticate], schema: { querystring: TransactionsQuerySchema } },
    async (req) => {
      return { success: true, data: await service.listTransactions(req.query) }
    },
  )

  server.get('/api/reconciliation/open-invoices', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listOpenInvoices() }
  })

  server.post(
    '/api/reconciliation/transactions/:id/match',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: MatchCreateSchema } },
    async (req, reply) => {
      try {
        const match = await service.createManualMatch(req.params.id, req.body.financialRecordId)
        return reply.code(201).send({ success: true, data: match })
      } catch (err) {
        if (err instanceof PaymentError) return fail(reply, err.statusCode, err.code, { message: err.message })
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'manual match failed')
        return fail(reply, 400, 'MATCH_CREATE_FAILED')
      }
    },
  )

  server.delete(
    '/api/reconciliation/transactions/:id/match',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const removed = await service.removeMatch(req.params.id)
      if (!removed) return fail(reply, 404, 'PAYMENT_MATCH_NOT_FOUND')
      return { success: true }
    },
  )

  // ── Sprint C, Track B — extindere abonament vanagreen ─────────────────────

  server.post(
    '/api/reconciliation/invoices/:id/mark-paid',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const data = await service.markInvoicePaidManually(req.params.id)
        return { success: true, data }
      } catch (err) {
        if (err instanceof PaymentError) return fail(reply, err.statusCode, err.code, { message: err.message })
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'mark invoice paid failed')
        return fail(reply, 400, 'MARK_PAID_FAILED')
      }
    },
  )

  server.get('/api/reconciliation/vanagreen-settings', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getVanagreenSettings() }
  })

  server.put(
    '/api/reconciliation/vanagreen-settings',
    { preHandler: [app.authenticate], schema: { body: VanagreenSettingsUpdateSchema } },
    async (req) => {
      const data = await service.updateVanagreenSettings(req.body.autoExtendEnabled)
      return { success: true, data }
    },
  )

  server.get('/api/reconciliation/vanagreen-extension-log', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listVanagreenExtensionLog() }
  })

  // Pt. UI-ul de mapare billing_client ↔ tenant vanagreen (sugestie + confirmare).
  server.get('/api/reconciliation/vanagreen-tenants', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listVanagreenTenants() }
  })

  server.post(
    '/api/reconciliation/vanagreen-tenants/verify',
    { preHandler: [app.authenticate], schema: { body: VerifyVanagreenTenantSchema } },
    async (req) => {
      return { success: true, data: await service.checkVanagreenTenant(req.body.tenantId) }
    },
  )
}
