import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { api } from '@/shared/lib/api'
import { getLocale, t } from '@/shared/lib/i18n'
import { getTenantOverride } from '@/shared/lib/tenant-override'
import type { VoiceNote } from '../types'

export const MAX_VOICE_BYTES = 25 * 1024 * 1024
export const MAX_VOICE_SECONDS = 15 * 60
export const WARN_VOICE_SECONDS = 14 * 60

export const voiceAudioUrl = (prospectId: string, voiceId: string) => `/api/prospects/${prospectId}/voice-notes/${voiceId}/audio`

export function useVoiceNotes(prospectId: string) {
  return useQuery({ queryKey: ['prospects', 'voice-notes', prospectId], queryFn: () => api.get<VoiceNote[]>(`/api/prospects/${prospectId}/voice-notes`) })
}

export class VoiceUploadError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
  }
}

// The server only says the storage is off when a note is posted, so the first 503 hides the controls
// for the rest of the session.
let storageOff = false
const listeners = new Set<() => void>()
function markStorageOff() {
  if (storageOff) return
  storageOff = true
  listeners.forEach((listener) => listener())
}
export function useVoiceStorageOff() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    () => storageOff,
  )
}

function failureOf(xhr: XMLHttpRequest): VoiceUploadError {
  type ErrorBody = { error?: unknown; code?: string }
  let body = null as ErrorBody | null
  try {
    body = JSON.parse(xhr.responseText) as ErrorBody
  } catch {
    // Not JSON: a proxy page. The status decides.
  }
  const nested = body?.error && typeof body.error === 'object' ? (body.error as { code?: string; message?: string }) : null
  const code = body?.code ?? nested?.code
  const message = (typeof body?.error === 'string' && body.error) || nested?.message || t('common:errors.api.generic', { status: xhr.status })
  return new VoiceUploadError(message, xhr.status, code)
}

export interface VoiceUploadInput {
  file: Blob
  fileName: string
  durationSeconds: number
  caption?: string
  taskId?: string
}

/** XHR because `fetch` has no upload progress; sets what `api.ts` sets (cookie, language, company override). */
export function uploadVoiceNote(prospectId: string, input: VoiceUploadInput, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<VoiceNote> {
  return new Promise((resolve, reject) => {
    const body = new FormData()
    // The server reads the fields before the file, so the file part goes last.
    body.append('durationSeconds', String(Math.round(input.durationSeconds)))
    if (input.caption) body.append('caption', input.caption)
    if (input.taskId) body.append('taskId', input.taskId)
    body.append('file', input.file, input.fileName)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/prospects/${prospectId}/voice-notes`)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-Locale', getLocale())
    const tenant = getTenantOverride()
    if (tenant) xhr.setRequestHeader('X-Tenant-Id', tenant.id)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((JSON.parse(xhr.responseText) as { data: VoiceNote }).data)
        return
      }
      const failure = failureOf(xhr)
      if (failure.code === 'VOICE_STORAGE_OFF') markStorageOff()
      reject(failure)
    }
    xhr.onerror = () => reject(new VoiceUploadError(t('common:errors.api.network'), 0))
    signal?.addEventListener('abort', () => {
      xhr.abort()
      reject(new VoiceUploadError('aborted', 0, 'ABORTED'))
    })
    xhr.send(body)
  })
}
