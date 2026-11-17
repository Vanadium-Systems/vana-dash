import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { ChatMember, ChatReceipt } from '@/shared/lib/types'
import { ChatAvatar } from './ChatAvatar'

// Who has seen one of your messages and when (FE-M7). The time is when their read watermark last
// moved, so it is the moment they read up to this message or later, not a per-message receipt.

export function MessageInfoDialog({
  createdAt,
  members,
  receipts,
  meId,
  onClose,
}: {
  createdAt: string
  members: ChatMember[]
  receipts: ChatReceipt[]
  meId: string
  onClose: () => void
}) {
  const sent = Date.parse(createdAt)
  const reached = (at: string | null) => at !== null && Date.parse(at) >= sent
  const rows = members
    .filter((member) => member.id !== meId)
    .map((member) => {
      const receipt = receipts.find((r) => r.userId === member.id)
      const seen = reached(receipt?.readUpTo ?? null)
      return {
        member,
        state: seen
          ? receipt?.readAt
            ? t('messages:info.seenAt', { time: formatDateTime(receipt.readAt) })
            : t('messages:info.seenAt', { time: '' }).trim()
          : reached(receipt?.deliveredUpTo ?? null)
            ? t('messages:info.delivered')
            : t('messages:info.notSeen'),
        seen,
      }
    })
    // Seen first, as in WhatsApp's info screen.
    .sort((a, b) => Number(b.seen) - Number(a.seen))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="md:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('messages:info.title')}</DialogTitle>
          <DialogDescription>{t('messages:info.approx')}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {rows.map(({ member, state, seen }) => (
            <li key={member.id} className="flex items-center gap-3 py-2">
              <ChatAvatar userId={member.id} name={member.displayName ?? member.email} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm">{member.displayName ?? member.email}</span>
              <span className={seen ? 'text-sm' : 'text-sm text-muted-foreground'}>{state}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
