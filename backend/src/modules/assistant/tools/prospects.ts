import { z } from 'zod/v4'
import * as prospectsService from '../../prospects/service.js'
import { autoTool, confirmTool, type ToolBuildContext } from './shared.js'
import type { SessionUser } from '../../../shared/lib/session.js'

export function buildProspectsTools(ctx: ToolBuildContext) {
  return [
    autoTool({
      name: 'get_scoring_config',
      inputSchema: z.object({}),
      description: 'Configurația curentă de scoring pentru prospecți (ponderi + praguri HOT/WARM/NURTURE).',
      run: () => prospectsService.getScoringConfig(),
    }),
    autoTool({
      name: 'list_prospects',
      inputSchema: z.object({
        status: z.string().optional(),
        priority: z.enum(['HOT', 'WARM', 'NURTURE', 'SKIP']).optional(),
        source: z.string().optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
      }),
      description: 'Listă prospecți CRM, cu filtre (25 pe pagină, cu totalul).',
      run: (a) =>
        prospectsService.listProspects(ctx.user, {
          f: [
            ...(a.status ? [{ field: 'status' as const, op: 'in' as const, value: [a.status] }] : []),
            ...(a.priority ? [{ field: 'priority' as const, op: 'in' as const, value: [a.priority] }] : []),
            ...(a.source ? [{ field: 'source' as const, op: 'in' as const, value: [a.source] }] : []),
          ],
          q: a.search,
          page: a.page,
        }),
    }),
    autoTool({
      name: 'get_prospect',
      inputSchema: z.object({ id: z.string() }),
      description: 'Detalii despre un prospect.',
      run: (a) => prospectsService.getProspectSheet(ctx.user, a.id),
    }),
    autoTool({
      name: 'update_scoring_config',
      inputSchema: z.object({
        budgetWeight: z.number().min(0).max(1),
        needWeight: z.number().min(0).max(1),
        techWeight: z.number().min(0).max(1),
        contactWeight: z.number().min(0).max(1),
        hotThreshold: z.number().min(0).max(100),
        warmThreshold: z.number().min(0).max(100),
        nurtureThreshold: z.number().min(0).max(100),
      }),
      description: 'Actualizează ponderile/pragurile de scoring pentru prospecți.',
      run: (a) => prospectsService.updateScoringConfig(a),
    }),
    autoTool({
      name: 'create_prospect',
      inputSchema: z.object({
        name: z.string().min(1),
        cif: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        website: z.string().optional(),
        contactName: z.string().optional(),
        caenCode: z.string().optional(),
        source: z.string().optional(),
        platformId: z.string().optional(),
      }),
      description: 'Adaugă un prospect nou în CRM. Reversibil.',
      run: (a) => prospectsService.createProspect(ctx.user, a as never),
    }),
    autoTool({
      name: 'update_prospect',
      inputSchema: z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        status: z.string().optional(),
        lostReason: z.string().optional(),
      }),
      description: 'Editează un prospect existent (nume, status; la un status de pierdere cere motivul).',
      run: ({ id, ...rest }) => prospectsService.updateProspect(ctx.user, id, rest as never),
    }),
    autoTool({
      name: 'delete_prospect',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge un prospect din CRM.',
      run: (a) => prospectsService.deleteProspect(ctx.user, a.id),
    }),
    autoTool({
      name: 'recalculate_all_scores',
      inputSchema: z.object({}),
      description: 'Recalculează scorurile tuturor prospecților după config-ul curent.',
      run: () => prospectsService.recalculateAllScores(),
    }),

    confirmTool(ctx, {
      name: 'promote_prospect',
      inputSchema: z.object({
        id: z.string(),
        address: z.string().min(1),
        city: z.string().optional(),
        county: z.string().optional(),
        cif: z.string().optional(),
        platformId: z.string().optional(),
      }),
      description: 'Convertește un prospect în client de facturare — schimbare de business, nu doar editare de date.',
      summarize: async (a) => {
        const prospect = await prospectsService.getProspectSheet(ctx.user, a.id)
        return `Promovează prospectul "${(prospect as { name?: string })?.name ?? a.id}" la client de facturare (adresă: ${a.address}).`
      },
    }),
  ]
}

export const prospectsConfirmExecutors: Record<string, (input: never, ctx: { user: SessionUser }) => Promise<unknown>> = {
  promote_prospect: (input: { id: string; [k: string]: unknown }, actionCtx: { user: SessionUser }) => {
    const { id, ...rest } = input
    return prospectsService.promoteProspect(actionCtx.user, id, rest as never)
  },
}
