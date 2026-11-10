import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'
import { FiltersParamSchema, ProspectFilterSchema, ProspectFiltersSchema } from './filters.js'
import { CALL_OUTCOMES, CONTACT_POINT_KINDS, PROSPECT_TASK_KINDS, PROSPECT_TASK_PRIORITIES } from '../../shared/db/schema/prospect-crm.js'

export const PROSPECT_SORT_KEYS = ['score', 'name', 'updatedAt', 'createdAt', 'lastActivityAt', 'value', 'expectedCloseAt', 'daysInStage', 'nextTask'] as const

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
  isActive: z.boolean().optional(),
  source: z.string().trim().max(255).optional(),
  platformId: z.string().uuid().optional(),
})

export const UpdateProspectSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  cif: z.string().trim().max(20).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  caenCode: z.string().trim().max(20).nullable().optional(),
  foundingYear: z.number().int().min(1900).max(2100).nullable().optional(),
  employeeCount: z.number().int().nonnegative().nullable().optional(),
  ...financialFields,
  // Checked against the active catalog in the service (async); here only the shape.
  status: z.string().trim().min(1).max(50).optional(),
  lostReason: z.string().trim().max(500).nullable().optional(),
  source: z.string().trim().max(255).nullable().optional(),
  platformId: z.string().uuid().nullable().optional(),
  valueAmount: z.number().nonnegative().nullable().optional(),
  valueCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  expectedCloseAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  isActive: z.boolean().nullable().optional(),
})

const listParams = {
  f: FiltersParamSchema,
  q: z.string().trim().max(200).optional(),
  kind: z.enum(['companies', 'people']).optional(),
  sort: z.enum(PROSPECT_SORT_KEYS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
}

export const ListProspectsQuerySchema = z.object({
  ...listParams,
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})
export const NeighborsQuerySchema = z.object(listParams)
export const CountQuerySchema = z.object({ f: FiltersParamSchema, q: listParams.q, kind: listParams.kind })
export const AggregateQuerySchema = z.object({
  f: FiltersParamSchema,
  q: listParams.q,
  field: z.enum(['score', 'value', 'employees', 'revenue']),
  fn: z.enum(['count', 'sum', 'avg', 'min', 'max']),
})

export const BulkUpdateSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(1000).optional(),
    f: z.array(ProspectFilterSchema).max(40).optional(),
    q: z.string().trim().max(200).optional(),
    all: z.boolean().optional(),
    action: z.enum(['status', 'archive', 'unarchive']),
    value: z.string().max(50).optional(),
    lostReason: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.all || (b.ids && b.ids.length > 0), { message: 'ids or all' })

export const CompanyLookupQuerySchema = z.object({ cui: z.string().trim().min(2).max(20) })

export const PromoteProspectSchema = z.object({
  address: z.string().trim().min(1),
  city: z.string().trim().optional(),
  county: z.string().trim().optional(),
  // Necesar doar dacă prospectul nu are deja CIF completat.
  cif: z.string().trim().min(2).max(13).optional(),
  platformId: z.string().uuid().optional(),
})

export const ScoreCriterionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  filters: ProspectFiltersSchema.min(1),
  points: z.number().min(0).max(20),
})

// Descending cut-offs for the four labels; below `fit` is "unfit".
export const ScoreLabelsSchema = z
  .object({
    excellent: z.number().min(0).max(100),
    good: z.number().min(0).max(100),
    fit: z.number().min(0).max(100),
  })
  .refine((l) => l.excellent >= l.good && l.good >= l.fit)

export const UpdateScoringConfigSchema = z.object({
  budgetWeight: z.number().min(0).max(1),
  needWeight: z.number().min(0).max(1),
  techWeight: z.number().min(0).max(1),
  contactWeight: z.number().min(0).max(1),
  hotThreshold: z.number().min(0).max(100),
  warmThreshold: z.number().min(0).max(100),
  nurtureThreshold: z.number().min(0).max(100),
  baseWeight: z.number().min(0).max(1).optional(),
  criteria: z.array(ScoreCriterionSchema).max(30).optional(),
  labels: ScoreLabelsSchema.nullable().optional(),
})

// 500 → 1000 (2026-09-03, Stefan: are ~800 de clienți de arhivat dintr-o dată, „select all"
// din ProspectareTab.tsx lovea plafonul de 500 pe un singur request).
export const BulkProspectIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
})

// ── People, contact points, notes, tasks ─────────────────────────────────────

export const ProspectParamsSchema = z.object({ id: z.string().uuid() })
export const PersonParamsSchema = z.object({ id: z.string().uuid(), personId: z.string().uuid() })
export const ContactPointParamsSchema = z.object({ id: z.string().uuid(), cpId: z.string().uuid() })
export const NoteParamsSchema = z.object({ id: z.string().uuid(), noteId: z.string().uuid() })
export const ProspectTaskParamsSchema = z.object({ id: z.string().uuid(), taskId: z.string().uuid() })
export const TaskIdParamsSchema = z.object({ taskId: z.string().uuid() })

const personFields = {
  name: z.string().trim().min(1).max(255),
  role: z.string().trim().max(255).nullable().optional(),
  isDecisionMaker: z.boolean().optional(),
  doNotContact: z.boolean().optional(),
  doNotContactReason: z.string().trim().max(1000).nullable().optional(),
  position: z.number().int().min(0).max(1000).optional(),
}
export const CreatePersonSchema = z.object(personFields)
export const UpdatePersonSchema = z.object(personFields).partial()

export const CreateContactPointSchema = z.object({
  personId: z.string().uuid().nullable().optional(),
  kind: z.enum(CONTACT_POINT_KINDS),
  value: z.string().trim().min(1).max(255),
  label: z.string().trim().max(100).nullable().optional(),
  isPrimary: z.boolean().optional(),
})
export const UpdateContactPointSchema = z.object({
  personId: z.string().uuid().nullable().optional(),
  value: z.string().trim().min(1).max(255).optional(),
  label: z.string().trim().max(100).nullable().optional(),
  isPrimary: z.boolean().optional(),
  status: z.enum(['ok', 'invalid']).optional(),
})

export const CreateNoteSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  pinned: z.boolean().optional(),
  mentions: z.array(z.string().uuid()).max(50).optional(),
})
export const UpdateNoteSchema = z.object({
  body: z.string().trim().min(1).max(10000).optional(),
  pinned: z.boolean().optional(),
  mentions: z.array(z.string().uuid()).max(50).optional(),
})

const taskFields = {
  kind: z.enum(PROSPECT_TASK_KINDS),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  dueAt: z.coerce.date(),
  priority: z.enum(PROSPECT_TASK_PRIORITIES).optional(),
}
export const CreateProspectTaskSchema = z.object({
  ...taskFields,
  assigneeUserId: z.string().uuid().optional(),
  personId: z.string().uuid().nullable().optional(),
  addToCalendar: z.boolean().optional(),
})
export const UpdateProspectTaskSchema = z
  .object({
    ...taskFields,
    assigneeUserId: z.string().uuid(),
    personId: z.string().uuid().nullable(),
  })
  .partial()

export const CompleteTaskSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES).optional(),
  outcomeNote: z.string().trim().max(2000).optional(),
  contactPointId: z.string().uuid().optional(),
  nextTask: z
    .object({
      kind: z.enum(PROSPECT_TASK_KINDS),
      title: z.string().trim().min(1).max(255),
      dueAt: z.coerce.date(),
      priority: z.enum(PROSPECT_TASK_PRIORITIES).optional(),
      addToCalendar: z.boolean().optional(),
    })
    .optional(),
})

export const TASK_TABS = ['all', 'call', 'email', 'linkedin', 'today', 'overdue'] as const
export const TaskListQuerySchema = z.object({
  tab: z.enum(TASK_TABS).optional(),
  scope: z.enum(['mine', 'team']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})
export const TaskCountsQuerySchema = z.object({ scope: z.enum(['mine', 'team']).optional() })
