import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { api } from '@/shared/lib/api'
import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'
import { PastRecordFormDialog } from './PastRecordFormDialog'
import { RecordsList } from './RecordsList'
import { RecurringExpensesSection } from './RecurringExpensesSection'

export function PrimiteTab() {
  const queryClient = useQueryClient()
  const [pastDialogOpen, setPastDialogOpen] = useState(false)
  // Each part needs its own feature: a colleague who only records invoices must not hit a 403 here.
  const { can } = useMe()

  const syncAnaf = useMutation({
    mutationFn: () => api.post<{ imported: number }>('/api/accounting/anaf/sync'),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success(t('accounting:received.syncDone', { imported: data.imported }))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {can('facturi.emitere') ? (
          <Button variant="outline" onClick={() => setPastDialogOpen(true)}>
            <Plus className="h-4 w-4" /> {t('accounting:received.addExpense')}
          </Button>
        ) : null}
        {can('facturi.anaf') ? (
          <Button variant="outline" disabled={syncAnaf.isPending} onClick={() => syncAnaf.mutate()}>
            <RefreshCw className={syncAnaf.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> {t('accounting:received.syncNow')}
          </Button>
        ) : null}
      </div>
      <RecordsList direction="in" />
      {can('facturi.cheltuieli') ? <RecurringExpensesSection /> : null}
      <PastRecordFormDialog open={pastDialogOpen} onOpenChange={setPastDialogOpen} direction="in" />
    </div>
  )
}
