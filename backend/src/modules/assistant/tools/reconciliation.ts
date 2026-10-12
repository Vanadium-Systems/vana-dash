import { z } from 'zod/v4'
import * as reconciliationService from '../../reconciliation/service.js'
import { autoTool, confirmTool, type ToolBuildContext } from './shared.js'

// NU expunem generateCertificateForAccount() / exchangeRevolutCode() — flux legat de un
// redirect OAuth live în browser, nu se pretează la un tool de chat; rămân manuale din UI
// (vezi PLAN_INAPP_AGENT.md).

export function buildReconciliationTools(ctx: ToolBuildContext) {
  return [
    autoTool({
      name: 'list_bank_accounts',
      inputSchema: z.object({}),
      description: 'Listă conturi bancare conectate pentru reconciliere.',
      run: () => reconciliationService.listAccounts(),
    }),
    autoTool({
      name: 'list_bank_transactions',
      inputSchema: z.object({
        accountId: z.string().optional(),
        unmatchedOnly: z.boolean().optional(),
        direction: z.enum(['in', 'out']).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      description: 'Listă tranzacții bancare importate, cu filtre (ex. doar nematchuite).',
      run: (a) => reconciliationService.listTransactions({ unmatchedOnly: false, limit: 200, ...a } as never),
    }),
    autoTool({
      name: 'list_open_invoices',
      inputSchema: z.object({}),
      description: 'Facturi neplătite disponibile pentru matching cu tranzacții bancare.',
      run: () => reconciliationService.listOpenInvoices(),
    }),
    autoTool({
      name: 'get_vanagreen_settings',
      inputSchema: z.object({}),
      description: 'Setările curente de extindere automată a abonamentului vanagreen.',
      run: () => reconciliationService.getVanagreenSettings(),
    }),
    autoTool({
      name: 'list_vanagreen_tenants',
      inputSchema: z.object({}),
      description: 'Lista tenanților vanagreen disponibili pentru mapare la un client.',
      run: () => reconciliationService.listVanagreenTenants(),
    }),
    // NU expunem create_bank_account cu apiKey — un secret nu trebuie să tranziteze printr-un
    // mesaj de chat (ajunge la Anthropic + persistat în assistant_messages). Provider fără
    // token static (ex. Revolut, OAuth) poate fi creat fără cheie; cazul cu token static
    // rămâne strict din UI.
    autoTool({
      name: 'create_bank_account',
      inputSchema: z.object({
        provider: z.string().min(1),
        name: z.string().min(1),
        accountRef: z.string().optional(),
        currency: z.string().optional(),
      }),
      description: 'Adaugă un cont bancar nou pentru reconciliere (fără token static — provideri OAuth precum Revolut se configurează separat, din UI). Reversibil.',
      run: (a) => reconciliationService.createAccount(a as never),
    }),
    autoTool({
      name: 'update_bank_account',
      inputSchema: z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        accountRef: z.string().optional(),
        currency: z.string().optional(),
      }),
      description: 'Editează un cont bancar existent.',
      run: ({ id, ...rest }) => reconciliationService.updateAccount(id, rest as never),
    }),
    autoTool({
      name: 'delete_bank_account',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge (soft-delete, reversibil) un cont bancar.',
      run: (a) => reconciliationService.softDeleteAccount(a.id),
    }),
    autoTool({
      name: 'create_manual_match',
      inputSchema: z.object({ bankTransactionId: z.string(), financialRecordId: z.string() }),
      description: 'Leagă manual o tranzacție bancară de o factură/înregistrare contabilă. Reversibil.',
      run: (a) => reconciliationService.createManualMatch(a.bankTransactionId, a.financialRecordId),
    }),
    autoTool({
      name: 'remove_match',
      inputSchema: z.object({ bankTransactionId: z.string() }),
      description: 'Anulează un matching existent între tranzacție bancară și factură.',
      run: (a) => reconciliationService.removeMatch(a.bankTransactionId),
    }),
    autoTool({
      name: 'update_vanagreen_settings',
      inputSchema: z.object({ autoExtendEnabled: z.boolean() }),
      description: 'Activează/dezactivează extinderea automată a abonamentului vanagreen.',
      run: (a) => reconciliationService.updateVanagreenSettings(a.autoExtendEnabled),
    }),

    confirmTool(ctx, {
      name: 'mark_invoice_paid_manually',
      inputSchema: z.object({ financialRecordId: z.string() }),
      description: 'Marchează manual o factură ca plătită, fără tranzacție bancară verificată automat.',
      summarize: (a) => `Marchează factura/înregistrarea ${a.financialRecordId} ca plătită manual, fără verificare bancară automată.`,
    }),
  ]
}

export const reconciliationConfirmExecutors: Record<string, (input: never) => Promise<unknown>> = {
  mark_invoice_paid_manually: (input: { financialRecordId: string }) =>
    reconciliationService.markInvoicePaidManually(input.financialRecordId),
}
