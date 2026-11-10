import { z } from 'zod'

const snippetFields = {
  name: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(5000),
  shared: z.boolean().optional(),
}
export const CreateSnippetSchema = z.object(snippetFields)
export const UpdateSnippetSchema = z.object(snippetFields).partial()
export const SnippetParamsSchema = z.object({ id: z.string().uuid() })
