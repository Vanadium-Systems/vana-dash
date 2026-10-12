import type { Readable } from 'node:stream'
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '../config.js'

// Cloudflare R2 (S3-compatible) — modul Arhivă. Credențiale globale, un singur bucket
// (pattern identic anafClientId/anafClientSecret în config.ts). Client lazy — nu aruncă
// la boot dacă R2 nu e încă configurat, doar la prima folosire reală (fail-closed pe uz,
// nu pe pornirea serverului, ca restul integrărilor opționale din acest proiect).

let client: S3Client | undefined

function r2Client(): S3Client {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = config.r2
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      'R2 neconfigurat — completează R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME în .env',
    )
  }
  if (!client) {
    client = new S3Client({
      region: 'auto',
      // The bucket is created under the EU jurisdiction, which needs the jurisdictional
      // endpoint (`eu.`); otherwise R2 answers AccessDenied although the credentials are right.
      endpoint: `https://${accountId}.eu.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return client
}

/** Upload streamed (multipart automat pt. fișiere mari via @aws-sdk/lib-storage). */
export async function uploadToR2(key: string, body: Readable, contentType: string): Promise<void> {
  const upload = new Upload({
    client: r2Client(),
    params: { Bucket: config.r2.bucketName, Key: key, Body: body, ContentType: contentType },
  })
  await upload.done()
}

/** Descarcă un obiect R2 direct în memorie — pt. procesare server-side (ex: pachetul trimestrial,
 * care re-împachetează fișiere deja arhivate într-un zip nou). Fișiere mici/medii (facturi PDF/XML),
 * nu pt. volume mari — pt. download client direct, folosește `getPresignedDownloadUrl`. */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const res = await r2Client().send(new GetObjectCommand({ Bucket: config.r2.bucketName, Key: key }))
  const chunks: Buffer[] = []
  for await (const chunk of res.Body as Readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** URL presemnat pt. download direct client→R2 (nu trece prin VPS). TTL implicit 15 min.
 * responseContentDisposition — opțional, ex. `attachment; filename="x.pdf"` ca browserul să
 * salveze cu numele din Arhivă, nu cu cheia R2 (folosit doar la descărcări, nu și la preview-uri
 * inline — acolo header-ul ar strica randarea în <img>/<viewer>). */
export async function getPresignedDownloadUrl(
  key: string,
  ttlSeconds = 900,
  responseContentDisposition?: string,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
    ...(responseContentDisposition ? { ResponseContentDisposition: responseContentDisposition } : {}),
  })
  return getSignedUrl(r2Client(), command, { expiresIn: ttlSeconds })
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client().send(new DeleteObjectCommand({ Bucket: config.r2.bucketName, Key: key }))
}
