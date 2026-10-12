import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { findNavItem } from '@/shared/lib/nav-items'
import type { SupportTicket, SupportTicketDetail, SupportTicketStatus } from '@/shared/lib/types'
import { formatRelativeTime } from '@/shared/lib/format'
import { STATUS_LABEL, STATUS_TONE, SUPPORT_PATHS, type SupportScope } from './support-api'
import { t } from '@/shared/lib/i18n'

const STATUS_FILTERS: SupportTicketStatus[] = ['deschis', 'raspuns', 'inchis']

export function SupportPage({ scope }: { scope: SupportScope }) {
  const paths = SUPPORT_PATHS[scope]
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [creating, setCreating] = useState(false)

  const statusParam = searchParams.get('stare')
  const status = scope === 'platform' && STATUS_FILTERS.includes(statusParam as SupportTicketStatus) ? (statusParam as SupportTicketStatus) : null

  const tickets = useQuery({
    queryKey: ['support', scope, 'tickets', status],
    queryFn: () => api.get<SupportTicket[]>(status ? `${paths.api}?status=${status}` : paths.api),
  })

  // Pagina de pe care a venit omul (meniul contului o trimite în `state`), ca tichetul să
  // spună unde era când a avut nevoie de ajutor.
  const cameFrom = (location.state as { from?: string } | null)?.from ?? null

  const newTicketButton = (label: string) => (
    <Button onClick={() => setCreating(true)}>
      <Plus className="h-4 w-4" />
      {label}
    </Button>
  )

  return (
    <div className="space-y-6" data-density="comfortable">
      <PageHeader
        title={scope === 'platform' ? t('common:shell.supportTickets') : t('common:nav.support')}
        description={
          scope === 'platform' ? t('support:descriptionAll') : t('support:descriptionMine')
        }
        actions={scope === 'mine' ? newTicketButton(t('support:newTicket')) : null}
      />

      {scope === 'platform' ? (
        <div className="max-w-52">
          <Select
            aria-label={t('support:filterByStatus')}
            value={status ?? ''}
            onChange={(event) => setSearchParams(event.target.value ? { stare: event.target.value } : {})}
          >
            <option value="">{t('support:allStatuses')}</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {tickets.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : tickets.isError ? (
        <div className="space-y-2 py-8 text-sm">
          <p>{t('support:loadFailed')}</p>
          <Button variant="outline" onClick={() => void tickets.refetch()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : tickets.data.length === 0 ? (
        status ? (
          <EmptyState kind="filtered" title={t('support:emptyForStatus', { value: STATUS_LABEL[status] })} onReset={() => setSearchParams({})} />
        ) : scope === 'platform' ? (
          <EmptyState kind="new" title={t('support:emptyAllTitle')} description={t('support:emptyAllHint')} />
        ) : (
          <EmptyState
            kind="new"
            title={t('support:emptyMineTitle')}
            description={t('support:emptyMineHint')}
            action={newTicketButton('Deschide primul tichet')}
          />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common:labels.subject')}</TableHead>
              {scope === 'platform' ? <TableHead className="hidden sm:table-cell">{t('common:labels.from')}</TableHead> : null}
              <TableHead>{t('common:labels.state')}</TableHead>
              <TableHead className="hidden whitespace-nowrap text-right sm:table-cell">{t('support:lastActivity')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.data.map((ticket) => (
              <TableRow key={ticket.id}>
                <TableCell className="max-w-0 w-full">
                  <Link to={`${paths.route}/${ticket.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                    <span className={ticket.unread ? 'truncate font-semibold' : 'truncate'}>{ticket.subject}</span>
                    {ticket.unread ? <StatePill tone="warning">{t('common:states.unread')}</StatePill> : null}
                  </Link>
                  {scope === 'platform' ? <p className="truncate text-xs text-muted-foreground sm:hidden">{ticket.author.name}</p> : null}
                </TableCell>
                {scope === 'platform' ? <TableCell className="hidden whitespace-nowrap sm:table-cell">{ticket.author.name}</TableCell> : null}
                <TableCell>
                  <StatePill tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</StatePill>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground sm:table-cell">
                  {formatRelativeTime(ticket.lastActivityAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <NewTicketDialog open={creating} onOpenChange={setCreating} page={cameFrom} />
    </div>
  )
}

function NewTicketDialog({ open, onOpenChange, page }: { open: boolean; onOpenChange: (open: boolean) => void; page: string | null }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // Starea rămâne la închidere: un dialog închis din greșeală nu pierde ce a scris omul.
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ subject?: string; description?: string }>({})

  const pageLabel = page ? (findNavItem(page)?.label ?? null) : null

  const create = useMutation({
    mutationFn: () =>
      api.post<SupportTicketDetail>('/api/support/tickets', { subject: subject.trim(), description: description.trim(), ...(page ? { page } : {}) }),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ['support'] })
      setSubject('')
      setDescription('')
      onOpenChange(false)
      toast.success(t('support:form.sent'))
      navigate(`/support/${ticket.id}`)
    },
    onError: (err) => toast.error(err.message),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next: typeof errors = {}
    if (!subject.trim()) next.subject = t('support:form.subjectRequired')
    if (!description.trim()) next.description = t('support:form.bodyRequired')
    setErrors(next)
    if (!next.subject && !next.description) create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('support:newTicket')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t('common:labels.subject')} error={errors.subject}>
            <Input value={subject} maxLength={160} onChange={(event) => setSubject(event.target.value)} />
          </Field>
          <Field
            label={t('common:labels.description')}
            error={errors.description}
            hint={pageLabel ? t('support:form.pageIncluded', { pageLabel }) : undefined}
          >
            <Textarea rows={6} maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.discard')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('support:form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
