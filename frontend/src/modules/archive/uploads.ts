import { useSyncExternalStore } from 'react'
import { getLocale, t } from '@/shared/lib/i18n'
import { getTenantOverride } from '@/shared/lib/tenant-override'

// The upload queue lives outside React so a transfer keeps going when the person opens another
// folder, and the panel can come back to a finished batch. `fetch` has no upload progress, so this
// is XHR; it sets what `api.ts` sets (session cookie, language, company override).

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled'

export type UploadFailure =
  | { reason: 'storageFull'; usedBytes: number; limitBytes: number }
  | { reason: 'tooLarge' }
  | { reason: 'other'; message: string }

export interface UploadItem {
  id: number
  name: string
  size: number
  folderId: string | null
  /** For the "Upload to «Contracts»" wording; the folder may have been left by the time it ends. */
  folderName: string
  status: UploadStatus
  loaded: number
  failure: UploadFailure | null
}

const MAX_PARALLEL = 3
const UPLOAD_URL = '/api/archive/files'

let items: UploadItem[] = []
let nextId = 0
const sources = new Map<number, File>()
const requests = new Map<number, XMLHttpRequest>()
const listeners = new Set<() => void>()

function publish(next: UploadItem[]) {
  items = next
  listeners.forEach((listener) => listener())
}

function patch(id: number, changes: Partial<UploadItem>) {
  publish(items.map((item) => (item.id === id ? { ...item, ...changes } : item)))
}

function failureOf(xhr: XMLHttpRequest): UploadFailure {
  type ErrorBody = { error?: unknown; code?: string; usedBytes?: number; limitBytes?: number }
  let body = null as ErrorBody | null
  try {
    body = JSON.parse(xhr.responseText) as ErrorBody
  } catch {
    // Not JSON: a proxy page. The status decides.
  }
  if (xhr.status === 413 && body?.code === 'STORAGE_FULL') {
    return { reason: 'storageFull', usedBytes: body.usedBytes ?? 0, limitBytes: body.limitBytes ?? 0 }
  }
  if (xhr.status === 413) return { reason: 'tooLarge' }
  const message = typeof body?.error === 'string' && body.error ? body.error : t('common:errors.api.generic', { status: xhr.status })
  return { reason: 'other', message }
}

function start(item: UploadItem) {
  const file = sources.get(item.id)
  if (!file) return
  const body = new FormData()
  // The server reads the multipart stream in order: folderId has to come before the file.
  if (item.folderId) body.append('folderId', item.folderId)
  body.append('file', file)

  const xhr = new XMLHttpRequest()
  requests.set(item.id, xhr)
  xhr.open('POST', UPLOAD_URL)
  xhr.withCredentials = true
  xhr.setRequestHeader('X-Locale', getLocale())
  const tenant = getTenantOverride()
  if (tenant) xhr.setRequestHeader('X-Tenant-Id', tenant.id)

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) patch(item.id, { loaded: Math.min(e.loaded, item.size) })
  }
  xhr.onload = () => {
    requests.delete(item.id)
    if (xhr.status >= 200 && xhr.status < 300) patch(item.id, { status: 'done', loaded: item.size, failure: null })
    else patch(item.id, { status: 'error', failure: failureOf(xhr) })
    pump()
  }
  xhr.onerror = () => {
    requests.delete(item.id)
    patch(item.id, { status: 'error', failure: { reason: 'other', message: t('common:errors.api.network') } })
    pump()
  }
  patch(item.id, { status: 'uploading', loaded: 0, failure: null })
  xhr.send(body)
}

function pump() {
  let running = items.filter((item) => item.status === 'uploading').length
  for (const item of items) {
    if (running >= MAX_PARALLEL) return
    if (item.status === 'queued') {
      start(item)
      running++
    }
  }
}

export function enqueueUploads(files: File[], target: { folderId: string | null; folderName: string }) {
  const added = files.map<UploadItem>((file) => {
    const id = ++nextId
    sources.set(id, file)
    return { id, name: file.name, size: file.size, folderId: target.folderId, folderName: target.folderName, status: 'queued', loaded: 0, failure: null }
  })
  publish([...items, ...added])
  pump()
}

export function cancelUpload(id: number) {
  const xhr = requests.get(id)
  requests.delete(id)
  xhr?.abort()
  patch(id, { status: 'canceled' })
  pump()
}

export function retryUpload(id: number) {
  patch(id, { status: 'queued', loaded: 0, failure: null })
  pump()
}

/** Drops what is over (done, failed, canceled); transfers still going stay. */
export function clearFinishedUploads() {
  const keep = items.filter((item) => item.status === 'queued' || item.status === 'uploading')
  for (const item of items) if (!keep.includes(item)) sources.delete(item.id)
  publish(keep)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useUploads(): UploadItem[] {
  return useSyncExternalStore(subscribe, () => items)
}

/** Tests only: a clean queue between cases. */
export function resetUploads() {
  for (const xhr of requests.values()) xhr.abort()
  requests.clear()
  sources.clear()
  publish([])
}
