import { t } from '@/shared/lib/i18n'
// Encodare fișiere → base64 pt. atașamente email (modules/email) — API-ul trimite
// JSON, nu multipart, deci fișierul intră ca string base64 în body.

export interface PendingAttachment {
  filename: string
  content: string // base64
}

export function readFileAsBase64(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const base64 = result.slice(result.indexOf(',') + 1)
      resolve({ filename: file.name, content: base64 })
    }
    reader.onerror = () => reject(reader.error ?? new Error(t('common:errors.attachments.readFailed', { name: file.name })))
    reader.readAsDataURL(file)
  })
}

// Attaching from the Archive (compose/ComposeForm): the file is already in storage; it is fetched
// into the browser and re-encoded as base64, so it travels like an upload from disk. The email and
// archive modules stay apart (rule #5): no cross-module import on the backend.
//
// 2026-08-11 (bug Stefan, "network error" la atașare) — NU mai folosește URL-ul presemnat R2
// direct (`/api/archive/files/:id/download-url`): Cloudflare R2 nu aplică politica CORS a
// bucket-ului pe endpoint-ul S3 folosit de URL-urile presemnate (confirmat direct — GET cu
// header Origin, zero `Access-Control-Allow-Origin` în răspuns), deci fetch()-ul din browser
// era blocat de CORS. `url` e acum ruta same-origin de streaming prin backend-ul nostru
// (`/api/archive/files/:id/download`, archive/routes.ts) — `credentials: 'include'` obligatoriu,
// ruta cere sesiune (authenticate).
export async function fileFromUrl(url: string, filename: string): Promise<PendingAttachment> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(t('common:errors.attachments.downloadFailed', { filename }))
  const blob = await res.blob()
  return readFileAsBase64(new File([blob], filename))
}
