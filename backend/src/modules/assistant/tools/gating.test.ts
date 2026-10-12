/**
 * Gating pe tool-urile "confirm" (PLAN_INAPP_AGENT.md) — cele care necesită aprobarea omului
 * nu trebuie SĂ EXECUTE nimic la apelare, doar să înregistreze acțiunea propusă.
 * Verifică și mecanic că sendInvoiceToAnaf nu e niciodată accesibilă printr-un tool, plus
 * maparea tool → funcționalitate (C2): lista trimisă modelului e filtrată pe om.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildAllAssistantTools, buildAssistantTools, CONFIRM_TOOL_NAMES, confirmExecutors } from './index.js'
import { TOOL_FEATURES } from './tool-features.js'
import { effectiveFeatures, type SessionUser } from '../../../shared/lib/session.js'

// Admin de test: toate cutiile (mailboxes null) și toate funcționalitățile. Se folosește doar
// ca omul din sesiune; conținutul rămâne subiectul testului.
const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'stefan@vanadium.systems',
  displayName: 'Stefan',
  role: { id: '00000000-0000-4000-8000-000000000002', name: 'Admin', kind: 'admin' },
  isPlatformAdmin: true,
  features: effectiveFeatures([], 'admin'),
  mailboxes: null,
  status: 'active',
  lastSeenAt: null,
  notificationPrefs: null,
  navLayout: null,
  updatesSeenAt: null,
  locale: 'ro',
  displayCurrency: 'RON',
  sessionVersion: 1,
} satisfies SessionUser

// Coleg de test: doar Clienți + Calendar + Email de pe sales@, fără bulk (personajul din QA-5).
const salesFeatures = [
  'clienti.view',
  'calendar.view',
  'calendar.editare',
  'email.view',
  'email.trimitere',
]
const salesman = { ...admin, id: '00000000-0000-4000-8000-000000000003', displayName: 'Ana', role: { ...admin.role, kind: 'custom' as const }, features: salesFeatures, mailboxes: ['contact', 'noreply'] } satisfies SessionUser

const toolCtx = (user: SessionUser) => ({ onConfirmRequired: () => {}, conversationId: 'test-conversation', user })

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))

const EXPECTED_CONFIRM_TOOLS = [
  'issue_invoice',
  'update_invoice_sequence',
  'mark_invoice_paid_manually',
  'promote_prospect',
  'send_email',
  'reply_to_email_thread',
  'forward_email',
  'permanently_delete_archive_file',
  'purchase_wishlist_item',
  'create_reminder',
  'schedule_report',
  'cancel_scheduled_run',
  'crypto_place_order',
  'asset_place_order',
]

describe('assistant tool registry', () => {
  it('never imports or calls sendInvoiceToAnaf (comments mentioning it as documentation are fine)', () => {
    const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    for (const file of files) {
      const codeOnly = readFileSync(join(TOOLS_DIR, file), 'utf-8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
      expect(codeOnly, `${file} nu trebuie să importe sendInvoiceToAnaf`).not.toMatch(/import\s*\{[^}]*sendInvoiceToAnaf/)
      expect(codeOnly, `${file} nu trebuie să apeleze sendInvoiceToAnaf(...)`).not.toMatch(/\bsendInvoiceToAnaf\s*\(/)
    }
  })

  it('CONFIRM_TOOL_NAMES matches exactly the whitelist documented in PLAN_INAPP_AGENT.md', () => {
    expect([...CONFIRM_TOOL_NAMES].sort()).toEqual([...EXPECTED_CONFIRM_TOOLS].sort())
  })

  it('every confirm tool name has both a registered tool and an executor', async () => {
    const tools = await buildAssistantTools(toolCtx(admin))
    const toolNames = new Set(tools.map((t) => ('name' in t ? t.name : undefined)))
    for (const name of CONFIRM_TOOL_NAMES) {
      expect(toolNames.has(name), `${name} trebuie înregistrat în buildAssistantTools`).toBe(true)
      expect(typeof confirmExecutors[name], `${name} trebuie să aibă un executor`).toBe('function')
    }
  })

  it('every built tool declares a feature, and every declared feature has a tool', async () => {
    const tools = await buildAllAssistantTools(toolCtx(admin))
    const built = new Set(tools.map((t) => t.name))
    const declared = new Set(Object.keys(TOOL_FEATURES))
    expect([...built].filter((name) => !declared.has(name))).toEqual([])
    expect([...declared].filter((name) => !built.has(name))).toEqual([])
  })

  it('a colleague only gets the tools of the features he has', async () => {
    const tools = (await buildAssistantTools(toolCtx(salesman))).map((t) => t.name)
    expect(tools).toContain('list_emails')
    expect(tools).toContain('create_calendar_event')
    // Bulk, platforme, facturi, note — tot ce nu e în lista lui de funcționalități.
    for (const absent of ['issue_invoice', 'list_invoices', 'list_platforms', 'create_note', 'permanently_delete_archive_file']) {
      expect(tools, `${absent} nu trebuie să ajungă la model`).not.toContain(absent)
    }
  })

  it('email tools offer only the mailboxes of the person', async () => {
    const forColleague = await buildAllAssistantTools(toolCtx(salesman))
    const send = forColleague.find((t) => t.name === 'send_email')!
    // Ce ajunge la model e JSON Schema, deci enum-ul cutiilor se vede acolo.
    const schema = (send as unknown as { input_schema: { properties: Record<string, { enum?: string[] }> } }).input_schema
    expect(schema.properties.from?.enum).toEqual(['contact', 'noreply'])
  })

  it('with no mailbox assigned the colleague gets no sending tools at all', async () => {
    const noBox = { ...salesman, mailboxes: [] } satisfies SessionUser
    const tools = (await buildAllAssistantTools(toolCtx(noBox))).map((t) => t.name)
    expect(tools).toContain('read_email')
    for (const absent of ['send_email', 'reply_to_email_thread', 'forward_email', 'create_email_draft']) {
      expect(tools, `${absent} nu are de unde alege identitate`).not.toContain(absent)
    }
  })

  it('calling run() on a confirm tool never touches the real service — only registers the pending action', async () => {
    const captured: Array<{ toolName: string; toolInput: unknown }> = []
    const tools = await buildAssistantTools({
      onConfirmRequired: (p) => captured.push({ toolName: p.toolName, toolInput: p.toolInput }),
      conversationId: 'test-conversation',
      user: admin,
    })
    const issueInvoiceTool = tools.find((t) => 'name' in t && t.name === 'issue_invoice')
    expect(issueInvoiceTool).toBeDefined()

    // ID inexistent — dacă run() ar executa efectiv issueInvoice(), asta ar arunca
    // ("Factura inexistentă" sau similar). Nicio eroare aici = confirmă că nu s-a atins DB-ul.
    const result = await issueInvoiceTool!.run({ id: '00000000-0000-0000-0000-000000000000' })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toEqual({ toolName: 'issue_invoice', toolInput: { id: '00000000-0000-0000-0000-000000000000' } })
    expect(String(result)).toMatch(/așteaptă confirmarea/)
  })

  it('auto tools are NOT present in CONFIRM_TOOL_NAMES (spot check)', () => {
    for (const readOnly of ['list_platforms', 'list_invoices', 'create_calendar_event']) {
      expect(CONFIRM_TOOL_NAMES.has(readOnly)).toBe(false)
    }
  })
})
