import { z } from 'zod'

export const CreateNoteSchema = z.object({
  title: z.string().trim().min(1).max(255),
  body: z.string().optional(),
})

export const UpdateNoteSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  body: z.string().optional(),
  pinned: z.boolean().optional(),
})

export const ListNotesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  pinned: z.coerce.boolean().optional(),
})
