import { z } from 'zod'

const color = z.number().int().min(1).max(8).nullable()
const label = z.string().trim().min(1).max(50)
const labels = z.array(label).max(20)

export const CreateNoteSchema = z.object({
  title: z.string().trim().max(255).optional(),
  // `body` is plain text (the assistant, old clients); `bodyJson` is the editor's document.
  body: z.string().max(200_000).optional(),
  bodyJson: z.unknown().optional(),
  color: color.optional(),
  labels: labels.optional(),
  pinned: z.boolean().optional(),
})

export const UpdateNoteSchema = z.object({
  title: z.string().trim().max(255).optional(),
  body: z.string().max(200_000).optional(),
  bodyJson: z.unknown().optional(),
  pinned: z.boolean().optional(),
  color: color.optional(),
  labels: labels.optional(),
  // The `updatedAt` the client edited from; a content save against an older one is a conflict.
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
})

export const ListNotesQuerySchema = z.object({
  view: z.enum(['active', 'archived', 'trash']).default('active'),
  q: z.string().trim().min(1).optional(),
  label: label.optional(),
  color: z.coerce.number().int().min(1).max(8).optional(),
  pinned: z.preprocess((v) => (v === undefined ? undefined : v === true || v === 'true'), z.boolean().optional()),
})

export const RenameLabelSchema = z.object({ newName: label })

export const BulkNotesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['archive', 'unarchive', 'delete', 'restore', 'pin', 'unpin', 'color', 'addLabel', 'removeLabel']),
  value: z.union([color, label]).optional(),
})
