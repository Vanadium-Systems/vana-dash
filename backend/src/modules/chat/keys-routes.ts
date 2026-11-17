import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { tr } from '../../shared/lib/i18n.js'
import * as keys from './keys.js'
import { publish } from './presence.js'
import { conversationPartnerIds } from './service.js'
import {
  AckToDeviceSchema,
  BackupQuerySchema,
  ClaimKeysSchema,
  DeviceParamsSchema,
  DevicesQuerySchema,
  IdentitySchema,
  MyKeysQuerySchema,
  PendingToDeviceQuerySchema,
  PutBackupSchema,
  RegisterDeviceSchema,
  SendToDeviceSchema,
  SignDeviceSchema,
  UploadKeysSchema,
} from './schema.js'

// Device keys belong to a browser or the app, never to a personal API token: a token reaching
// these routes could register a "device" and be sent the keys of new messages.
async function cookieOnly(req: FastifyRequest, reply: FastifyReply) {
  if (req.apiToken) return reply.code(403).send({ success: false, error: tr('errors.chat.keysNeedSession') })
}

/** Registered inside chatRoutes, so the module's error handler covers them. */
export function keyRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const preHandler = [app.authenticate, cookieOnly]

  // Colleagues drop their cached copy of this person's devices.
  async function announceDevices(userId: string) {
    publish({ type: 'keys.devices', userId }, [userId, ...(await conversationPartnerIds(userId))])
  }

  server.get('/api/chat/keys/me', { preHandler, schema: { querystring: MyKeysQuerySchema } }, async (req) => ({
    success: true,
    data: await keys.myKeys(req.me.id, req.query.deviceId),
  }))

  server.post('/api/chat/keys/devices', { preHandler, schema: { body: RegisterDeviceSchema } }, async (req, reply) => {
    const device = await keys.registerDevice(req.me.id, req.session?.familyId ?? null, req.body)
    return reply.code(201).send({ success: true, data: device })
  })

  server.get('/api/chat/keys/devices', { preHandler, schema: { querystring: DevicesQuerySchema } }, async (req) => ({
    success: true,
    data: await keys.devicesOf(req.query.userIds),
  }))

  server.post(
    '/api/chat/keys/devices/:deviceId/keys',
    { preHandler, schema: { params: DeviceParamsSchema, body: UploadKeysSchema } },
    async (req) => ({
      success: true,
      data: { oneTimeKeys: await keys.addOneTimeKeys(req.me.id, req.params.deviceId, req.body.oneTimeKeys, req.body.fallbackKey) },
    }),
  )

  server.post(
    '/api/chat/keys/devices/:deviceId/signature',
    { preHandler, schema: { params: DeviceParamsSchema, body: SignDeviceSchema } },
    async (req) => {
      await keys.signDevice(req.me.id, req.params.deviceId, req.body.signature)
      await announceDevices(req.me.id)
      return { success: true }
    },
  )

  server.delete('/api/chat/keys/devices/:deviceId', { preHandler, schema: { params: DeviceParamsSchema } }, async (req) => {
    await keys.revokeDevice(req.me.id, req.params.deviceId)
    await announceDevices(req.me.id)
    return { success: true }
  })

  server.put('/api/chat/keys/identity', { preHandler, schema: { body: IdentitySchema } }, async (req) => {
    await keys.putIdentity(req.me.id, req.body)
    await announceDevices(req.me.id)
    return { success: true }
  })

  server.post('/api/chat/keys/claim', { preHandler, schema: { body: ClaimKeysSchema } }, async (req) => ({
    success: true,
    data: await keys.claimKeys(req.body.deviceIds),
  }))

  server.post('/api/chat/keys/to-device', { preHandler, schema: { body: SendToDeviceSchema } }, async (req) => {
    const recipients = await keys.sendToDevice(req.me.id, req.body.senderDeviceId, req.body.messages)
    if (recipients.length > 0) publish({ type: 'keys.to_device' }, recipients)
    return { success: true }
  })

  server.get('/api/chat/keys/to-device', { preHandler, schema: { querystring: PendingToDeviceQuerySchema } }, async (req) => ({
    success: true,
    data: await keys.pendingToDevice(req.me.id, req.query.deviceId, req.query.limit),
  }))

  server.post('/api/chat/keys/to-device/ack', { preHandler, schema: { body: AckToDeviceSchema } }, async (req) => {
    await keys.ackToDevice(req.me.id, req.body.deviceId, req.body.upToId)
    return { success: true }
  })

  server.put('/api/chat/keys/backup', { preHandler, schema: { body: PutBackupSchema } }, async (req) => {
    await keys.putBackup(req.me.id, req.body.sessions)
    return { success: true }
  })

  server.get('/api/chat/keys/backup', { preHandler, schema: { querystring: BackupQuerySchema } }, async (req) => ({
    success: true,
    data: await keys.readBackup(req.me.id, req.query.after, req.query.limit),
  }))
}
