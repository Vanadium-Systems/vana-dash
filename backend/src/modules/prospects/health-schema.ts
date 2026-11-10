import { z } from 'zod'

export const DuplicatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

export const MERGE_FIELDS = [
  'name',
  'cif',
  'website',
  'caenCode',
  'foundingYear',
  'employeeCount',
  'revenue',
  'profit',
  'debt',
  'equity',
  'cash',
  'receivables',
  'inventory',
  'valueAmount',
  'valueCurrency',
  'expectedCloseAt',
  'source',
  'isActive',
  'status',
  'assignedUserId',
] as const
export type MergeField = (typeof MERGE_FIELDS)[number]

export const MergePreviewQuerySchema = z.object({
  masterId: z.string().uuid(),
  otherId: z.string().uuid(),
})

export const MergeBodySchema = z.object({
  masterId: z.string().uuid(),
  otherId: z.string().uuid(),
  fields: z.partialRecord(z.enum(MERGE_FIELDS), z.enum(['master', 'other'])).default({}),
})
