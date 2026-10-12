import { z } from 'zod'

const category = z.enum(['necesitate', 'placere'])
const scope = z.enum(['personal', 'firma'])
const priority = z.enum(['low', 'medium', 'high'])

export const CreateWishlistItemSchema = z.object({
  title: z.string().trim().min(1).max(255),
  category,
  scope: scope.optional(),
  priority: priority.optional(),
  estimatedPrice: z.number().positive().optional(),
  currency: z.enum(['RON', 'EUR', 'USD']).optional(),
  link: z.string().trim().url().optional(),
})

export const UpdateWishlistItemSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  category: category.optional(),
  scope: scope.optional(),
  priority: priority.optional(),
  estimatedPrice: z.number().positive().nullable().optional(),
  currency: z.enum(['RON', 'EUR', 'USD']).optional(),
  link: z.string().trim().url().nullable().optional(),
})

export const ListWishlistQuerySchema = z.object({
  category: category.optional(),
  scope: scope.optional(),
  purchased: z.coerce.boolean().optional(),
})

export const PurchaseWishlistItemSchema = z.object({
  addExpense: z.boolean().optional(),
})
