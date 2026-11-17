import { useEffect } from 'react'
import { ApiError, api } from '@/shared/lib/api'
import type { ChatMessage } from '@/shared/lib/types'
import { useE2E } from './E2EProvider'

// Messages from before part M are clear text on the server. When a thread shows them, this
// device encrypts them in place (Q-M2); the server clears the clear text a week later. The
// author does it for their own messages; for someone with no approved device left (a colleague
// who left), any member may, and the server refuses the rest.

const tried = new Set<string>()
/** Authors the server said someone else may not re-encrypt for: not asked again this session. */
const notMine = new Set<string>()

export function useLegacyReencryption(conversationId: string, memberIds: string[], messages: ChatMessage[], meId: string): void {
  const { engine, status } = useE2E()
  useEffect(() => {
    if (!engine || status !== 'ready') return
    const legacy = messages.filter(
      (m) => !m.encrypted && !m.deletedAt && m.body !== '' && !tried.has(m.id) && (m.authorUserId === meId || !notMine.has(m.authorUserId)),
    )
    if (legacy.length === 0) return
    for (const message of legacy) tried.add(message.id)
    void (async () => {
      // One at a time, in the background: an old conversation may have hundreds.
      for (const message of legacy) {
        if (message.authorUserId !== meId && notMine.has(message.authorUserId)) continue
        try {
          const encrypted = await engine.encrypt(conversationId, memberIds, {
            body: message.body,
            attachments: [],
            ...(message.authorUserId === meId ? {} : { legacy: true as const }),
          })
          await api.post(`/api/chat/messages/${message.id}/encrypt`, { encrypted })
        } catch (err) {
          if (err instanceof ApiError && err.status === 400 && message.authorUserId !== meId) notMine.add(message.authorUserId)
        }
      }
    })()
  }, [conversationId, engine, meId, memberIds, messages, status])
}
