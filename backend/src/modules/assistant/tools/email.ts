import { z } from 'zod/v4'
import * as emailService from '../../email/service.js'
import * as inboundService from '../../email/inbound-service.js'
import * as draftsService from '../../email/drafts-service.js'
import { selectableIdentities } from '../../email/mailboxes.js'
import { getIdentities } from '../../email/settings-service.js'
import type { SessionUser } from '../../../shared/lib/session.js'
import { autoTool, confirmTool, type ToolBuildContext } from './shared.js'

/** Cheile identităților pe care omul le poate alege — listă nevidă, altfel z.enum() nu se construiește. */
function fromKeyEnum(keys: string[]) {
  return z.enum(keys as [string, ...string[]])
}

export async function buildEmailTools(ctx: ToolBuildContext) {
  const identities = selectableIdentities(ctx.user, await getIdentities())
  // Fără nicio cutie atribuită, omul nu scrie de pe nimic: tool-urile de trimitere nu intră în
  // listă (modelul nu are de unde alege o identitate, iar o trimitere ar da 403 la orice încercare).
  if (identities.length === 0) {
    return [
      autoTool({
        name: 'list_emails',
        inputSchema: z.object({
          folder: z.enum(['inbox', 'archive', 'trash', 'spam', 'all']).optional(),
          q: z.string().optional(),
          isStarred: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        }),
        description: 'Listă thread-uri de email (inbox/arhivă/spam etc.), cu căutare opțională.',
        run: (a) => inboundService.listThreads(ctx.user, { sort: 'date_desc', limit: 50, offset: 0, ...a } as never),
      }),
      autoTool({
        name: 'read_email',
        inputSchema: z.object({ threadId: z.string() }),
        description: 'Citește un thread de email complet, cu toate mesajele din el.',
        run: (a) => inboundService.getThreadWithMessages(ctx.user, a.threadId),
      }),
    ]
  }
  const fromKey = fromKeyEnum(identities.map((i) => i.key))
  const mailboxNote = `Identitățile disponibile: ${identities.map((i) => `${i.key} (${i.fromAddress})`).join(', ')}.`

  return [
    autoTool({
      name: 'list_emails',
      inputSchema: z.object({
        folder: z.enum(['inbox', 'archive', 'trash', 'spam', 'all']).optional(),
        q: z.string().optional(),
        isStarred: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      description: 'Listă thread-uri de email (inbox/arhivă/spam etc.), cu căutare opțională.',
      run: (a) => inboundService.listThreads(ctx.user, { sort: 'date_desc', limit: 50, offset: 0, ...a } as never),
    }),
    autoTool({
      name: 'read_email',
      inputSchema: z.object({ threadId: z.string() }),
      description: 'Citește un thread de email complet, cu toate mesajele din el.',
      run: (a) => inboundService.getThreadWithMessages(ctx.user, a.threadId),
    }),
    autoTool({
      name: 'list_email_templates',
      inputSchema: z.object({}),
      description: 'Listă template-uri de email salvate.',
      run: () => emailService.listTemplates(),
    }),
    autoTool({
      name: 'create_email_draft',
      inputSchema: z.object({
        fromKey: fromKey.describe('Identitatea de pe care se salvează ciorna'),
        to: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
        templateId: z.string().optional(),
      }),
      description: `Salvează un draft de email (nu trimite nimic). Reversibil, intern. ${mailboxNote}`,
      run: (a) => draftsService.createDraft(ctx.user, a as never),
    }),
    autoTool({
      name: 'update_email_message_flags',
      inputSchema: z.object({
        id: z.string(),
        isRead: z.boolean().optional(),
        isStarred: z.boolean().optional(),
        folder: z.enum(['inbox', 'archive', 'trash', 'spam']).optional(),
      }),
      description: 'Marchează un mesaj citit/necitit, starred, sau îl mută în alt folder (arhivă/spam/coș).',
      run: ({ id, ...rest }) => inboundService.patchMessage(ctx.user, id, rest),
    }),

    confirmTool(ctx, {
      name: 'send_email',
      inputSchema: z.object({
        to: z.string(),
        subject: z.string().min(1),
        body: z.string().min(1),
        from: fromKey.optional().describe('Identitatea de pe care se trimite'),
        templateId: z.string().optional(),
      }),
      description: `Trimite un email nou (1:1). Ireversibil — ajunge la un terț, nu poate fi retras. ${mailboxNote}`,
      summarize: (a) => `Trimite email către ${a.to}, de pe ${a.from ?? 'prima identitate'}, subiect: "${a.subject}".`,
    }),
    confirmTool(ctx, {
      name: 'reply_to_email_thread',
      inputSchema: z.object({ threadId: z.string(), body: z.string().min(1) }),
      description: 'Răspunde la un thread de email existent. Ireversibil — ajunge la un terț.',
      summarize: (a) => `Răspunde la thread-ul ${a.threadId}: "${a.body.slice(0, 120)}${a.body.length > 120 ? '…' : ''}"`,
    }),
    confirmTool(ctx, {
      name: 'forward_email',
      inputSchema: z.object({ messageId: z.string(), to: z.string(), extraBody: z.string().optional() }),
      description: 'Redirecționează un mesaj primit către o altă adresă. Ireversibil — ajunge la un terț.',
      summarize: (a) => `Redirecționează mesajul ${a.messageId} către ${a.to}.`,
    }),
  ]
}

/**
 * Executorii primesc omul în context: o acțiune confirmată rulează cu drepturile autorului
 * (C2) și cu cutiile lui, nu cu ale unui sistem fără persoană.
 */
export const emailConfirmExecutors: Record<
  string,
  (input: never, ctx: { conversationId: string; user: SessionUser }) => Promise<unknown>
> = {
  // Fără `from` explicit, executorul trimite de pe prima cutie a omului — nu de pe `stefan@`,
  // care nu e a lui. Cheia aleasă de model e oricum validată de `assertCanSendFrom` în service.
  send_email: (input: { to: string; subject: string; body: string; from?: string; templateId?: string }, ctx) =>
    emailService.sendSingle(ctx.user, { ...input, from: input.from ?? ctx.user.mailboxes?.[0] ?? 'stefan' } as never),
  reply_to_email_thread: (input: { threadId: string; body: string }, ctx) =>
    inboundService.replyToThread(ctx.user, input.threadId, input.body),
  forward_email: (input: { messageId: string; to: string; extraBody?: string }, ctx) =>
    inboundService.forwardMessage(ctx.user, input.messageId, {
      to: input.to,
      extraBody: input.extraBody,
      includeOriginalAttachments: false,
    }),
}
