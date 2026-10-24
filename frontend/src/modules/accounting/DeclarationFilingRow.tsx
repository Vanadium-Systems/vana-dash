import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { DeclarationPreview } from '@/shared/lib/types'
import { formatDate } from './badges'

// The index ANAF shows after the upload to SPV. There is no API to read it back, so it is typed
// in here; a month with an index counts as filed and its deadline alert stops.
export function DeclarationFilingRow({
  endpoint,
  month,
  filing,
}: {
  endpoint: 'd301' | 'd390'
  month: string
  filing: DeclarationPreview['filing']
}) {
  const queryClient = useQueryClient()
  const [anafIndex, setAnafIndex] = useState(filing?.anafIndex ?? '')
  const inputId = `${endpoint}-anaf-index`

  useEffect(() => setAnafIndex(filing?.anafIndex ?? ''), [filing?.anafIndex, month])

  const save = useMutation({
    mutationFn: () => api.put(`/api/accounting/${endpoint}/filing`, { month, anafIndex }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', endpoint, month] })
      toast.success(t('accounting:declarations.filing.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (anafIndex.trim()) save.mutate()
      }}
    >
      <Label htmlFor={inputId} className="text-sm">
        {t('accounting:declarations.filing.label')}
      </Label>
      <Input id={inputId} value={anafIndex} onChange={(e) => setAnafIndex(e.target.value)} inputMode="numeric" className="w-40" maxLength={30} />
      <Button type="submit" variant="outline" disabled={save.isPending || !anafIndex.trim() || anafIndex.trim() === filing?.anafIndex}>
        {t('common:actions.save')}
      </Button>
      <span className="text-sm text-muted-foreground">
        {!filing
          ? t('accounting:declarations.filing.notFiled')
          : filing.confirmedAt
            ? t('accounting:declarations.filing.confirmedOn', { date: formatDate(filing.confirmedAt) })
            : t('accounting:declarations.filing.awaitingReceipt', { date: formatDate(filing.filedAt) })}
      </span>
    </form>
  )
}
