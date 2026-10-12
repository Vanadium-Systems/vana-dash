import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { ReservedContractNumber } from '@/shared/lib/types'
import { formatContractDate } from './ClientFormDialog'
import { t } from '@/shared/lib/i18n'

const RESERVED_NUMBERS_QUERY_KEY = ['contract-reserved-numbers']

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date())

export function ReservedNumbersCard() {
  const queryClient = useQueryClient()
  const [number, setNumber] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayIso)
  const [errors, setErrors] = useState<{ number?: string; note?: string }>({})

  const reserved = useQuery({
    queryKey: RESERVED_NUMBERS_QUERY_KEY,
    queryFn: () => api.get<ReservedContractNumber[]>('/api/contracts/reserved-numbers'),
  })

  const save = useMutation({
    mutationFn: (next: ReservedContractNumber[]) => api.put<ReservedContractNumber[]>('/api/contracts/reserved-numbers', next),
    onSuccess: (data) => queryClient.setQueryData(RESERVED_NUMBERS_QUERY_KEY, data),
    onError: (err) => toast.error(err.message),
  })

  const list = reserved.data ?? []

  const add = (e: FormEvent) => {
    e.preventDefault()
    const normalized = number.trim().padStart(3, '0')
    const next: typeof errors = {}
    if (!/^\d{1,4}$/.test(number.trim())) next.number = t('accounting:reserved.digitsOnly')
    else if (list.some((r) => r.number === normalized)) next.number = t('accounting:reserved.alreadyListed', { normalized })
    if (!note.trim()) next.note = t('accounting:reserved.reasonRequired')
    setErrors(next)
    if (next.number || next.note) return
    save.mutate([...list, { number: normalized, note: note.trim(), date: date || todayIso() }], {
      onSuccess: () => {
        setNumber('')
        setNote('')
      },
    })
  }

  const remove = (entry: ReservedContractNumber) => {
    save.mutate(
      list.filter((r) => r.number !== entry.number),
      {
        // Ștergerea e reversibilă, deci fără dialog: lista de dinainte se pune la loc din toast.
        onSuccess: () =>
          toast.success(t('accounting:reserved.released', { number: entry.number }), {
            action: { label: t('common:actions.cancel'), onClick: () => save.mutate(list) },
          }),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('accounting:reserved.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('accounting:reserved.hint')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {reserved.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : reserved.isError ? (
          <p className="text-sm text-destructive">{t('accounting:reserved.loadFailed')}</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('accounting:reserved.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{t('common:labels.number')}</TableHead>
                <TableHead>{t('accounting:reserved.whatFor')}</TableHead>
                <TableHead className="w-28">{t('common:labels.date')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.number}>
                  <TableCell className="tabular-nums">{r.number}</TableCell>
                  <TableCell className="break-words">{r.note}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{formatContractDate(r.date)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('accounting:reserved.remove', { number: r.number })}
                      disabled={save.isPending}
                      onClick={() => remove(r)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!reserved.isPending && !reserved.isError && (
          <form onSubmit={add} noValidate className="grid items-end gap-3 sm:grid-cols-[6rem_1fr_10rem_auto]">
            <div className="space-y-1">
              <Label htmlFor="reserved-number">{t('accounting:labels.number')}</Label>
              <Input
                id="reserved-number"
                inputMode="numeric"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                aria-invalid={Boolean(errors.number)}
                aria-describedby={errors.number ? 'reserved-number-error' : undefined}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reserved-note">{t('accounting:reserved.whatFor')}</Label>
              <Input
                id="reserved-note"
                maxLength={120}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-invalid={Boolean(errors.note)}
                aria-describedby={errors.note ? 'reserved-note-error' : undefined}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reserved-date">{t('common:labels.date')}</Label>
              <Input id="reserved-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Button type="submit" variant="outline" disabled={save.isPending}>
              {t('accounting:reserved.reserve')}
            </Button>
            {errors.number ? (
              <p id="reserved-number-error" className="text-xs text-destructive sm:col-span-4">
                {errors.number}
              </p>
            ) : null}
            {errors.note ? (
              <p id="reserved-note-error" className="text-xs text-destructive sm:col-span-4">
                {errors.note}
              </p>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
