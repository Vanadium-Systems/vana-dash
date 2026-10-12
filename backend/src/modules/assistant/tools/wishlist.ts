import { z } from 'zod/v4'
import * as wishlistService from '../../wishlist/service.js'
import type { SessionUser } from '../../../shared/lib/session.js'
import { autoTool, confirmTool, type ToolBuildContext } from './shared.js'

export function buildWishlistTools(ctx: ToolBuildContext) {
  return [
    autoTool({
      name: 'list_wishlist_items',
      inputSchema: z.object({
        category: z.enum(['necesitate', 'placere']).optional(),
        scope: z.enum(['personal', 'firma']).optional(),
        purchased: z.boolean().optional(),
      }),
      description: 'Listă itemi din wishlist, cu filtre.',
      run: (a) => wishlistService.listWishlistItems(ctx.user, a as never),
    }),
    autoTool({
      name: 'get_wishlist_totals',
      inputSchema: z.object({}),
      description: 'Totaluri wishlist (sumă estimată pe categorii).',
      run: () => wishlistService.getWishlistTotals(ctx.user),
    }),
    autoTool({
      name: 'create_wishlist_item',
      inputSchema: z.object({
        title: z.string().min(1),
        category: z.enum(['necesitate', 'placere']),
        scope: z.enum(['personal', 'firma']).optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        estimatedPrice: z.number().positive().optional(),
        currency: z.enum(['RON', 'EUR', 'USD']).optional(),
        link: z.string().optional(),
      }),
      description: 'Adaugă un item nou în wishlist. Reversibil.',
      run: (a) => wishlistService.createWishlistItem(ctx.user, a as never),
    }),
    autoTool({
      name: 'update_wishlist_item',
      inputSchema: z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        estimatedPrice: z.number().positive().nullable().optional(),
      }),
      description: 'Editează un item din wishlist.',
      run: ({ id, ...rest }) => wishlistService.updateWishlistItem(ctx.user, id, rest as never),
    }),
    autoTool({
      name: 'delete_wishlist_item',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge un item din wishlist.',
      run: (a) => wishlistService.deleteWishlistItem(ctx.user, a.id),
    }),

    confirmTool(ctx, {
      name: 'purchase_wishlist_item',
      inputSchema: z.object({ id: z.string(), addExpense: z.boolean().optional() }),
      description: 'Marchează un item din wishlist ca achiziționat — cheltuială reală de bani.',
      summarize: async (a) => {
        const items = await wishlistService.listWishlistItems(ctx.user, {} as never)
        const item = (items as unknown as Array<{ id: string; title?: string; estimatedPrice?: number; currency?: string }>).find(
          (i) => i.id === a.id,
        )
        return item
          ? `Marchează "${item.title}" ca achiziționat (~${item.estimatedPrice ?? '?'} ${item.currency ?? ''})${a.addExpense ? ', și creează cheltuiala în Accounting' : ''}.`
          : `Marchează item-ul ${a.id} din wishlist ca achiziționat.`
      },
    }),
  ]
}

export const wishlistConfirmExecutors: Record<
  string,
  (input: never, ctx: { conversationId: string; user: SessionUser }) => Promise<unknown>
> = {
  purchase_wishlist_item: (input: { id: string; addExpense?: boolean }, ctx) =>
    wishlistService.purchaseWishlistItem(ctx.user, input.id, { addExpense: input.addExpense }),
}
