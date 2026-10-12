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
    if (!/^\d{1,4}$/.test(number.trim())) next.number = 'Scrie numărul în cifre, cel mult patru.'
    else if (list.some((r) => r.number === normalized)) next.number = `${normalized} e deja în listă.`
    if (!note.trim()) next.note = 'Scrie pentru ce e ocupat numărul.'
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
          toast.success(`${entry.number} nu mai e rezervat.`, {
            action: { label: 'Anulează', onClick: () => save.mutate(list) },
          }),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Numere rezervate</CardTitle>
        <p className="text-sm text-muted-foreground">
          Numere de contract ocupate în afara aplicației. Sugestia de la un client nou le sare.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {reserved.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : reserved.isError ? (
          <p className="text-sm text-destructive">Nu am putut încărca numerele rezervate. Reîncarcă pagina.</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Niciun număr rezervat.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Nr.</TableHead>
                <TableHead>Pentru ce</TableHead>
                <TableHead className="w-28">Data</TableHead>
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
                      aria-label={`Scoate ${r.number} din rezervate`}
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
              <Label htmlFor="reserved-number">Număr</Label>
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
              <Label htmlFor="reserved-note">Pentru ce</Label>
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
              <Label htmlFor="reserved-date">Data</Label>
              <Input id="reserved-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Button type="submit" variant="outline" disabled={save.isPending}>
              Rezervă
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
