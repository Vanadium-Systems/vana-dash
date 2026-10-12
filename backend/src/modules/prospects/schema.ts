import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'

// Paletă fixă de token-uri de culoare pt. statusuri prospect (Wave 0, sprint de-hardcodare) —
// NU hex liber: clasele Tailwind complete trebuie să existe static în sursa frontend pt. JIT
// purge, un token liber ar produce clase inexistente la build. Editabil doar prin adăugarea
// unui token nou aici + clasa lui în COLOR_TOKEN_CLASSES (frontend), nu prin UI.
export const STATUS_COLOR_TOKENS = ['slate', 'gray', 'red', 'orange', 'amber', 'emerald', 'cyan', 'blue', 'purple', 'indigo'] as const
export type StatusColorToken = (typeof STATUS_COLOR_TOKENS)[number]

export const CreateProspectStatusSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, lazyTr('errors.prospects.keyFormat')),
  label: z.string().trim().min(1).max(100),
  colorToken: z.enum(STATUS_COLOR_TOKENS),
})

export const UpdateProspectStatusSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  colorToken: z.enum(STATUS_COLOR_TOKENS).optional(),
})

export const ReorderProspectStatusesSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
})

const financialFields = {
  revenue: z.number().nullable().optional(),
  profit: z.number().nullable().optional(),
  debt: z.number().nullable().optional(),
  equity: z.number().nullable().optional(),
  cash: z.number().nullable().optional(),
  receivables: z.number().nullable().optional(),
  inventory: z.number().nullable().optional(),
}

export const CreateProspectSchema = z.object({
  name: z.string().trim().min(1).max(255),
  cif: z.string().trim().min(1).max(20).optional(),
  phone: z.string().trim().max(100).optional(),
  // Text liber, nu .email() strict — practica reală (import CSV) ține mai multe adrese
  // separate prin "/" pe același prospect (ca la telefon), un format de email unic ar respinge asta.
  email: z.string().trim().max(255).optional(),
  website: z.string().trim().max(500).optional(),
  contactName: z.string().trim().max(255).optional(),
  caenCode: z.string().trim().max(20).optional(),
  foundingYear: z.number().int().min(1900).max(2100).nullable().optional(),
  employeeCount: z.number().int().nonnegative().nullable().optional(),
  ...financialFields,
  source: z.string().trim().max(255).optional(),
  platformId: z.string().uuid().optional(),
})

export const UpdateProspectSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  cif: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().max(255).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  contactName: z.string().trim().max(255).nullable().optional(),
  caenCode: z.string().trim().max(20).nullable().optional(),
  foundingYear: z.number().int().min(1900).max(2100).nullable().optional(),
  employeeCount: z.number().int().nonnegative().nullable().optional(),
  ...financialFields,
  // Validat contra catalogului activ din `prospect_statuses` la nivel de service (async, nu
  // se poate face în Zod) — vezi service.ts#updateProspect. Aici doar shape-ul de bază.
  status: z.string().trim().min(1).max(50).optional(),
  contactedBy: z.string().trim().max(255).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  source: z.string().trim().max(255).nullable().optional(),
  platformId: z.string().uuid().nullable().optional(),
  lastContactedAt: z.coerce.date().nullable().optional(),
})

export const ListProspectsQuerySchema = z.object({
  status: z.string().trim().optional(),
  priority: z.enum(['HOT', 'WARM', 'NURTURE', 'SKIP']).optional(),
  source: z.string().trim().optional(),
  search: z.string().trim().optional(),
  // implicit: doar activi. 'only' — doar arhivați (ca să-i găsești la nevoie). 'all' — toți.
  archived: z.enum(['only', 'all']).optional(),
})

export const PromoteProspectSchema = z.object({
  address: z.string().trim().min(1),
  city: z.string().trim().optional(),
  county: z.string().trim().optional(),
  // Necesar doar dacă prospectul nu are deja CIF completat.
  cif: z.string().trim().min(2).max(13).optional(),
  platformId: z.string().uuid().optional(),
})

export const UpdateScoringConfigSchema = z.object({
  budgetWeight: z.number().min(0).max(1),
  needWeight: z.number().min(0).max(1),
  techWeight: z.number().min(0).max(1),
  contactWeight: z.number().min(0).max(1),
  hotThreshold: z.number().min(0).max(100),
  warmThreshold: z.number().min(0).max(100),
  nurtureThreshold: z.number().min(0).max(100),
})

// 500 → 1000 (2026-09-03, Stefan: are ~800 de clienți de arhivat dintr-o dată, „select all"
// din ProspectareTab.tsx lovea plafonul de 500 pe un singur request).
export const BulkProspectIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
})

export const ImportProspectsSchema = z.object({
  csv: z.string().min(1),
  source: z.string().trim().max(255).optional(),
})
