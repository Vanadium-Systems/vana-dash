import { z } from 'zod/v4'
import * as platformsService from '../../platforms/service.js'
import { autoTool } from './shared.js'

export function buildPlatformsTools() {
  return [
    autoTool({
      name: 'list_platforms',
      inputSchema: z.object({}),
      description: 'Listează toate platformele conectate (vanagreen etc.) cu status de sănătate.',
      run: () => platformsService.listPlatforms(),
    }),
    autoTool({
      name: 'get_platform',
      inputSchema: z.object({ id: z.string() }),
      description: 'Detalii despre o platformă specifică.',
      run: (a) => platformsService.getPlatform(a.id),
    }),
    autoTool({
      name: 'list_sync_log',
      inputSchema: z.object({ platformId: z.string(), limit: z.number().int().positive().optional() }),
      description: 'Istoricul rulărilor de sync pentru o platformă.',
      run: (a) => platformsService.listSyncLog(a.platformId, a.limit),
    }),
    // NU expunem create_platform — necesită apiKey în input, iar un secret nu trebuie să
    // tranziteze niciodată printr-un mesaj de chat (ajunge la Anthropic + persistat în
    // assistant_messages). Adăugarea unei platforme noi rămâne strict din UI (vezi
    // PLAN_INAPP_AGENT.md, regula CLAUDE.md #8 — API keys niciodată expuse).
    autoTool({
      name: 'update_platform',
      inputSchema: z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        apiUrl: z.string().url().optional(),
        syncCron: z.string().min(1).optional(),
      }),
      description: 'Editează o platformă existentă (nu poate schimba apiKey — asta rămâne strict din UI).',
      run: ({ id, ...rest }) => platformsService.updatePlatform(id, rest),
    }),
    autoTool({
      name: 'delete_platform',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge (soft-delete, reversibil) o platformă.',
      run: (a) => platformsService.softDeletePlatform(a.id),
    }),
  ]
}
