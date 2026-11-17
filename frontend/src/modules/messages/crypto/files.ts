import { api } from '@/shared/lib/api'
import type { AttachmentKey } from './engine'
import { decryptBytes, encryptBytes } from './primitives'

// Attachments are encrypted in the browser before upload (PLAN.md part M): the server and R2 keep
// only ciphertext. The key of each file travels inside the message, never next to the file.

const THUMBNAIL_MAX = 480

/**
 * A WebP thumbnail of at most 480 px, made here because the server can no longer see the image
 * (BE-M9). Also returns the original's size, so the bubble keeps its place while loading.
 */
async function thumbnailOf(file: Blob): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof createImageBitmap === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, THUMBNAIL_MAX / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const { width, height } = bitmap
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8))
    return blob ? { blob, width, height } : null
  } catch {
    // A format the browser cannot decode (it still uploads, without a preview).
    return null
  }
}

// GIF keeps its animation only as the original; a still thumbnail would freeze it.
const THUMBNAIL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function uploadEncrypted(file: File): Promise<AttachmentKey> {
  const isImage = file.type.startsWith('image/')
  const encrypted = await encryptBytes(await file.arrayBuffer())
  const thumbnail = THUMBNAIL_TYPES.has(file.type) ? await thumbnailOf(file) : null
  const encryptedThumb = thumbnail ? await encryptBytes(await thumbnail.blob.arrayBuffer()) : null

  const form = new FormData()
  // Fields before files: the server reads the parts in order.
  form.append('encrypted', '1')
  form.append('kind', isImage ? 'image' : 'file')
  form.append('file', new Blob([encrypted.data as Uint8Array<ArrayBuffer>]), 'encrypted')
  if (encryptedThumb) form.append('thumbnail', new Blob([encryptedThumb.data as Uint8Array<ArrayBuffer>]), 'encrypted')
  const stored = await api.upload<{ id: string }>('/api/chat/attachments', form)

  return {
    id: stored.id,
    key: encrypted.key,
    iv: encrypted.iv,
    sha256: encrypted.sha256,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    ...(thumbnail ? { width: thumbnail.width, height: thumbnail.height } : {}),
    ...(encryptedThumb ? { thumb: { key: encryptedThumb.key, iv: encryptedThumb.iv, sha256: encryptedThumb.sha256 } } : {}),
  }
}

/** The decrypted file (or its thumbnail) as a Blob of its real type. */
export async function downloadDecrypted(key: AttachmentKey, size: 'original' | 'thumb' = 'original'): Promise<Blob> {
  const useThumb = size === 'thumb' && key.thumb
  const { blob: encrypted } = await api.getBlob(`/api/chat/attachments/${key.id}${useThumb ? '?size=thumb' : ''}`)
  const plain = await decryptBytes(await encrypted.arrayBuffer(), useThumb ? key.thumb! : key)
  return new Blob([plain], { type: useThumb ? 'image/webp' : key.type })
}

/** Saves a decrypted file under its real name (in the APK, through the native file plugin). */
export async function saveDecrypted(key: AttachmentKey): Promise<void> {
  await api.saveBlob(await downloadDecrypted(key), key.name)
}
