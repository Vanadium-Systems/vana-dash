import { api } from '@/shared/lib/api'
import type { KeysApi } from './engine'

/** The engine's view of /api/chat/keys (backend/src/modules/chat/keys-routes.ts). */
export const keysApi: KeysApi = {
  me: (deviceId) => api.get(`/api/chat/keys/me${deviceId ? `?deviceId=${deviceId}` : ''}`),
  registerDevice: (body) => api.post('/api/chat/keys/devices', body),
  uploadKeys: async (deviceId, body) => {
    await api.post(`/api/chat/keys/devices/${deviceId}/keys`, body)
  },
  putIdentity: async (body) => {
    await api.put('/api/chat/keys/identity', body)
  },
  signDevice: async (deviceId, signature) => {
    await api.post(`/api/chat/keys/devices/${deviceId}/signature`, { signature })
  },
  devicesOf: (userIds) => api.get(`/api/chat/keys/devices?userIds=${userIds.join(',')}`),
  claim: (deviceIds) => api.post('/api/chat/keys/claim', { deviceIds }),
  sendToDevice: async (senderDeviceId, messages) => {
    // The server takes 500 per request; a big group with many devices sends in several.
    for (let i = 0; i < messages.length; i += 500) {
      await api.post('/api/chat/keys/to-device', { senderDeviceId, messages: messages.slice(i, i + 500) })
    }
  },
  pendingToDevice: (deviceId) => api.get(`/api/chat/keys/to-device?deviceId=${deviceId}`),
  ackToDevice: async (deviceId, upToId) => {
    await api.post('/api/chat/keys/to-device/ack', { deviceId, upToId })
  },
  putBackup: async (sessions) => {
    for (let i = 0; i < sessions.length; i += 200) {
      await api.put('/api/chat/keys/backup', { sessions: sessions.slice(i, i + 200) })
    }
  },
  readBackup: (after) => api.get(`/api/chat/keys/backup?after=${after}`),
}
