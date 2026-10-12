import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { ChartError } from '@/shared/components/charts/chart-states'
import { api } from '@/shared/lib/api'
import type { SpvMessage } from '@/shared/lib/types'
import { formatDate } from './badges'

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
      toast.success('Mesaj salvat — rămâne la noi chiar dacă dispare din SPV')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardContent className="pt-6">
        {messages.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : messages.isError ? (
          <ChartError message="Nu am putut încărca mesajele SPV" />
        ) : !messages.data?.length ? (
          <p className="text-sm text-muted-foreground">
            Niciun mesaj SPV în ultimele {DAYS} de zile (sau ești pe mediul de test ANAF — mesajele reale sunt doar
            pe producție).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead>Detalii</TableHead>
                <TableHead>CIF</TableHead>
                <TableHead className="text-right">Salvare</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(m.createdAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.type}</TableCell>
                  <TableCell>{m.detail}</TableCell>
                  <TableCell className="font-mono text-xs">{m.cif}</TableCell>
                  <TableCell className="text-right">
                    {m.saved ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5" /> Salvat
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        disabled={save.isPending}
                        onClick={() => save.mutate(m)}
                        title="Salvează — rămâne la noi chiar dacă ANAF șterge mesajul"
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
