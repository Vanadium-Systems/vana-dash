import { z } from 'zod'
import { ProspectFiltersSchema } from './filters.js'
import { PROSPECT_SORT_KEYS } from './schema.js'

const CALC_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'] as const

const viewFields = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['companies', 'people']),
  filters: ProspectFiltersSchema,
  columns: z.array(z.string().max(60)).max(40),
  sort: z.object({ key: z.enum(PROSPECT_SORT_KEYS), dir: z.enum(['asc', 'desc']) }).nullable(),
  calcs: z.record(z.string().max(60), z.enum(CALC_FUNCTIONS)).refine((v) => Object.keys(v).length <= 40),
  layout: z.enum(['list', 'board', 'forecast']),
  shared: z.boolean(),
  notifyNew: z.boolean(),
}

export const CreateViewSchema = z.object({
  ...viewFields,
  kind: viewFields.kind.default('companies'),
  filters: viewFields.filters.default([]),
  columns: viewFields.columns.default([]),
  sort: viewFields.sort.default(null),
  calcs: viewFields.calcs.default({}),
  layout: viewFields.layout.default('list'),
  shared: viewFields.shared.default(false),
  notifyNew: viewFields.notifyNew.default(false),
})

export const UpdateViewSchema = z.object(viewFields).partial()

export const ViewParamsSchema = z.object({ id: z.string().uuid() })
