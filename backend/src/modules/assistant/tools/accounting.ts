import { z } from 'zod/v4'
import * as accountingService from '../../accounting/service.js'
import { autoTool } from './shared.js'

export function buildAccountingTools() {
  return [
    autoTool({
      name: 'list_accounting_records',
      inputSchema: z.object({
        direction: z.enum(['in', 'out']).optional(),
        type: z.enum(['invoice', 'expense', 'payment']).optional(),
        paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
        anafStatus: z.enum(['draft', 'pending', 'validated', 'rejected']).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      description: 'Listă de facturi/cheltuieli/plăți din Accounting, cu filtre.',
      run: (a) => accountingService.listRecords({ limit: 200, ...a } as never),
    }),
    autoTool({
      name: 'get_accounting_record',
      inputSchema: z.object({ id: z.string() }),
      description: 'Detalii despre o înregistrare contabilă (factură/cheltuială/plată).',
      run: (a) => accountingService.getRecord(a.id),
    }),
    autoTool({
      name: 'get_anaf_status',
      inputSchema: z.object({}),
      description: 'Starea conexiunii OAuth ANAF (token activ / expiră / needs_reauth).',
      run: () => accountingService.getAnafStatus(),
    }),
    autoTool({
      name: 'list_recurring_expenses',
      inputSchema: z.object({}),
      description: 'Lista cheltuielilor recurente (abonamente etc.) configurate.',
      run: () => accountingService.listRecurringExpenses(),
    }),
    autoTool({
      name: 'list_saved_spv_messages',
      inputSchema: z.object({}),
      description: 'Mesaje SPV (ANAF) salvate manual anterior.',
      run: () => accountingService.listSavedSpvMessages(),
    }),
    autoTool({
      name: 'create_manual_record',
      inputSchema: z.object({
        type: z.enum(['invoice', 'expense', 'payment']),
        direction: z.enum(['in', 'out']).optional(),
        amount: z.number().positive(),
        currency: z.enum(['RON', 'EUR', 'USD']).optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        counterpartyName: z.string().optional(),
        counterpartyCif: z.string().optional(),
        issuedAt: z.string(),
        dueAt: z.string().optional(),
      }),
      description: 'Creează manual o înregistrare contabilă (cheltuială/plată/factură primită). Reversibil.',
      run: (a) => accountingService.createManualRecord({ direction: 'in', currency: 'RON', reverseChargeType: 'none', ...a, issuedAt: new Date(a.issuedAt), dueAt: a.dueAt ? new Date(a.dueAt) : undefined } as never),
    }),
    autoTool({
      name: 'update_payment_status',
      inputSchema: z.object({
        id: z.string(),
        paymentStatus: z.enum(['unpaid', 'partial', 'paid']),
        paidAt: z.string().optional(),
      }),
      description: 'Actualizează statusul de plată al unei înregistrări contabile.',
      run: ({ id, ...rest }) => accountingService.updatePayment(id, { ...rest, paidAt: rest.paidAt ? new Date(rest.paidAt) : undefined } as never),
    }),
    autoTool({
      name: 'create_recurring_expense',
      inputSchema: z.object({
        description: z.string().min(1),
        category: z.string().optional(),
        amount: z.number().positive(),
        currency: z.enum(['RON', 'EUR', 'USD']).optional(),
        cycle: z.enum(['monthly', 'annual']),
        cycleDay: z.number().int().min(1).max(31),
        cycleMonth: z.number().int().min(1).max(12).optional(),
        showInCalendar: z.boolean().optional(),
      }),
      description: 'Configurează o cheltuială recurentă nouă (abonament etc.). Reversibil.',
      run: (a) => accountingService.createRecurringExpense(a as never),
    }),
    autoTool({
      name: 'update_recurring_expense',
      inputSchema: z.object({
        id: z.string(),
        description: z.string().min(1).optional(),
        category: z.string().optional(),
        amount: z.number().positive().optional(),
        currency: z.enum(['RON', 'EUR', 'USD']).optional(),
        cycle: z.enum(['monthly', 'annual']).optional(),
        cycleDay: z.number().int().min(1).max(31).optional(),
        cycleMonth: z.number().int().min(1).max(12).optional(),
        showInCalendar: z.boolean().optional(),
        active: z.boolean().optional(),
      }),
      description: 'Editează o cheltuială recurentă existentă.',
      run: ({ id, ...rest }) => accountingService.updateRecurringExpense(id, rest as never),
    }),
    autoTool({
      name: 'delete_recurring_expense',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge o cheltuială recurentă (reversibil).',
      run: (a) => accountingService.deleteRecurringExpense(a.id),
    }),
    autoTool({
      name: 'save_spv_message',
      inputSchema: z.object({
        anafMessageId: z.string(),
        type: z.string(),
        detail: z.string(),
        cif: z.string(),
        createdAt: z.string(),
      }),
      description: 'Salvează definitiv un mesaj SPV afișat live din ANAF (care altfel expiră din SPV).',
      run: ({ anafMessageId, ...rest }) => accountingService.saveSpvMessage(anafMessageId, { ...rest, createdAt: new Date(rest.createdAt) } as never),
    }),
  ]
}
