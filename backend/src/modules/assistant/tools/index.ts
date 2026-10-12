import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool'
import type { ToolBuildContext } from './shared.js'
import { buildPlatformsTools } from './platforms.js'
import { buildMetricsTools } from './metrics.js'
import { buildFinancialsTools } from './financials.js'
import { buildAccountingTools } from './accounting.js'
import { buildInvoicingTools, invoicingConfirmExecutors } from './invoicing.js'
import { buildReconciliationTools, reconciliationConfirmExecutors } from './reconciliation.js'
import { buildAlertsTools } from './alerts.js'
import { buildReportsTools } from './reports.js'
import { buildProspectsTools, prospectsConfirmExecutors } from './prospects.js'
import { buildEmailTools, emailConfirmExecutors } from './email.js'
import { buildCalendarTools } from './calendar.js'
import { buildArchiveTools, archiveConfirmExecutors } from './archive.js'
import { buildNotesTools } from './notes.js'
import { buildWishlistTools, wishlistConfirmExecutors } from './wishlist.js'
import { buildPricingTools } from './pricing.js'
import { buildScheduledTools, scheduledConfirmExecutors } from './scheduled.js'
import { buildCryptoTools, cryptoConfirmExecutors } from './crypto.js'
import { buildAssetsTools, assetsConfirmExecutors } from './assets.js'

import type { SessionUser } from '../../../shared/lib/session.js'
import { canUseTool } from './tool-features.js'

export type { PendingConfirmation, ToolBuildContext } from './shared.js'
export { TOOL_FEATURES, toolFeature } from './tool-features.js'

// Registrul complet al tool-urilor whitelist-ate — vezi PLAN_INAPP_AGENT.md pt. lista completă
// și motivul fiecărei categorii (auto/confirm/exclus). NU exportăm nimic care ar putea apela
// sendInvoiceToAnaf() — ea nu are nici măcar un wrapper de tool.
// Lista se filtrează pe funcționalitățile omului (`tool-features.ts`): asistentul apelează
// servicii direct și nu trece prin guard-ul de pe rute, deci asta e singura poartă.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- array eterogen de tool-uri cu Input diferit per tool, `any` e cerut de BetaRunnableTool<Input>
type ToolList = BetaRunnableTool<any>[]

export async function buildAssistantTools(ctx: ToolBuildContext): Promise<ToolList> {
  return (await buildAllAssistantTools(ctx)).filter((tool) => canUseTool(tool.name, ctx.user.features))
}

/** Registrul nefiltrat — pentru testul de completitudine al mapării tool → funcționalitate
 *  (`gating.test.ts`), care trebuie să vadă și tool-urile scoase de pe lista unui coleg. */
export async function buildAllAssistantTools(ctx: ToolBuildContext): Promise<ToolList> {
  return [
    ...buildPlatformsTools(),
    ...buildMetricsTools(),
    ...buildFinancialsTools(),
    ...buildAccountingTools(),
    ...buildInvoicingTools(ctx),
    ...buildReconciliationTools(ctx),
    ...buildAlertsTools(),
    ...buildReportsTools(),
    ...buildProspectsTools(ctx),
    ...(await buildEmailTools(ctx)),
    ...buildCalendarTools(ctx),
    ...buildArchiveTools(ctx),
    ...buildNotesTools(ctx),
    ...buildWishlistTools(ctx),
    ...buildPricingTools(),
    ...buildScheduledTools(ctx),
    ...buildCryptoTools(ctx),
    ...buildAssetsTools(ctx),
  ]
}

// Dispatch pt. POST /api/assistant/actions/:id/confirm — singurul loc unde acțiunile din
// categoria "confirm" chiar se execută. Executorii primesc (input, { conversationId }) —
// context injectat din assistant_pending_actions.
export const confirmExecutors: Record<
  string,
  (input: never, ctx: { conversationId: string; user: SessionUser }) => Promise<unknown>
> = {
  ...invoicingConfirmExecutors,
  ...reconciliationConfirmExecutors,
  ...prospectsConfirmExecutors,
  ...emailConfirmExecutors,
  ...archiveConfirmExecutors,
  ...wishlistConfirmExecutors,
  ...scheduledConfirmExecutors,
  ...cryptoConfirmExecutors,
  ...assetsConfirmExecutors,
}

export const CONFIRM_TOOL_NAMES = new Set(Object.keys(confirmExecutors))
