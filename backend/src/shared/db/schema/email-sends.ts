import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { emailSequenceEnrollments } from './email-sequences.js'
import { emailTemplates } from './email-templates.js'
import { users } from './users.js'

// Istoric trimiteri (1:1 și bulk) — sursă de adevăr pentru dedup la bulk send.
export const emailSends = pgTable(
  'email_sends',
  {
    ...standardColumns,
    // nullable — compose liber fără template
    templateId: uuid('template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
    recipient: text('recipient').notNull(),
    // adresa "From" folosită efectiv (stefan@ sau contact@) — nullable, rândurile
    // vechi (înainte de multi-from) nu au de unde s-o știe retroactiv.
    fromAddress: text('from_address'),
    subject: text('subject').notNull(),
    // Corpul efectiv trimis (text + html, cu semnătură/footer deja incluse) — nullable,
    // rândurile vechi (dinainte de acest câmp) rămân fără conținut vizibil, doar metadate.
    // Fără asta, tab-ul „Trimise" nu avea NICIUN mod de a arăta ce s-a trimis efectiv
    // (bug raportat de Stefan — doar status/subiect/destinatar, fără conținut).
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    // 'sent' = acceptat de Resend la submit; restul vin din webhook-ul de status
    // livrare (email.delivered/bounced/complained/delivery_delayed) — 'failed' rămâne
    // strict pt. eșec la submit (Resend jos/API key greșit etc.), nu pt. bounce.
    status: text('status', { enum: ['sent', 'delivered', 'bounced', 'complained', 'delayed', 'failed'] }).notNull(),
    errorMessage: text('error_message'),
    // id-ul Resend al emailului — cheie de match pt. webhook-ul de status livrare.
    // nullable: rândurile 'failed' la submit n-au primit niciodată un id de la Resend.
    resendEmailId: text('resend_email_id'),
    // grupare pentru un bulk send — nullable, null pentru compose 1:1
    batchId: uuid('batch_id'),
    // Engagement (webhook Resend email.opened/email.clicked, 2026-08-11 — Stefan vrea să vadă
    // CINE deschide/dă click, nu doar un status de livrare). Doar agregat (open_count/click_count),
    // nu un log per-eveniment — suficient pt. un rating pe send, no bloat. Idempotent la
    // evenimente duplicate (Svix poate retrimite) — count-urile doar cresc, openedAt/clickedAt
    // rămân la PRIMA apariție (COALESCE la update, nu suprascrise).
    openedAt: timestamp('opened_at', { withTimezone: true }),
    openCount: integer('open_count').notNull().default(0),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    clickCount: integer('click_count').notNull().default(0),
    lastClickedUrl: text('last_clicked_url'),
    // 2026-08-12 — leagă un rând de send înapoi de pasul din secvență care l-a generat (nullable,
    // null pt. Compose 1:1/bulk ad-hoc, care nu trec printr-o secvență).
    sequenceEnrollmentId: uuid('sequence_enrollment_id').references(() => emailSequenceEnrollments.id, { onDelete: 'set null' }),
    // Cine a trimis (PLAN.md C2): aceeași cutie poate fi la doi oameni, deci adresa nu spune.
    sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // dedup lookup la bulk send: (recipient, templateId) deja trimis?
    index('idx_email_sends_recipient_template').on(t.recipient, t.templateId),
    // lookup la webhook-ul de status livrare, pe email_id
    index('idx_email_sends_resend_email_id').on(t.resendEmailId),
  ],
)
