import { z } from 'zod'

// `parentId` nu mai poate lipsi la creare: rădăcina nu mai e „rădăcina arhivei", ci rădăcina
// spațiului omului, aleasă de server (access.ts::ensureSpaceRoot). La mutare, `null` înseamnă
// că backendul pune fișierul în folderul curent — deci FE-ul trimite întotdeauna un id.
export const CreateFolderSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().uuid().optional(),
})

export const UpdateFolderSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  parentId: z.string().uuid().nullable().optional(),
  autoMonthlySubfolders: z.boolean().optional(),
  color: z.number().int().min(1).max(8).nullable().optional(),
})

export const ListFoldersQuerySchema = z.object({
  parentId: z.string().uuid().optional(),
  sort: z.enum(['recent', 'oldest', 'name']).default('name'),
})

export const FILE_TYPES = ['pdf', 'image', 'document', 'spreadsheet', 'archive', 'other'] as const
export type FileType = (typeof FILE_TYPES)[number]

export const PAGE_SIZES = [10, 25, 50] as const

export const ListFilesQuerySchema = z.object({
  folderId: z.string().uuid().optional(),
  q: z.string().trim().optional(),
  // comma-separated — form simplu de query string, parsat în service
  tags: z.string().optional(),
  type: z.enum(FILE_TYPES).optional(),
  modifiedAfter: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .default(50),
  sort: z.enum(['recent', 'oldest', 'name']).default('recent'),
})

export const SearchFilesQuerySchema = z.object({
  q: z.string().trim().min(1),
  tags: z.string().optional(),
  type: z.enum(FILE_TYPES).optional(),
  modifiedAfter: z.coerce.date().optional(),
})

export const StarParamsSchema = z.object({ type: z.enum(['file', 'folder']), id: z.string().uuid() })

export const UpdateFileSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  folderId: z.string().uuid().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
})

export const ShareSchema = z.object({
  userId: z.string().uuid(),
  level: z.enum(['view', 'edit']),
})

export const AssignFolderSchema = z.object({ ownerUserId: z.string().uuid() })

export const AssignSpacesSchema = z.object({ toUserId: z.string().uuid() })
const BulkItemSchema = z.object({ type: z.enum(['file', 'folder']), id: z.string().uuid() })

export const BulkMoveSchema = z.object({
  items: z.array(BulkItemSchema).min(1).max(500),
  targetFolderId: z.string().uuid(),
})

export const BulkDeleteSchema = z.object({ items: z.array(BulkItemSchema).min(1).max(500) })

export const PutBackSchema = z.object({
  previous: z.array(BulkItemSchema.extend({ folderId: z.string().uuid() })).min(1).max(500),
})
