import { z } from 'zod/v4'
import * as invoicingService from '../../invoicing/service.js'
import { autoTool, confirmTool, type ToolBuildContext } from './shared.js'

// NU importăm/expunem sendInvoiceToAnaf() — blocaj hard, cerință explicită Stefan (vezi
// PLAN_INAPP_AGENT.md). Trimiterea la ANAF rămâne strict manuală din UI sau din cron-ul
// jobs/vanagreen-billing.ts.

const invoiceLine = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  vatRate: z.number().min(0).max(100).optional(),
})

export function buildInvoicingTools(ctx: ToolBuildContext) {
  return [
    autoTool({
      name: 'list_clients',
      inputSchema: z.object({}),
      description: 'Listă clienți de facturare.',
      run: () => invoicingService.listClients(),
    }),
    autoTool({
      name: 'get_client',
      inputSchema: z.object({ id: z.string() }),
      description: 'Detalii despre un client de facturare.',
      run: (a) => invoicingService.getClient(a.id),
    }),
    autoTool({
      name: 'list_invoices',
      inputSchema: z.object({}),
      description: 'Listă facturi emise + draft-uri.',
      run: () => invoicingService.listInvoices(),
    }),
    autoTool({
      name: 'get_invoice_sequence',
      inputSchema: z.object({}),
      description: 'Configurația curentă a secvenței de numerotare a facturilor.',
      run: () => invoicingService.getSequence(),
    }),
    autoTool({
      name: 'list_platform_templates',
      inputSchema: z.object({ platformId: z.string() }),
      description: 'Template-uri de facturare configurate pentru o platformă.',
      run: (a) => invoicingService.listPlatformTemplates(a.platformId),
    }),
    autoTool({
      name: 'create_client',
      inputSchema: z.object({
        name: z.string().min(1),
        cif: z.string().min(2),
        address: z.string().min(1),
        city: z.string().optional(),
        county: z.string().optional(),
        country: z.string().optional(),
        iban: z.string().optional(),
        bank: z.string().optional(),
        email: z.string().optional(),
        platformId: z.string().nullable().optional(),
      }),
      description: 'Creează un client nou de facturare. Reversibil.',
      run: (a) => invoicingService.createClient(a as never),
    }),
    autoTool({
      name: 'update_client',
      inputSchema: z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        cif: z.string().min(2).optional(),
        address: z.string().min(1).optional(),
        city: z.string().optional(),
        county: z.string().optional(),
        iban: z.string().optional(),
        bank: z.string().optional(),
        email: z.string().optional(),
        autoInvoiceEnabled: z.boolean().optional(),
      }),
      description: 'Editează un client de facturare existent.',
      run: ({ id, ...rest }) => invoicingService.updateClient(id, rest as never),
    }),
    autoTool({
      name: 'delete_client',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge (soft-delete, reversibil) un client de facturare.',
      run: (a) => invoicingService.softDeleteClient(a.id),
    }),
    autoTool({
      name: 'create_draft_invoice',
      inputSchema: z.object({
        billingClientId: z.string(),
        templateId: z.string().optional(),
        currency: z.string().optional(),
        issuedAt: z.string().optional(),
        dueAt: z.string().optional(),
        note: z.string().optional(),
        lines: z.array(invoiceLine).optional(),
      }),
      description: 'Creează un draft de factură (fără număr alocat încă). Reversibil — editabil/ștergibil cât e draft.',
      run: (a) =>
        invoicingService.createDraftInvoice({
          ...a,
          issuedAt: a.issuedAt ? new Date(a.issuedAt) : undefined,
          dueAt: a.dueAt ? new Date(a.dueAt) : undefined,
        } as never),
    }),
    autoTool({
      name: 'update_draft_invoice',
      inputSchema: z.object({
        id: z.string(),
        currency: z.string().optional(),
        issuedAt: z.string().optional(),
        dueAt: z.string().optional(),
        note: z.string().optional(),
        lines: z.array(invoiceLine).optional(),
      }),
      description: 'Editează un draft de factură existent (nu funcționează după emitere).',
      run: ({ id, ...rest }) =>
        invoicingService.updateDraftInvoice(id, {
          ...rest,
          issuedAt: rest.issuedAt ? new Date(rest.issuedAt) : undefined,
          dueAt: rest.dueAt ? new Date(rest.dueAt) : undefined,
        } as never),
    }),
    autoTool({
      name: 'delete_draft_invoice',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge un draft de factură (blocat dacă factura a fost deja emisă).',
      run: (a) => invoicingService.deleteDraftInvoice(a.id),
    }),
    autoTool({
      name: 'create_platform_template',
      inputSchema: z.object({
        platformId: z.string(),
        name: z.string().min(1),
        currency: z.enum(['RON', 'EUR', 'USD']).optional(),
        lineItems: z
          .array(
            z.object({
              description: z.string().min(1),
              quantity: z.number().positive(),
              priceSource: z.enum(['fixed', 'client_subscription']).optional(),
              unitPrice: z.number().nonnegative().nullable().optional(),
              vatRatePct: z.number().min(0).max(100).optional(),
            }),
          )
          .min(1),
        isDefaultForAutoInvoice: z.boolean().optional(),
      }),
      description: 'Creează un template de factură reutilizabil pentru o platformă.',
      run: ({ platformId, ...rest }) => invoicingService.createPlatformTemplate(platformId, rest as never),
    }),
    autoTool({
      name: 'delete_platform_template',
      inputSchema: z.object({ platformId: z.string(), id: z.string() }),
      description: 'Șterge un template de factură.',
      run: (a) => invoicingService.deletePlatformTemplate(a.platformId, a.id),
    }),

    // ── Confirm — vezi PLAN_INAPP_AGENT.md, categoria "importante" ──────────────
    confirmTool(ctx, {
      name: 'issue_invoice',
      inputSchema: z.object({ id: z.string() }),
      description:
        'Emite un draft de factură: alocă numărul definitiv din secvență și generează XML/PDF. Ireversibil — după asta factura nu mai poate fi ștearsă.',
      summarize: async (a) => {
        const invoices = await invoicingService.listInvoices()
        const invoice = (invoices as Array<{ id: string; billingClientId?: string; totalAmount?: number; currency?: string }>).find(
          (i) => i.id === a.id,
        )
        if (!invoice) return `Emite factura draft ${a.id} — alocă număr definitiv, ireversibil.`
        return `Emite factura draft ${a.id} (client ${invoice.billingClientId ?? '?'}, total ${invoice.totalAmount ?? '?'} ${invoice.currency ?? ''}) — alocă număr definitiv din secvență, devine ireversibilă/neștergibilă. NU se trimite automat la ANAF — asta rămâne un pas separat, manual.`
      },
    }),
    confirmTool(ctx, {
      name: 'update_invoice_sequence',
      inputSchema: z.object({
        prefix: z.string().max(10).optional(),
        separator: z.string().max(3).optional(),
        yearFormat: z.enum(['none', 'yy', 'yyyy']).optional(),
        padding: z.number().int().min(0).max(10).optional(),
        startFrom: z.number().int().min(1).optional(),
        resetOn: z.enum(['never', 'year']).optional(),
      }),
      description: 'Editează configurația secvenței de numerotare a facturilor. Risc: duplicate/goluri în numerotare dacă e greșit.',
      summarize: (a) => `Modifică secvența de numerotare facturi: ${JSON.stringify(a)}. Risc legal dacă introduce duplicate/goluri.`,
    }),
  ]
}

export const invoicingConfirmExecutors: Record<string, (input: never) => Promise<unknown>> = {
  issue_invoice: (input: { id: string }) => invoicingService.issueInvoice(input.id),
  update_invoice_sequence: (input) => invoicingService.updateSequence(input as never),
}
