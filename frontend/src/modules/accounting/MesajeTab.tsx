import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { ChartError } from '@/shared/components/charts/chart-states'
import { api } from '@/shared/lib/api'
import type { SpvMessage } from '@/shared/lib/types'
import { formatDate } from './badges'
import { t } from '@/shared/lib/i18n'

const DAYS = 30

export function MesajeTab() {
  const queryClient = useQueryClient()
  const messages = useQuery({
    queryKey: ['accounting', 'spv-messages', DAYS],
    queryFn: () => api.get<SpvMessage[]>(`/api/accounting/anaf/spv-messages?days=${DAYS}`),
  })

  const save = useMutation({
    mutationFn: (m: SpvMessage) =>
      api.post(`/api/accounting/anaf/spv-messages/${m.id}/save`, {
        type: m.type,
        detail: m.detail,
        cif: m.cif,
        createdAt: m.createdAt,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounting', 'spv-messages'] })
      toast.success(t('accounting:spv.saved'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardContent className="pt-6">
        {messages.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : messages.isError ? (
          <ChartError message={t('accounting:spv.loadFailed')} />
        ) : !messages.data?.length ? (
          <p className="text-sm text-muted-foreground">
            {t('accounting:spv.empty', { DAYS })}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead priority="md">{t('common:labels.date')}</TableHead>
                <TableHead priority="lg">{t('common:labels.type')}</TableHead>
                <TableHead>{t('common:labels.details')}</TableHead>
                <TableHead priority="lg">{t('common:labels.cif')}</TableHead>
                <TableHead className="text-right">{t('accounting:spv.saving')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell priority="md" className="whitespace-nowrap">{formatDate(m.createdAt)}</TableCell>
                  <TableCell priority="lg" className="text-xs text-muted-foreground">{m.type}</TableCell>
                  <TableCell className="break-words tbl-fill">
                    {m.detail}
                    <TableDetails items={[formatDate(m.createdAt), m.type]} />
                  </TableCell>
                  <TableCell priority="lg" className="font-mono text-xs">{m.cif}</TableCell>
                  <TableCell className="text-right">
                    {m.saved ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5" /> {t('common:states.saved')}
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        disabled={save.isPending}
                        onClick={() => save.mutate(m)}
                        title={t('accounting:spv.saveHint')}
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
