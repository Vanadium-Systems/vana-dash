import { z } from 'zod/v4'
import * as prospectsService from '../../prospects/service.js'
import { autoTool, confirmTool, type ToolBuildContext } from './shared.js'

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
      }),
      description: 'Listă prospecți CRM, cu filtre.',
      run: (a) => prospectsService.listProspects(a as never),
    }),
    autoTool({
      name: 'get_prospect',
      inputSchema: z.object({ id: z.string() }),
      description: 'Detalii despre un prospect.',
      run: (a) => prospectsService.getProspect(a.id),
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
      run: (a) => prospectsService.createProspect(a as never),
    }),
    autoTool({
      name: 'update_prospect',
      inputSchema: z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        status: z
          .enum([
            'necontactat',
            'nu_a_raspuns',
            'respins',
            'de_revenit',
            'whatsapp',
            'email',
            'aprobat',
            'testing',
            'caz_particular',
            'nu_e_de_interes',
          ])
          .optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        contactedBy: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
      description: 'Editează un prospect existent (status, notițe, date de contact).',
      run: ({ id, ...rest }) => prospectsService.updateProspect(id, rest as never),
    }),
    autoTool({
      name: 'delete_prospect',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge un prospect din CRM.',
      run: (a) => prospectsService.deleteProspect(a.id),
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
        const prospect = await prospectsService.getProspect(a.id)
        return `Promovează prospectul "${(prospect as { name?: string })?.name ?? a.id}" la client de facturare (adresă: ${a.address}).`
      },
    }),
  ]
}

export const prospectsConfirmExecutors: Record<string, (input: never) => Promise<unknown>> = {
  promote_prospect: (input: { id: string; [k: string]: unknown }) => {
    const { id, ...rest } = input
    return prospectsService.promoteProspect(id, rest as never)
  },
}
