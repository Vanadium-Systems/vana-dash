import { z } from 'zod'

// Companiile de pe instalare (pagina "Companies" pentru platform admin).
export const CreateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  cif: z.string().trim().max(20).optional(),
})

export const UpdateTenantSchema = z.object({ status: z.enum(['active', 'suspended']) })

export const TenantIdParamsSchema = z.object({ id: z.string().uuid() })

export const TenantFeatureParamsSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(80),
})

export const TenantFeatureBodySchema = z.object({ enabled: z.boolean() })
