import { Mic } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/lib/i18n'
import { VoiceRecorder } from './VoiceRecorder'

/** Optional voice note after a call's outcome, tied to the call task. `onBusyChange` stops the session from moving on over an unsaved take. */
export function CallVoiceNote({ prospectId, taskId, onBusyChange }: { prospectId: string; taskId: string; onBusyChange: (busy: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  if (saved) return <p className="text-sm text-muted-foreground">{t('clients:voice.callSaved')}</p>
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Mic aria-hidden="true" /> {t('clients:voice.callNote')}
      </Button>
    )
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t('clients:voice.callNote')}</h3>
      <VoiceRecorder
        prospectId={prospectId}
        taskId={taskId}
        onBusyChange={onBusyChange}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setSaved(true)
          setOpen(false)
        }}
      />
    </div>
  )
}
