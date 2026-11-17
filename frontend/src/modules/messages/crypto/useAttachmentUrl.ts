import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ResolvedAttachment } from './E2EProvider'
import { downloadDecrypted } from './files'

/**
 * Where an <img> / <video> / the viewer reads an attachment from. Old clear attachments keep their
 * server URL; an encrypted one is fetched, decrypted and shown from a blob: URL, which is released
 * when the component goes. Null while it is not ready (no key yet, or still decrypting).
 */
export function useAttachmentUrl(attachment: ResolvedAttachment | null, size: 'original' | 'thumb', enabled = true): string | null {
  const key = attachment?.key
  const query = useQuery({
    queryKey: ['chat', 'file', attachment?.id, size],
    enabled: Boolean(enabled && attachment?.encrypted && key),
    staleTime: Infinity,
    // Decrypted photos stay in memory a short while only; scrolling back re-fetches them.
    gcTime: 2 * 60_000,
    queryFn: () => downloadDecrypted(key!, size),
  })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!query.data) return
    const objectUrl = URL.createObjectURL(query.data)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [query.data])

  if (!attachment) return null
  if (!attachment.encrypted) return `/api/chat/attachments/${attachment.id}${size === 'thumb' ? '?size=thumb' : ''}`
  return url
}
