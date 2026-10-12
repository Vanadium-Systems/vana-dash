import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { auditColumns } from './users.js'
import { archiveFolders } from './archive-folders.js'

// Metadate fișiere din Arhivă. Conținutul NU stă în Postgres — merge pe Cloudflare R2,
// aici păstrăm doar cheia obiectului (r2Key). restrict pe folderId: nu poți șterge un
// folder care mai conține fișiere.
//
// `folder_id` e NOT NULL de la migrarea 0065 (era nullable când Arhiva era un singur spațiu
// comun, cu fișiere „la rădăcină"): cu spații per om, un fișier fără folder n-ar mai aparține
// nimănui, deci n-ar avea cine să-l vadă. Fișierele de la rădăcină au fost mutate în folderul
// rădăcină al lui Stefan, iar upload-ul fără folderId (share target din APK) intră în spațiul
// omului — deci valoarea null nu mai apare pe nicio cale de scriere.
export const archiveFiles = pgTable(
  'archive_files',
  {
    ...standardColumns,
    ...auditColumns,
    folderId: uuid('folder_id')
      .notNull()
      .references(() => archiveFolders.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    r2Key: text('r2_key').notNull(),
    // Randat best-effort la upload pt. PDF-uri (shared/lib/thumbnail.ts, pdftoppm pe pagina 1).
    // null dacă poppler-utils lipsește sau PDF-ul e corupt/criptat — nu blochează upload-ul.
    thumbnailR2Key: text('thumbnail_r2_key'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex('uq_archive_files_r2_key').on(t.r2Key),
    index('idx_archive_files_folder').on(t.folderId),
    index('idx_archive_files_tags').using('gin', t.tags),
  ],
)
