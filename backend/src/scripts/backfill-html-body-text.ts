import { and, eq, isNull, sql } from 'drizzle-orm'
import { htmlToPlainText } from '../modules/email/html-to-text.js'
import { db, sql as pgSql } from '../shared/db/client.js'
import { emailMessages } from '../shared/db/schema/index.js'

// Rulare UNICĂ — repară mesaje deja ingerate ÎNAINTE de fix-ul din ingestCloudflareInboundEmail
// (2026-07-18): expeditoare care trimit DOAR text/html (ANAF SPV confirmat) ajunseseră cu
// HTML brut stocat în bodyText, vizibil cu tag-uri în UI. Idempotent, safe de rerun — doar
// rânduri care încă arată ca HTML brut sunt atinse.

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const rows = await db
    .select({ id: emailMessages.id, bodyText: emailMessages.bodyText })
    .from(emailMessages)
    .where(
      and(
        isNull(emailMessages.deletedAt),
        sql`${emailMessages.bodyText} IS NOT NULL AND ${emailMessages.bodyText} ~* '<(html|body|p|br|div)[ >]'`,
      ),
    )

  console.log(`[backfill-html] ${rows.length} mesaj(e) cu HTML brut găsite${dryRun ? ' (DRY RUN)' : ''}`)

  let updated = 0
  for (const row of rows) {
    const converted = htmlToPlainText(row.bodyText!)
    if (!converted || converted === row.bodyText) continue

    console.log(`[backfill-html] ${dryRun ? 'AR ACTUALIZA' : 'actualizez'} ${row.id}: "${converted.slice(0, 60).replace(/\n/g, ' ')}..."`)
    if (!dryRun) {
      await db.update(emailMessages).set({ bodyText: converted, updatedAt: new Date() }).where(eq(emailMessages.id, row.id))
    }
    updated++
  }

  console.log(`[backfill-html] gata — ${dryRun ? 'ar actualiza' : 'actualizate'}: ${updated}, total găsite: ${rows.length}`)
}

main()
  .catch((err) => {
    console.error('[backfill-html] eșuat:', err)
    process.exitCode = 1
  })
  .finally(() => pgSql.end())
