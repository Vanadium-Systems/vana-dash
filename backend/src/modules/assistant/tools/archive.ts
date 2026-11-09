import { z } from 'zod/v4'
import * as archiveService from '../../archive/service.js'
import * as archiveTrash from '../../archive/trash.js'
import type { SessionUser } from '../../../shared/lib/session.js'
import { autoTool, confirmTool, type ToolBuildContext } from './shared.js'

// Arhivă cu spații per om (PLAN.md C2): tool-urile primesc omul din `ctx.user`, deci listează
// și caută doar în spațiile la care are acces, iar crearea/mutarea intră în spațiul lui.
export function buildArchiveTools(ctx: ToolBuildContext) {
  const user = ctx.user
  return [
    autoTool({
      name: 'list_archive_folders',
      inputSchema: z.object({ parentId: z.string().optional() }),
      description: 'Listă foldere din Arhivă (fără parentId = rădăcina spațiului tău).',
      run: (a) => archiveService.listFolders(user, a.parentId, 'name'),
    }),
    autoTool({
      name: 'list_archive_files',
      inputSchema: z.object({ folderId: z.string().optional(), q: z.string().optional(), page: z.number().int().min(1).optional() }),
      description: 'Listă fișiere dintr-un folder al Arhivei.',
      run: (a) => archiveService.listFiles(user, { ...a, page: a.page ?? 1 }),
    }),
    autoTool({
      name: 'search_archive_files',
      inputSchema: z.object({ q: z.string().min(1), tags: z.string().optional() }),
      description: 'Caută fișiere în Arhiva ta după nume/tag-uri.',
      run: (a) => archiveService.searchFiles(user, a.q, a.tags),
    }),
    autoTool({
      name: 'get_archive_storage_usage',
      inputSchema: z.object({}),
      description: 'Spațiu de stocare folosit de spațiul tău din Arhivă (R2).',
      run: () => archiveService.getStorageUsage(user),
    }),
    autoTool({
      name: 'create_archive_folder',
      inputSchema: z.object({ name: z.string().min(1), parentId: z.string().optional() }),
      description: 'Creează un folder nou în spațiul tău din Arhivă. Reversibil.',
      run: (a) => archiveService.createFolder(user, a.name, a.parentId),
    }),
    autoTool({
      name: 'update_archive_folder',
      inputSchema: z.object({ id: z.string(), name: z.string().min(1).optional(), parentId: z.string().nullable().optional() }),
      description: 'Redenumează/mută un folder din Arhivă.',
      run: ({ id, ...rest }) => archiveService.updateFolder(user, id, rest as never),
    }),
    autoTool({
      name: 'delete_archive_folder',
      inputSchema: z.object({ id: z.string() }),
      description: 'Mută un folder din Arhivă în Coș, cu tot conținutul (se poate restaura 30 de zile).',
      run: (a) => archiveTrash.trashFolder(user, a.id),
    }),
    autoTool({
      name: 'update_archive_file',
      inputSchema: z.object({ id: z.string(), name: z.string().min(1).optional(), folderId: z.string().optional(), tags: z.array(z.string()).optional() }),
      description: 'Redenumează/mută/etichetează un fișier din Arhivă.',
      run: ({ id, ...rest }) => archiveService.updateFile(user, id, rest),
    }),
    autoTool({
      name: 'delete_archive_file',
      inputSchema: z.object({ id: z.string() }),
      description: 'Mută un fișier din Arhivă în Coș (se poate restaura 30 de zile).',
      run: (a) => archiveTrash.trashFile(user, a.id),
    }),

    confirmTool(ctx, {
      name: 'permanently_delete_archive_file',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge PERMANENT un fișier din Arhivă (din R2 și din DB). Ireversibil — fără recuperare.',
      summarize: (a) => `Șterge PERMANENT (fără recuperare) fișierul ${a.id} din Arhivă — inclusiv din stocarea R2.`,
    }),
  ]
}

export const archiveConfirmExecutors: Record<
  string,
  (input: never, ctx: { conversationId: string; user: SessionUser }) => Promise<unknown>
> = {
  // Confirmed by the person in the chat: through the Trash, then purged right away.
  permanently_delete_archive_file: async (input: { id: string }, ctx) => {
    const { batchId } = await archiveTrash.trashFile(ctx.user, input.id)
    return archiveTrash.purgeBatchNow(ctx.user, batchId)
  },
}