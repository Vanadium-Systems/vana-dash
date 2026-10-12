import { Eye, MousePointerClick } from 'lucide-react'
import { StatePill } from '@/shared/components/ui/state-pill'
import type { EmailSend } from '@/shared/lib/types'

// 2026-08-11 — Stefan vrea să vadă cine deschide/dă click pe campanii ȘI cine s-a dezabonat, nu
// doar un status de livrare. Reutilizat în SentTab + BulkSendTab, ca reprezentarea să nu difere
// între tab-uri.
export function EngagementBadges({ send }: { send: Pick<EmailSend, 'openCount' | 'clickCount' | 'isSuppressed'> }) {
  if (send.openCount === 0 && send.clickCount === 0 && !send.isSuppressed) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {send.openCount > 0 ? (
        <span className="inline-flex items-center gap-1" title={`Deschis de ${send.openCount} ori`}>
          <Eye className="h-3.5 w-3.5" /> {send.openCount}
        </span>
      ) : null}
      {send.clickCount > 0 ? (
        <span className="inline-flex items-center gap-1" title={`Click de ${send.clickCount} ori`}>
          <MousePointerClick className="h-3.5 w-3.5" /> {send.clickCount}
        </span>
      ) : null}
      {send.isSuppressed ? <StatePill tone="warning">Dezabonat</StatePill> : null}
    </div>
  )
}
