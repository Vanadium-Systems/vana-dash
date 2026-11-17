import type { FastifyInstance } from 'fastify'
import { passwordConfirmRequired } from '../../shared/lib/sessions.js'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { AccessError } from '../access/service.js'
import { InviteMemberSchema, MemberMailboxesSchema, UpdateMemberSchema } from '../access/schema.js'
import {
  deleteMember,
  getMemberMailboxes,
  inviteMember,
  listMembers,
  resendInvite,
  sendPasswordReset,
  setMemberMailboxes,
  updateMember,
} from './service.js'
import { fail } from '../../shared/lib/http-error.js'

export async function teamRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof AccessError) {
      return fail(reply, error.status, error.code, { message: error.message })
    }
    throw error
  })

  // `self`: orice user activ vede cine e în echipă, ca să îi scrie cuiva din Mesaje.
  server.get('/api/team/members', { preHandler: [app.authenticate] }, async () => ({
    success: true,
    data: await listMembers(),
  }))

  server.post('/api/team/members', { preHandler: [app.authenticate], schema: { body: InviteMemberSchema } }, async (req, reply) => {
    const created = await inviteMember(req.me, req.body)
    return reply.code(201).send({ success: true, data: created })
  })

  server.patch('/api/team/members/:id', { preHandler: [app.authenticate], schema: { body: UpdateMemberSchema } }, async (req, reply) => {
    // Changing someone's role or status is the kind of action an unattended open session must not do.
    const sensitive = req.body.roleId !== undefined || req.body.status !== undefined
    if (sensitive && passwordConfirmRequired(req.session)) return fail(reply, 403, 'PASSWORD_CONFIRM_REQUIRED')
    return { success: true, data: await updateMember(req.me, (req.params as { id: string }).id, req.body) }
  })

  server.delete('/api/team/members/:id', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await deleteMember(req.me, (req.params as { id: string }).id),
  }))

  server.post('/api/team/members/:id/resend-invite', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await resendInvite(req.me, (req.params as { id: string }).id),
  }))

  server.post('/api/team/members/:id/reset-password', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await sendPasswordReset(req.me, (req.params as { id: string }).id),
  }))

  server.get('/api/team/members/:id/mailboxes', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: await getMemberMailboxes((req.params as { id: string }).id),
  }))

  // Cutiile de email cer `email.cutii` (nu doar echipa.administrare) — vezi features.ts.
  server.put(
    '/api/team/members/:id/mailboxes',
    { preHandler: [app.authenticate], schema: { body: MemberMailboxesSchema } },
    async (req) => ({
      success: true,
      data: await setMemberMailboxes(req.me, (req.params as { id: string }).id, req.body.identityKeys),
    }),
  )
}
