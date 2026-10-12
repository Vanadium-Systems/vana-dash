import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { and, eq, isNull } from 'drizzle-orm'
import { db, sql as pgSql } from '../shared/db/client.js'
import { archiveFiles } from '../shared/db/schema/index.js'
import { downloadFromR2, uploadToR2 } from '../shared/lib/r2.js'
import { generatePdfThumbnail } from '../shared/lib/thumbnail.js'

// Rulare UNICĂ — regenerează thumbnailR2Key pt. PDF-urile din Arhivă încărcate ÎNAINTE de
// sprintul care a adăugat generatePdfThumbnail() la upload (modules/archive/service.ts
// uploadFile). Idempotent, safe de rerun — atinge STRICT rânduri cu thumbnailR2Key NULL,
// deci un fișier deja procesat nu e reprocesat la o rulare ulterioară.

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const rows = await db
    .select({ id: archiveFiles.id, name: archiveFiles.name, r2Key: archiveFiles.r2Key })
    .from(archiveFiles)
    .where(and(isNull(archiveFiles.deletedAt), eq(archiveFiles.mimeType, 'application/pdf'), isNull(archiveFiles.thumbnailR2Key)))

  console.log(`[backfill-archive-thumbnails] ${rows.length} PDF-uri fără thumbnail găsite${dryRun ? ' (DRY RUN)' : ''}`)

  let generated = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    try {
      const buffer = await downloadFromR2(row.r2Key)
      const thumbnail = await generatePdfThumbnail(buffer)
      if (!thumbnail) {
        console.log(`[backfill-archive-thumbnails] "${row.name}" (${row.id}) — pdftoppm nu a produs thumbnail, sărit`)
        skipped++
        continue
      }

      console.log(`[backfill-archive-thumbnails] ${dryRun ? 'AR GENERA' : 'generez'} thumbnail pt. "${row.name}" (${row.id})`)
      if (!dryRun) {
        const thumbKey = `archive/thumbnails/${randomUUID()}.jpg`
        await uploadToR2(thumbKey, Readable.from(thumbnail), 'image/jpeg')
        await db.update(archiveFiles).set({ thumbnailR2Key: thumbKey, updatedAt: new Date() }).where(eq(archiveFiles.id, row.id))
      }
      generated++
    } catch (err) {
      console.error(`[backfill-archive-thumbnails] "${row.name}" (${row.id}) eșuat: ${String(err)}`)
      failed++
    }
  }

  console.log(
    `[backfill-archive-thumbnails] gata — ${dryRun ? 'ar genera' : 'generate'}: ${generated}, fără thumbnail posibil: ${skipped}, eșuate: ${failed}, total procesate: ${rows.length}`,
  )
}

main()
  .catch((err) => {
    console.error('[backfill-archive-thumbnails] eșuat:', err)
    process.exitCode = 1
  })
  .finally(() => pgSql.end())
