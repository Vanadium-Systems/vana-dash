import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Textarea } from '@/shared/components/ui/textarea'
import { api, ApiError } from '@/shared/lib/api'
import { findNavItem } from '@/shared/lib/nav-items'
import type { SupportTicketDetail } from '@/shared/lib/types'
import { cn, formatDateTime } from '@/shared/lib/utils'
import { STATUS_LABEL, STATUS_TONE, SUPPORT_PATHS, SUPPORT_UNREAD_KEY, type SupportScope } from './support-api'

export function TicketPage({ scope }: { scope: SupportScope }) {
  const paths = SUPPORT_PATHS[scope]
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryKey = ['support', scope, 'ticket', id]

  const ticket = useQuery({
    queryKey,
    queryFn: () => api.get<SupportTicketDetail>(`${paths.api}/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  })

  // Deschiderea marchează tichetul citit pe server, deci numărul din meniu se reface.
  useEffect(() => {
    if (ticket.data) void queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_KEY })
  }, [ticket.data?.id])

  const onChanged = (fresh: SupportTicketDetail) => {
    queryClient.setQueryData(queryKey, fresh)
    void queryClient.invalidateQueries({ queryKey: ['support', scope, 'tickets'] })
    void queryClient.invalidateQueries({ queryKey: SUPPORT_UNREAD_KEY })
  }

  const reply = useMutation({
    mutationFn: () => api.post<SupportTicketDetail>(`${paths.api}/${id}/replies`, { body: body.trim() }),
    onSuccess: (fresh) => {
      onChanged(fresh)
      setBody('')
    },
    onError: (err) => toast.error(err.message),
  })

  const close = useMutation({
    mutationFn: () => api.patch<SupportTicketDetail>(`${paths.api}/${id}`, { status: 'inchis' }),
    onSuccess: (fresh) => {
      onChanged(fresh)
      toast.success('Tichet închis.')
    },
    onError: (err) => toast.error(err.message),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!body.trim()) {
      setError('Scrie răspunsul înainte să-l trimiți.')
      return
    }
    setError(null)
    reply.mutate()
  }

  const back = (
    <Link to={paths.route} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {scope === 'platform' ? 'Tichete de suport' : 'Suport'}
    </Link>
  )

  if (ticket.isPending) {
    return (
      <div className="max-w-2xl space-y-4" data-density="comfortable">
        {back}
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (ticket.isError) {
    const missing = ticket.error instanceof ApiError && ticket.error.status === 404
    return (
      <div className="max-w-2xl space-y-4 text-sm" data-density="comfortable">
        {back}
        <p>{missing ? 'Tichetul nu există sau nu e al tău.' : 'Nu am putut încărca tichetul.'}</p>
        {missing ? null : (
          <Button variant="outline" onClick={() => void ticket.refetch()}>
            Încearcă din nou
          </Button>
        )}
      </div>
    )
  }

  const data = ticket.data
  const pageLabel = data.page ? (findNavItem(data.page)?.label ?? data.page) : null
  const entries = [
    { id: data.id, body: data.description, isPlatformReply: false, createdAt: data.createdAt, author: data.author },
    ...data.replies,
  ]

  return (
    <div className="max-w-2xl space-y-6" data-density="comfortable">
      {back}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-bold">{data.subject}</h1>
          <StatePill tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</StatePill>
        </div>
        <p className="text-sm text-muted-foreground">
          {scope === 'platform' ? `${data.author.name}, ` : 'Deschis '}
          {formatDateTime(data.createdAt)}
          {pageLabel ? `, de pe pagina ${pageLabel}` : ''}
        </p>
      </div>

      <ol className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className={cn('rounded-lg px-4 py-3', entry.isPlatformReply ? 'bg-accent' : 'bg-muted/50')}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{entry.isPlatformReply ? `${entry.author.name}, Vanadium` : entry.author.name}</span>
              <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{entry.body}</p>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} noValidate className="space-y-3">
        <Field
          label="Răspunsul tău"
          error={error}
          hint={data.status === 'inchis' ? 'Tichetul e închis. Un răspuns îl redeschide.' : undefined}
        >
          <Textarea rows={4} maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={reply.isPending}>
            Trimite răspunsul
          </Button>
          {data.status !== 'inchis' ? (
            <Button type="button" variant="outline" disabled={close.isPending} onClick={() => close.mutate()}>
              Închide tichetul
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  )
}
