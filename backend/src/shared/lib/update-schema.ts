import { z } from 'zod'

type WithoutDefaults<Shape extends z.ZodRawShape> = {
  [K in keyof Shape]: z.ZodOptional<Shape[K] extends z.ZodDefault<infer Inner> ? Inner : Shape[K]>
}

/** The body of a PATCH: every field of the create schema, optional, with its default dropped.
 *  Zod 4's `.partial()` keeps `.default()`, so a field left out of the request would come back
 *  as the default and overwrite what is stored. */
export function updateSchema<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>): z.ZodObject<WithoutDefaults<Shape>> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [key, z.optional(field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : field)]),
  )
  return schema.extend(shape) as unknown as z.ZodObject<WithoutDefaults<Shape>>
}
