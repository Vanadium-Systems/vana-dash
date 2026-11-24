import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Select } from '@/shared/components/ui/select'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import { errorCode, toastError } from '@/shared/lib/errors'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useContractNumbers, useContractSeries, type NumberItem } from './contracts-api'

const KIND_LABEL: Record<NumberItem['kind'], () => string> = {
  used: () => t('accounting:contracts.numbers.used'),
  reserved: () => t('accounting:contracts.numbers.reserved'),
  free: () => t('accounting:contracts.numbers.free'),
}

function ReserveDialog({ seriesId, fixedNumber, open, onOpenChange }: { seriesId: string; fixedNumber: number | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [number, setNumber] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ number?: string; note?: string }>({})

  useEffect(() => {
    if (!open) return
    setNumber(fixedNumber ? String(fixedNumber) : '')
    setNote('')
    setErrors({})
  }, [open, fixedNumber])

  const reserve = useMutation({
    mutationFn: (body: { seriesId: string; number: number; note: string }) => api.post('/api/contracts/numbers/reservations', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      toast.success(t('accounting:contracts.numbers.reserveDone'))
      onOpenChange(false)
    },
    onError: (err) => {
      if (errorCode(err) === 'CONTRACT_NUMBER_TAKEN') setErrors({ number: t('accounting:contracts.numbers.taken') })
      else toastError(err)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    const parsed = /^\d{1,6}$/.test(number.trim()) ? Number(number.trim()) : 0
    if (parsed < 1) next.number = t('accounting:contracts.numbers.digitsOnly')
    if (!note.trim()) next.note = t('accounting:contracts.numbers.noteRequired')
    setErrors(next)
    if (next.number || next.note) return
    reserve.mutate({ seriesId, number: parsed, note: note.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{fixedNumber ? t('accounting:contracts.numbers.reserveTitleFixed', { number: fixedNumber }) : t('accounting:contracts.numbers.reserveTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          {fixedNumber ? null : (
            <Field label={t('common:labels.number')} error={errors.number}>
              <Input id="reserve-number" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
          )}
          <Field label={t('accounting:contracts.numbers.whatFor')} error={errors.note}>
            <Input id="reserve-note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={reserve.isPending}>
              {t('accounting:contracts.numbers.reserve')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The numbers of one series, newest first: what is used, what someone reserved, and the gaps still free. */
export function ContractNumbersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [seriesId, setSeriesId] = useState<string | null>(null)
  const [reserving, setReserving] = useState<{ number: number | null } | null>(null)
  const series = useContractSeries(open)
  const numbers = useContractNumbers(seriesId, open)

  const release = useMutation({
    mutationFn: (reservationId: string) => api.delete(`/api/contracts/numbers/reservations/${reservationId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      toast.success(t('accounting:contracts.numbers.released'))
    },
    onError: (err) => toastError(err),
  })

  const list = numbers.data
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('accounting:contracts.numbers.title')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-0.5">
              {list?.nextLabel ? <p className="text-sm font-medium">{t('accounting:contracts.numbers.next', { label: list.nextLabel })}</p> : null}
              <p className="text-xs text-muted-foreground">{t('accounting:contracts.numbers.hint')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(series.data?.length ?? 0) > 1 ? (
                <Select aria-label={t('accounting:contracts.numbers.series')} value={seriesId ?? list?.series?.id ?? ''} onChange={(e) => setSeriesId(e.target.value)}>
                  {series.data!.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Button type="button" variant="outline" disabled={!list?.series} onClick={() => setReserving({ number: null })}>
                {t('accounting:contracts.numbers.reserveOther')}
              </Button>
            </div>
          </div>

          {numbers.isPending ? (
            <ListSkeleton rows={6} />
          ) : numbers.isError ? (
            <EmptyState kind="filtered" title={t('accounting:contracts.numbers.loadFailed')} onReset={() => void numbers.refetch()} />
          ) : list!.items.length === 0 ? (
            <EmptyState kind="new" title={t('accounting:contracts.numbers.empty')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.number')}</TableHead>
                  <TableHead>{t('common:labels.state')}</TableHead>
                  <TableHead>{t('accounting:contracts.numbers.partyOrNote')}</TableHead>
                  <TableHead priority="md">{t('common:labels.date')}</TableHead>
                  <TableHead className="text-right">
                    <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list!.items.map((item) => {
                  const who = item.kind === 'reserved' ? item.note : item.counterpartyName
                  return (
                    <TableRow key={item.number}>
                      <TableCell className="whitespace-nowrap tabular-nums">{item.label}</TableCell>
                      <TableCell>
                        <StatePill tone={item.kind === 'free' ? 'neutral' : item.kind === 'reserved' ? 'warning' : 'success'}>{KIND_LABEL[item.kind]()}</StatePill>
                      </TableCell>
                      <TableCell className="tbl-fill">
                        <div className="truncate">{who ?? '—'}</div>
                        <TableDetails items={[item.date ? formatDate(item.date) : null]} />
                      </TableCell>
                      <TableCell priority="md" className="whitespace-nowrap text-muted-foreground">
                        {item.date ? formatDate(item.date) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.kind === 'free' ? (
                          <RowActions actions={[{ key: 'reserve', icon: Lock, label: t('accounting:contracts.numbers.reserve'), onClick: () => setReserving({ number: item.number }) }]} />
                        ) : item.kind === 'reserved' && item.reservationId ? (
                          <RowActions actions={[{ key: 'release', icon: X, label: t('accounting:contracts.numbers.release'), disabled: release.isPending, onClick: () => release.mutate(item.reservationId!) }]} />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
        {list?.series ? <ReserveDialog seriesId={list.series.id} fixedNumber={reserving?.number ?? null} open={reserving !== null} onOpenChange={(next) => !next && setReserving(null)} /> : null}
      </DialogContent>
    </Dialog>
  )
}
