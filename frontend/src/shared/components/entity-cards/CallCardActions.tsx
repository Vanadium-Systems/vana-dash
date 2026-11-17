import { PhoneCall } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { saveCallKey } from '@/modules/calls/call-keys'
import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/lib/i18n'
import type { ChatMessageRef } from '@/shared/lib/types'

export function CallCardActions({ refItem, callKey }: { refItem: ChatMessageRef; callKey?: string }) {
  const navigate = useNavigate()
  const isOpen = refItem.card.status === 'open'
  if (!refItem.canOpen || !refItem.refId || !isOpen) return null

  const callId = refItem.refId
  function join() {
    if (callKey) saveCallKey(callId, callKey)
    navigate(callKey ? `/calls/${callId}#k=${encodeURIComponent(callKey)}` : `/calls/${callId}`)
  }

  return (
    <div className="mt-1.5">
      <Button type="button" size="sm" onClick={join}>
        <PhoneCall className="h-3.5 w-3.5" />
        {t('calls:actions.join')}
      </Button>
    </div>
  )
}
