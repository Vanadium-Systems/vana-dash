import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool'
import type { z } from 'zod/v4'
import type { SessionUser } from '../../../shared/lib/session.js'
import { userName } from '../../../shared/lib/session.js'

// SDK-ul cere schema din 'zod/v4' pt. betaZodTool — nu schemele din 'zod' (v3 clasic) folosite
// deja pe rutele REST existente. Tool-urile de mai jos redeclară inputul minim necesar per tool
// (nu reutilizează instanța de schema v3), dar oglindesc câmpurile schemelor v3 corespunzătoare.

export interface PendingConfirmation {
  toolUseId: string
  toolName: string
  toolInput: unknown
  summary: string
}

export interface ToolBuildContext {
  // Apelat de un tool din categoria "confirm" în loc să execute acțiunea reală.
  onConfirmRequired: (pending: PendingConfirmation) => void
  // Conversația curentă — necesară pt. tool-urile care ancorează rezultatul în ea
  // (schedule_report rulează promptul tot aici la momentul programat).
  conversationId: string
  /** Omul din sesiune, cu funcționalitățile lui (C2). Tool-urile de email îi respectă
   *  cutiile; lista de tool-uri se filtrează pe funcționalități în `buildAssistantTools`. */
  user: SessionUser
}

// Tool auto-execută: `run` apelează direct funcția de service și întoarce rezultatul ca text.
export function autoTool<Schema extends z.ZodType>(options: {
  name: string
  inputSchema: Schema
  description: string
  run: (args: z.infer<Schema>) => Promise<unknown>
}): BetaRunnableTool<z.infer<Schema>> {
  return betaZodTool({
    name: options.name,
    inputSchema: options.inputSchema,
    description: options.description,
    run: async (args) => JSON.stringify(await options.run(args)),
  })
}

// Tool "confirm": `run` NU execută acțiunea — o înregistrează prin `ctx.onConfirmRequired` și
// întoarce un tool_result care spune lui Claude să aștepte, nu să repete apelul. Executorul real
// (`execute`) e apelat separat, din `POST /api/assistant/actions/:id/confirm`.
export function confirmTool<Schema extends z.ZodType>(
  ctx: ToolBuildContext,
  options: {
    name: string
    inputSchema: Schema
    description: string
    summarize: (args: z.infer<Schema>) => string | Promise<string>
  },
): BetaRunnableTool<z.infer<Schema>> {
  const nume = userName(ctx.user)
  return betaZodTool({
    name: options.name,
    inputSchema: options.inputSchema,
    description: `${options.description} IMPORTANT: acțiune care necesită confirmarea explicită a lui ${nume} — apelarea acestui tool doar înregistrează acțiunea propusă, nu o execută. Nu repeta apelul.`,
    run: async (args, context) => {
      ctx.onConfirmRequired({
        toolUseId: context?.toolUse?.id ?? '',
        toolName: options.name,
        toolInput: args,
        summary: await options.summarize(args),
      })
      return `Acțiune înregistrată, așteaptă confirmarea lui ${nume}. Nu repeta acest apel — anunță-l în text că ai pregătit acțiunea și aștepți aprobarea.`
    },
  })
}
