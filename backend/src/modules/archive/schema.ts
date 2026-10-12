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
})

export const ListFoldersQuerySchema = z.object({
  parentId: z.string().uuid().optional(),
  sort: z.enum(['recent', 'oldest', 'name']).default('name'),
})

export const ListFilesQuerySchema = z.object({
  folderId: z.string().uuid().optional(),
  q: z.string().trim().optional(),
  // comma-separated — form simplu de query string, parsat în service
  tags: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  sort: z.enum(['recent', 'oldest', 'name']).default('recent'),
})

export const SearchFilesQuerySchema = z.object({
  q: z.string().trim().min(1),
  tags: z.string().optional(),
})

export const UpdateFileSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  folderId: z.string().uuid().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
})

export const DeleteFileQuerySchema = z.object({
  // z.coerce.boolean() ar transforma string-ul "false" în true (același bug cunoscut ca în
  // reconciliation/schema.ts) — periculos aici, fiindcă ar declanșa ștergere PERMANENTĂ (nu
  // soft delete) pt. cine trimite explicit `?permanent=false` crezând că e cazul sigur.
  permanent: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
})

export const ShareSchema = z.object({
  userId: z.string().uuid(),
  level: z.enum(['view', 'edit']),
})

export const AssignFolderSchema = z.object({ ownerUserId: z.string().uuid() })

export const AssignSpacesSchema = z.object({ toUserId: z.string().uuid() })