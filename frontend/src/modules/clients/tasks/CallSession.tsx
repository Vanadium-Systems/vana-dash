import { ArrowRight, Ban, ExternalLink, Phone, SkipForward, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button, buttonVariants } from '@/shared/components/ui/button'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { companyTimeZone, formatDateTime, formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { useNotes, useSheet, useSheetRefresh, useTimeline } from '../sheet/use-sheet'
import { buildCompleteBody, emptyDraft, type CompletionDraft } from './completion'
import { CompletionFields, OUTCOME_LABEL } from './CompletionFields'
import { CALL_OUTCOMES, type CallOutcome, type TaskRow, type TaskScope } from './types'
import { useTaskList } from './use-tasks-data'

const QUEUE_SIZE = 100
const KEY_ESC = 'Esc'
const KEY_ENTER = 'Enter'
const KIND_LABEL: Record<string, TKey> = {
  audit: 'clients:tasks.session.activity.audit',
  note: 'clients:tasks.session.activity.note',
  task: 'clients:tasks.session.activity.task',
  stage: 'clients:tasks.session.activity.stage',
  call: 'clients:tasks.session.activity.call',
  email: 'clients:tasks.session.activity.email',
  sequence: 'clients:tasks.session.activity.sequence',
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** Short sheet of the prospect being called: who to ask for, which numbers, what happened lately. */
function CallCard({ task, phoneId, onPhone }: { task: TaskRow; phoneId: string; onPhone: (id: string) => void }) {
  const sheet = useSheet(task.prospectId)
  const timeline = useTimeline(task.prospectId)
  const notes = useNotes(task.prospectId)
  if (sheet.isPending) return <ListSkeleton rows={4} />
  if (!sheet.data) return <p className="text-sm text-muted-foreground">{t('clients:tasks.session.cardFailed')}</p>

  const { people, contactPoints } = sheet.data
  const blocked = new Set(people.filter((person) => person.doNotContact).map((person) => person.id))
  const person = people.find((entry) => entry.id === task.personId)
  // The person on the task first, then the company's own numbers, then the rest.
  const phones = contactPoints
    .filter((point) => point.kind === 'phone')
    .sort((a, b) => Number(b.personId === task.personId) - Number(a.personId === task.personId) || Number(b.isPrimary) - Number(a.isPrimary))
  const recent = (timeline.data?.pages[0]?.entries ?? []).slice(0, 3)
  const pinned = (notes.data ?? []).filter((note) => note.pinned)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">
          <Link to={`/clients/${task.prospectId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {sheet.data.name}
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t('clients:tasks.session.openSheet')}</span>
          </Link>
        </h2>
        <p className="text-sm text-muted-foreground">{[person?.name ?? task.personName, person?.role].filter(Boolean).join(' · ') || t('clients:tasks.session.noPerson')}</p>
        <p className="mt-1 text-sm">{task.title}</p>
      </div>

      {person?.doNotContact ? (
        <div role="alert" className="flex items-start gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{person.doNotContactReason ? t('clients:tasks.session.doNotContactWhy', { reason: person.doNotContactReason }) : t('clients:tasks.session.doNotContact')}</span>
        </div>
      ) : null}

      <section aria-label={t('clients:tasks.session.phones')} className="space-y-2">
        <h3 className="text-sm font-medium">{t('clients:tasks.session.phones')}</h3>
        {phones.length === 0 ? <p className="text-sm text-muted-foreground">{t('clients:tasks.session.noPhones')}</p> : null}
        <ul className="space-y-2">
          {phones.map((phone) => {
            const off = phone.status === 'invalid' || (phone.personId !== null && blocked.has(phone.personId))
            return (
              <li key={phone.id} className="flex flex-wrap items-center gap-3">
                <span className={cn('min-w-0 flex-1 tabular-nums', off && 'text-muted-foreground line-through')}>
                  {phone.value}
                  {phone.label ? <span className="ml-2 text-xs text-muted-foreground no-underline">{phone.label}</span> : null}
                </span>
                {phone.status === 'invalid' ? <Badge variant="secondary">{t('clients:tasks.session.invalid')}</Badge> : null}
                {off ? null : (
                  <a
                    href={`tel:${phone.value.replace(/\s+/g, '')}`}
                    onClick={() => onPhone(phone.id)}
                    className={buttonVariants({ variant: phone.id === phoneId ? 'default' : 'outline' })}
                  >
                    <Phone aria-hidden="true" /> {t('clients:tasks.session.call')}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {pinned.length > 0 ? (
        <section aria-label={t('clients:tasks.session.pinned')} className="space-y-1">
          <h3 className="text-sm font-medium">{t('clients:tasks.session.pinned')}</h3>
          {pinned.map((note) => (
            <p key={note.id} className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm">
              {note.body}
            </p>
          ))}
        </section>
      ) : null}

      <section aria-label={t('clients:tasks.session.recent')} className="space-y-1">
        <h3 className="text-sm font-medium">{t('clients:tasks.session.recent')}</h3>
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">{t('clients:tasks.session.noRecent')}</p> : null}
        <ul className="space-y-1 text-sm">
          {recent.map((entry) => (
            <li key={entry.id} className="flex gap-3">
              <span className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDateTime(entry.at)}</span>
              <span className="min-w-0 truncate">{[t(KIND_LABEL[entry.kind] ?? 'clients:tasks.session.activity.audit'), entry.author].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/** Full-screen call session over the call tasks of the filter it was started from (AO12). */
export function CallSession() {
  const navigate = useNavigate()
  const refresh = useSheetRefresh()
  const [params] = useSearchParams()
  const scope: TaskScope = params.get('scope') === 'team' ? 'team' : 'mine'
  const list = useTaskList({ tab: 'call', scope, page: 0, pageSize: QUEUE_SIZE })

  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState<string[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CompletionDraft>(emptyDraft)
  const [phoneId, setPhoneId] = useState('')
  const [tally, setTally] = useState<Partial<Record<CallOutcome, number>>>({})
  const [summary, setSummary] = useState(false)
  const [saving, setSaving] = useState(false)

  // Skipped tasks go behind the rest, in the order they were skipped.
  const queue = useMemo(() => {
    const open = (list.data?.rows ?? []).filter((row) => !doneIds.has(row.id))
    return [...open.filter((row) => !skipped.includes(row.id)), ...skipped.flatMap((id) => open.filter((row) => row.id === id))]
  }, [list.data, doneIds, skipped])
  const current = queue.find((row) => row.id === focusId) ?? queue[0]
  const handled = Object.values(tally).reduce((sum, n) => sum + n, 0)

  const sheet = useSheet(current?.prospectId ?? '', Boolean(current))
  const phones = (sheet.data?.contactPoints ?? []).filter((point) => point.kind === 'phone' && point.status !== 'invalid')
  useEffect(() => {
    // The dialled number defaults to the first one that can be called, until a "Call" press picks another.
    if (!phones.some((phone) => phone.id === phoneId)) setPhoneId(phones[0]?.id ?? '')
  }, [phones, phoneId])

  const next = useCallback(() => {
    setDraft(emptyDraft())
    setFocusId(null)
  }, [])

  const submit = useCallback(async () => {
    if (!current || !draft.outcome || saving) return
    setSaving(true)
    try {
      await api.post(`/api/prospects/tasks/${current.id}/done`, buildCompleteBody({ ...draft, contactPointId: phoneId }, current.prospectName, companyTimeZone()))
      setDoneIds((ids) => new Set(ids).add(current.id))
      setTally((counts) => ({ ...counts, [draft.outcome!]: (counts[draft.outcome!] ?? 0) + 1 }))
      refresh()
      next()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common:states.changeNotSaved'))
    } finally {
      setSaving(false)
    }
  }, [current, draft, phoneId, saving, refresh, next])

  const skip = useCallback(() => {
    if (!current || queue.length < 2) return
    setSkipped((ids) => [...ids.filter((id) => id !== current.id), current.id])
    next()
  }, [current, queue.length, next])

  const leave = useCallback(() => navigate('/clients?tab=taskuri'), [navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (summary) leave()
        else setSummary(true)
        return
      }
      if (summary) return
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void submit()
        return
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      // A focused button or link takes Enter for itself.
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
        e.preventDefault()
        void submit()
        return
      }
      const outcome = CALL_OUTCOMES[Number(e.key) - 1]
      if (outcome) setDraft((value) => ({ ...value, outcome, next: outcome === 'callback' && value.next === 'none' ? 'callback2' : value.next }))
      else if (e.key.toLowerCase() === 's') skip()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [summary, submit, skip, leave])

  const finished = !list.isPending && !current
  const showSummary = summary || finished

  return (
    <div data-density="comfortable" className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center gap-3 border-b px-4 py-3 safe-top">
        <h1 className="text-base font-semibold">{t('clients:tasks.session.title')}</h1>
        <span className="tabular-nums text-sm text-muted-foreground" aria-live="polite">
          {t('clients:tasks.session.left', { count: queue.length, n: formatNumber(queue.length) })}
        </span>
        <Button type="button" variant="ghost" className="ml-auto" onClick={() => setSummary(true)}>
          <X aria-hidden="true" /> {t('clients:tasks.session.exit')} <kbd className="font-sans text-xs text-muted-foreground">{KEY_ESC}</kbd>
        </Button>
      </header>

      {showSummary ? (
        <div className="mx-auto w-full max-w-md flex-1 space-y-4 overflow-y-auto p-6">
          <h2 className="text-xl font-semibold">{finished ? t('clients:tasks.session.finished') : t('clients:tasks.session.summary')}</h2>
          <p className="text-sm text-muted-foreground">{t('clients:tasks.session.handled', { count: handled, n: formatNumber(handled) })}</p>
          <ul className="space-y-1 text-sm">
            {CALL_OUTCOMES.filter((outcome) => tally[outcome]).map((outcome) => (
              <li key={outcome} className="flex justify-between gap-4">
                <span>{t(OUTCOME_LABEL[outcome])}</span>
                <span className="tabular-nums">{formatNumber(tally[outcome] ?? 0)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={leave}>
              {t('clients:tasks.session.back')}
            </Button>
            {!finished ? (
              <Button type="button" variant="outline" onClick={() => setSummary(false)}>
                {t('clients:tasks.session.continue')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)_22rem]">
          <nav aria-label={t('clients:tasks.session.queue')} className="hidden min-h-0 overflow-y-auto border-r p-2 lg:block">
            <ul className="space-y-0.5">
              {queue.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    aria-current={row.id === current?.id ? 'true' : undefined}
                    onClick={() => {
                      setDraft(emptyDraft())
                      setFocusId(row.id)
                    }}
                    className={cn(
                      'block w-full rounded-sm px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      row.id === current?.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                    )}
                  >
                    <span className="block truncate">{row.prospectName}</span>
                    <span className="block truncate text-xs">{[row.personName, formatDateTime(row.dueAt)].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <main className="min-h-0 overflow-y-auto p-4 md:p-6">{current ? <CallCard key={current.id} task={current} phoneId={phoneId} onPhone={setPhoneId} /> : <ListSkeleton rows={4} />}</main>

          <aside className="min-h-0 space-y-4 overflow-y-auto border-t p-4 md:p-6 lg:border-l lg:border-t-0">
            <CompletionFields draft={draft} onChange={setDraft} isCall keyHints />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={!draft.outcome || saving} onClick={() => void submit()}>
                {t('clients:tasks.session.nextTask')} <ArrowRight aria-hidden="true" />
                <kbd className="font-sans text-xs opacity-70">{KEY_ENTER}</kbd>
              </Button>
              <Button type="button" variant="outline" disabled={queue.length < 2} onClick={skip}>
                <SkipForward aria-hidden="true" /> {t('clients:tasks.session.skip')} <kbd className="font-sans text-xs text-muted-foreground">S</kbd>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('clients:tasks.session.keys')}</p>
          </aside>
        </div>
      )}
    </div>
  )
}
