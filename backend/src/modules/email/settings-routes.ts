import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { EmailSettingsUpdateSchema, LogoUploadSchema } from './settings-schema.js'
import * as settings from './settings-service.js'
import { tr } from '../../shared/lib/i18n.js'

export async function emailSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/email/settings', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await settings.getEmailSettings() }
  })

  server.put(
    '/api/email/settings',
    { preHandler: [app.authenticate], schema: { body: EmailSettingsUpdateSchema } },
    async (req) => {
      return { success: true, data: await settings.updateEmailSettings(req.body) }
    },
  )

  server.post(
    '/api/email/settings/logo',
    { preHandler: [app.authenticate], schema: { body: LogoUploadSchema } },
    async (req, reply) => {
      try {
        await settings.uploadLogo(req.body)
      } catch (err) {
        if (err instanceof settings.LogoTypeError) return reply.code(400).send({ success: false, error: err.message })
        throw err
      }
      return reply.code(201).send({ success: true })
    },
  )

  // Public on purpose: the logo sits in an <img> of emails read by people who have no session.
  // No path parameter, so it only ever serves the current logo. The sandbox policy is for the
  // SVG case: opened directly in a tab, an SVG is a document on this origin and could run script.
  server.get('/api/email/settings/logo', async (_req, reply) => {
    const logo = await settings.getLogoFile()
    if (!logo) return reply.code(404).send({ success: false, error: tr('errors.email.logoNotConfigured') })
    return reply.header('Content-Security-Policy', "sandbox; default-src 'none'").type(logo.contentType).send(logo.buffer)
  })
}
