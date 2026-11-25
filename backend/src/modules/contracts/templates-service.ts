import { and, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { contractTemplates } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { httpError } from '../../shared/lib/http-error.js'
import type { CustomTemplateSchema } from './registry-schema.js'
import { unknownTokens } from './template-render.js'
import { getSeries } from './numbers.js'

// The company's own templates (contract, annex, NDA, collaboration...). None ship with the app:
// every installation writes its own, so no contract text lives in the code.

type TemplateRow = typeof contractTemplates.$inferSelect

export async function listTemplates(): Promise<TemplateRow[]> {
  return db.select().from(contractTemplates).where(isNull(contractTemplates.deletedAt)).orderBy(contractTemplates.name)
}

async function checkCustomTemplate(input: z.infer<typeof CustomTemplateSchema>) {
  const unknown = unknownTokens(input.bodyHtml, input.fields)
  if (unknown.length > 0) throw httpError(400, 'CONTRACT_TEMPLATE_TOKENS_UNKNOWN', { unknown: unknown.join(', ') })
  if (new Set(input.fields.map((f) => f.key)).size !== input.fields.length) throw httpError(400, 'CONTRACT_TEMPLATE_FIELD_DUPLICATE')
  if (input.seriesId) await getSeries(input.seriesId)
}

export async function createCustomTemplate(input: z.infer<typeof CustomTemplateSchema>): Promise<TemplateRow> {
  await checkCustomTemplate(input)
  const [row] = await db.insert(contractTemplates).values(input).returning()
  await recordAudit({ action: 'contract.sablon.creat', entityType: 'contract_template', entityId: row!.id, changes: { nume: [null, input.name] } })
  return row!
}

async function getCustomTemplate(id: string) {
  const [row] = await db
    .select()
    .from(contractTemplates)
    .where(and(eq(contractTemplates.id, id), isNull(contractTemplates.deletedAt)))
  if (!row) throw httpError(404, 'TEMPLATE_NOT_FOUND')
  return row
}

export async function updateCustomTemplate(id: string, input: z.infer<typeof CustomTemplateSchema>): Promise<TemplateRow> {
  const before = await getCustomTemplate(id)
  await checkCustomTemplate(input)
  const [row] = await db.update(contractTemplates).set({ ...input, updatedAt: new Date() }).where(eq(contractTemplates.id, id)).returning()
  // Contracts already made keep their template_snapshot: editing the template never changes them.
  await recordAudit({ action: 'contract.sablon.modificat', entityType: 'contract_template', entityId: id, changes: { nume: [before.name, input.name] } })
  return row!
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  const before = await getCustomTemplate(id)
  await db.update(contractTemplates).set({ deletedAt: new Date() }).where(eq(contractTemplates.id, id))
  await recordAudit({ action: 'contract.sablon.sters', entityType: 'contract_template', entityId: id, changes: { nume: [before.name, null] } })
}
