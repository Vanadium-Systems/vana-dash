import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Mesaje SPV salvate explicit de Stefan (buton „Salvează" din tab-ul Mesaje) — opt-in, NU
// toate mesajele. ANAF își șterge mesajele din SPV după un timp; ce salvăm aici rămâne
// permanent, indiferent ce face ANAF la ei. Facturile (primite/emise) au propriul pipeline
// în financial_records — tabela asta e doar pt. mesaje generice (ex: MESAJ CUMPARATOR, ERORI).
export const spvMessages = pgTable(
  'spv_messages',
  {
    ...tenantColumns,
    ...standardColumns,
    anafMessageId: text('anaf_message_id').notNull(),
    type: text('type').notNull(),
    detail: text('detail').notNull(),
    cif: text('cif').notNull(),
    anafCreatedAt: timestamp('anaf_created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('uq_spv_messages_anaf_message_id').on(t.anafMessageId)],
)
