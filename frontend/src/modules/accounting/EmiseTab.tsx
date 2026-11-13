import { Archive, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'
import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'
import { PastRecordFormDialog } from './PastRecordFormDialog'
import { RecordsList } from './RecordsList'

export function EmiseTab() {
  // Emitting, editing and sending to ANAF are three different features; the list itself asks for none of them.
  const canIssue = useMe().can('facturi.emitere')
  const navigate = useNavigate()
  const [pastDialogOpen, setPastDialogOpen] = useState(false)
  const create = () => navigate('/accounting/invoices/new')
  useConsumeParam('new', create)

  return (
    <div className="space-y-4">
      {canIssue ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setPastDialogOpen(true)}>
            <Archive className="h-4 w-4" /> {t('accounting:issued.oldRecord')}
          </Button>
          <Button onClick={create}>
            <Plus className="h-4 w-4" /> {t('accounting:editor.titleNewInvoice')}
          </Button>
        </div>
      ) : null}
      <RecordsList direction="out" onCreate={create} />
      <PastRecordFormDialog open={pastDialogOpen} onOpenChange={setPastDialogOpen} direction="out" />
    </div>
  )
}
