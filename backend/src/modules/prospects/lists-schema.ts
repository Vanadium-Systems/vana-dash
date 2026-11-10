import { z } from 'zod'
import { ProspectFiltersSchema } from './filters.js'

const name = z.string().trim().min(1).max(100)

export const IdParamsSchema = z.object({ id: z.string().uuid() })

export const CreateFolderSchema = z.object({ name, shared: z.boolean().default(true) })
export const UpdateFolderSchema = z.object({ name, shared: z.boolean() }).partial()

export const CreateListSchema = z.object({ name, folderId: z.string().uuid().nullable().optional(), shared: z.boolean().default(true) })
export const UpdateListSchema = z.object({ name, folderId: z.string().uuid().nullable(), shared: z.boolean() }).partial()

export const MAX_ADD_IDS = 1000
export const MAX_ADD_LIMIT = 5000

const AddByIdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(MAX_ADD_IDS) })

export const SkipRulesSchema = z.object({
  skipInFolderLists: z.boolean().optional(),
  skipWithoutPhone: z.boolean().optional(),
  skipDoNotContact: z.boolean().optional(),
})
export type SkipRules = z.infer<typeof SkipRulesSchema>

const AddBySearchSchema = z.object({
  f: ProspectFiltersSchema,
  q: z.string().trim().max(200).optional(),
  rules: SkipRulesSchema.optional(),
  limit: z.number().int().min(1).max(MAX_ADD_LIMIT).optional(),
})

export const AddMembersSchema = z.union([AddByIdsSchema, AddBySearchSchema])
export type AddMembersInput = z.infer<typeof AddMembersSchema>

export const RemoveMembersSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(MAX_ADD_IDS) })
