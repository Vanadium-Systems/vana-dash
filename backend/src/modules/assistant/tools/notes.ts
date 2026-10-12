import { z } from 'zod/v4'
import * as notesService from '../../notes/service.js'
import { autoTool, type ToolBuildContext } from './shared.js'

export function buildNotesTools(ctx: ToolBuildContext) {
  return [
    autoTool({
      name: 'list_notes',
      inputSchema: z.object({ search: z.string().optional(), pinned: z.boolean().optional() }),
      description: 'Listă notițe rapide, cu căutare/filtru pinned opțional.',
      run: (a) => notesService.listNotes(ctx.user, a as never),
    }),
    autoTool({
      name: 'create_note',
      inputSchema: z.object({ title: z.string().min(1), body: z.string().optional() }),
      description: 'Creează o notiță nouă. Reversibil.',
      run: (a) => notesService.createNote(ctx.user, a as never),
    }),
    autoTool({
      name: 'update_note',
      inputSchema: z.object({ id: z.string(), title: z.string().min(1).optional(), body: z.string().optional(), pinned: z.boolean().optional() }),
      description: 'Editează o notiță existentă (inclusiv pin/unpin).',
      run: ({ id, ...rest }) => notesService.updateNote(ctx.user, id, rest as never),
    }),
    autoTool({
      name: 'delete_note',
      inputSchema: z.object({ id: z.string() }),
      description: 'Șterge o notiță.',
      run: (a) => notesService.deleteNote(ctx.user, a.id),
    }),
  ]
}
