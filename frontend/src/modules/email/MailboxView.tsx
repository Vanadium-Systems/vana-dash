import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Check, ChevronLeft, ChevronRight, Mail, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { FileViewer } from '@/shared/components/FileViewer'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { BottomSheet } from '@/shared/components/ui/responsive-menu'
import { Select } from '@/shared/components/ui/select'
import { SelectionBar } from '@/shared/components/ui/selection-bar'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useHotkeys } from '@/shared/hooks/use-hotkeys'
import { useMe } from '@/shared/hooks/use-me'
import { usePageRefresh } from '@/shared/hooks/use-pull-to-refresh'
import { useSelection } from '@/shared/hooks/use-selection'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { undoToast } from '@/shared/lib/undo-toast'
import type { EmailSenderOptions, EmailThread } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { openCompose } from './compose/compose-store'
import { usePhoneLayout } from './compose/ComposeWindows'
import type { EmailView } from './EmailSidebar'
import { extractEmailAddress } from './identity'
import { identitiesFor } from './IdentityField'
import { filterParams, MailSearch, useMailFilters } from './MailSearch'
import { SnoozeMenu } from './SnoozeMenu'
import { ThreadRow, type MoveFolder } from './ThreadRow'
import { ThreadView } from './ThreadView'

// Archive, spam and trash say what they did and can be undone (E8); undo puts each thread back in
// the folder it came from. Sequential on purpose: the bulk route shares the global rate limit.
async function moveThreads(threads: EmailThread[], folder: MoveFolder, onDone: () => void) {
  const withMessage = threads.filter((thread) => thread.latestMessageId)
  if (withMessage.length === 0) return
  const ids = withMessage.map((thread) => thread.latestMessageId as string)
  const byOrigin = new Map<string, string[]>()
  for (const thread of withMessage) {
    const origin = thread.folder ?? 'inbox'
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), thread.latestMessageId as string])
  }
  await undoToast(
    t(`email:toasts.moved.${folder}`, { count: ids.length }),
    () => api.post('/api/email/messages/bulk-update', { ids, patch: { folder } }).then(onDone),
    async () => {
      for (const [origin, originIds] of byOrigin) await api.post('/api/email/messages/bulk-update', { ids: originIds, patch: { folder: origin } })
      onDone()
    },
  )
}

const LONG_PRESS_MS = 500

function initialsOf(label: string): string {
  return label
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}

function ReceivedOnPhone({ addresses, value, onChange }: { addresses: { key: string; label: string; address: string }[]; value: string; onChange: (address: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = addresses.find((a) => a.address === value)
  const pick = (address: string) => {
    onChange(address)
    setOpen(false)
  }
  const row = (address: string, label: string, selected: boolean) => (
    <button
      key={address || 'any'}
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={cn('flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-base hover:bg-muted', selected && 'font-medium')}
      onClick={() => pick(address)}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
    </button>
  )
  const others = [...(current ? [{ address: '', label: t('email:list.anyAddress') }] : []), ...addresses.filter((a) => a.address !== value)]
  return (
    <>
      <button
        type="button"
        title={t('email:list.receivedOnHint')}
        aria-label={t('email:list.receivedOnHint')}
        className="flex h-control-md w-control-md shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
        onClick={() => setOpen(true)}
      >
        {current ? initialsOf(current.label) : <Mail className="h-4 w-4" aria-hidden="true" />}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t('email:list.receivedOnTitle')}>
        {row(current?.address ?? '', current?.label ?? t('email:list.anyAddress'), true)}
        {others.map((a) => row(a.address, a.label, false))}
      </BottomSheet>
    </>
  )
}

export function MailboxView({ view }: { view: Extract<EmailView, { kind: 'mailbox' }> }) {
  const queryClient = useQueryClient()
  const { session, can } = useMe()
  const phone = usePhoneLayout()
  // The open thread lives in the URL (?thread=<id>): reload, Back and links land on it.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('thread')
  const setSelectedId = useCallback(
    (id: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('thread', id)
        else next.delete('thread')
        return next
      })
    },
    [setSearchParams],
  )
  const [search, setSearch] = useUrlState('q')
  const filterState = useMailFilters()
  const [toAddress, setToAddress] = useState('')
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [viewer, setViewer] = useState<{ name: string; url: string; mimeType: string; id: string } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const debouncedSearch = useDebounced(search, 300)

  const senderOptions = useQuery({
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
    staleTime: 5 * 60 * 1000,
  })
  // "Received on" lists only the person's own mailboxes; the server would return nothing else.
  const receivingAddresses = identitiesFor(senderOptions.data?.identities, session?.mailboxes)
    .map((i) => ({ key: i.key, label: i.label, address: extractEmailAddress(i.fromAddress) }))
    .filter((i) => i.address)
  const mailboxLabelFor = (thread: EmailThread) => {
    if (receivingAddresses.length < 2 || toAddress || !thread.toAddress) return null
    const address = extractEmailAddress(thread.toAddress).toLowerCase()
    return receivingAddresses.find((a) => a.address.toLowerCase() === address)?.label ?? null
  }
  // Mixed views (a label, Starred, All mail) show each thread's folder; a single folder does not.
  const showFolder = !view.folder || view.folder === 'all' || Boolean(view.starred)

  const filtersKey = JSON.stringify(filterState.filters)
  const isFirstRender = useRef(true)
  useEffect(() => {
    // Skipped on mount, or a link straight to ?thread=<id> would clear itself.
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setSelectedId(null)
    selection.clear()
    setPage(0)
    setFocusIndex(-1)
  }, [view.folder, view.starred, view.snoozed, view.labelId, debouncedSearch, toAddress, pageSize, filtersKey])

  const params = useMemo(() => {
    const p = new URLSearchParams(filterParams(filterState.filters))
    if (view.folder) p.set('folder', view.folder)
    if (view.starred) p.set('isStarred', 'true')
    if (view.snoozed) p.set('snoozed', 'true')
    if (view.labelId) p.set('labelId', view.labelId)
    if (debouncedSearch) p.set('q', debouncedSearch)
    if (toAddress) p.set('toAddress', toAddress)
    p.set('limit', String(pageSize))
    p.set('offset', String(page * pageSize))
    return p.toString()
    // filtersKey stands for filterState.filters, which is a new object on every render.
  }, [view, debouncedSearch, toAddress, pageSize, page, filtersKey])

  const threads = useQuery({
    queryKey: ['email', 'threads', params],
    queryFn: () => api.get<{ items: EmailThread[]; total: number }>(`/api/email/threads?${params}`),
    // Mail arrives on the server in real time; without a push channel the list polls every 30s.
    refetchInterval: 30_000,
  })
  usePageRefresh(() => threads.refetch())
  const items = useMemo(() => threads.data?.items ?? [], [threads.data])
  const total = threads.data?.total ?? 0
  const threadIds = useMemo(() => items.map((thread) => thread.id), [items])
  const selection = useSelection(threadIds)
  const selectedThreads = items.filter((thread) => selection.selected.has(thread.id))

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['email', 'threads'] })
    void queryClient.invalidateQueries({ queryKey: ['email', 'unread-counts'] })
  }, [queryClient])

  const bulkUpdate = useMutation({
    mutationFn: ({ targets, patch }: { targets: EmailThread[]; patch: { isRead?: boolean; snoozedUntil?: string } }) => {
      const ids = targets.filter((thread) => thread.latestMessageId).map((thread) => thread.latestMessageId as string)
      return api.post('/api/email/messages/bulk-update', { ids, patch })
    },
    onSuccess: () => {
      invalidate()
      selection.clear()
    },
    onError: (err) => toast.error(err.message),
  })
  const star = useMutation({
    mutationFn: (thread: EmailThread) => api.patch(`/api/email/messages/${thread.latestMessageId}`, { isStarred: !thread.isStarred }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  })

  const move = (targets: EmailThread[], folder: MoveFolder) => {
    selection.clear()
    void moveThreads(targets, folder, invalidate)
  }
  // A right click on a selected row acts on the whole selection, as in a file manager.
  const targetsFor = (thread: EmailThread) => (selection.selected.has(thread.id) ? selectedThreads : [thread])
  const focused = items[focusIndex]
  const actOn = () => (selection.count > 0 ? selectedThreads : focused ? [focused] : [])

  // E36: Gmail's keys. j/k move through the list, Enter or o opens, x selects, s stars.
  useHotkeys(
    [
      { keys: 'j', label: t('email:shortcuts.next'), onKey: () => setFocusIndex((i) => Math.min(i + 1, items.length - 1)) },
      { keys: 'k', label: t('email:shortcuts.previous'), onKey: () => setFocusIndex((i) => Math.max(i - 1, 0)) },
      { keys: 'o', label: t('email:shortcuts.open'), onKey: () => focused && setSelectedId(focused.id) },
      { keys: 'enter', label: t('email:shortcuts.open'), onKey: () => focused && setSelectedId(focused.id) },
      { keys: 'x', label: t('email:shortcuts.select'), onKey: () => focused && selection.toggle(focused.id) },
      { keys: 's', label: t('email:thread.star'), onKey: () => focused && star.mutate(focused) },
      { keys: '/', label: t('email:shortcuts.search'), onKey: (e) => { e.preventDefault(); searchRef.current?.focus() } },
      {
        keys: 'c',
        label: t('email:compose.title'),
        onKey: (e) => {
          // Otherwise the "c" lands in the To field the window focuses.
          e.preventDefault()
          if (can('email.trimitere')) openCompose({ kind: 'new' })
        },
      },
      { keys: 'e', label: t('common:actions.archive'), onKey: () => move(actOn(), 'archive') },
      { keys: 'shift+#', label: t('common:actions.delete'), onKey: () => move(actOn(), 'trash') },
      { keys: 'shift+!', label: t('email:folders.spam'), onKey: () => move(actOn(), 'spam') },
      { keys: 'shift+i', label: t('email:list.read'), onKey: () => bulkUpdate.mutate({ targets: actOn(), patch: { isRead: true } }) },
      { keys: 'shift+u', label: t('common:states.unread'), onKey: () => bulkUpdate.mutate({ targets: actOn(), patch: { isRead: false } }) },
    ],
    { enabled: !selectedId },
  )
  useEffect(() => {
    if (focusIndex < 0) return
    document.querySelector(`[data-thread-id="${items[focusIndex]?.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex, items])

  // File-manager selection: Ctrl/Cmd+click toggles; on a phone a long press starts selecting,
  // and while anything is selected a tap selects instead of opening.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  const startLongPress = (id: string) => {
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      selection.toggle(id)
    }, LONG_PRESS_MS)
  }
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }
  const handleRowActivate = (e: MouseEvent, id: string) => {
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    if (selection.onRowClick(e, id)) return
    setSelectedId(id)
  }

  // ‹ › and "3 of 50" in the open thread walk the list as filtered right now (E21).
  const neighbors = useMemo(() => {
    const index = items.findIndex((thread) => thread.id === selectedId)
    if (index < 0) return null
    return {
      position: page * pageSize + index + 1,
      total,
      prevId: items[index - 1]?.id ?? null,
      nextId: items[index + 1]?.id ?? null,
    }
  }, [items, selectedId, page, pageSize, total])

  const selectionActions = (
    <>
      <Button variant="ghost" size="sm" onClick={() => move(selectedThreads, 'archive')}>
        <Archive className="h-4 w-4" /> {t('common:actions.archive')}
      </Button>
      <SnoozeMenu onSnooze={(until) => bulkUpdate.mutate({ targets: selectedThreads, patch: { snoozedUntil: until } })} disabled={bulkUpdate.isPending} triggerClassName="inline-flex h-control-sm items-center rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground" />
      <Button variant="ghost" size="sm" onClick={() => move(selectedThreads, 'spam')}>
        <ShieldAlert className="h-4 w-4" /> {t('email:folders.spam')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => move(selectedThreads, 'trash')}>
        <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => bulkUpdate.mutate({ targets: selectedThreads, patch: { isRead: true } })}>
        {t('email:list.read')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => bulkUpdate.mutate({ targets: selectedThreads, patch: { isRead: false } })}>
        {t('common:states.unread')}
      </Button>
    </>
  )
  const toolbarSelection = !phone && selection.count > 0

  const resetAll = () => {
    setSearch('')
    setToAddress('')
    filterState.clear()
  }

  return (
    <div>
      <div className={cn('space-y-2', selectedId ? 'hidden' : '')}>
        {/* E6: on a desktop the selection's actions take the toolbar's place, same height. */}
        {toolbarSelection ? (
          <div className="min-h-[4.25rem]">
            <SelectionBar placement="toolbar" count={selection.count} total={total} allSelected={selection.allSelected} onSelectAll={selection.selectAll} onClear={selection.clear}>
              {selectionActions}
            </SelectionBar>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <MailSearch query={search} onQuery={setSearch} state={filterState} onOpenThread={(id) => setSelectedId(id)} inputRef={searchRef} />
            {receivingAddresses.length > 1 ? (
              phone ? (
                <ReceivedOnPhone addresses={receivingAddresses} value={toAddress} onChange={setToAddress} />
              ) : (
                <Select className="w-auto shrink-0" title={t('email:list.receivedOnHint')} value={toAddress} onChange={(e) => setToAddress(e.target.value)}>
                  <option value="">{t('email:list.anyAddress')}</option>
                  {receivingAddresses.map((a) => (
                    <option key={a.key} value={a.address}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              )
            ) : null}
            <Button variant="ghost" size="icon" className="hidden shrink-0 sm:inline-flex" title={t('common:actions.refresh')} aria-label={t('common:actions.refresh')} disabled={threads.isFetching} onClick={() => invalidate()}>
              <RefreshCw className={cn('h-4 w-4', threads.isFetching && 'animate-spin')} />
            </Button>
          </div>
        )}

        <div className="border-y">
          {threads.isPending ? (
            <ListSkeleton rows={10} lines={1} />
          ) : threads.isError ? (
            <p className="py-6 text-center text-sm">
              {t('email:list.loadFailed')}{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => void threads.refetch()}>
                {t('common:actions.retry')}
              </button>
            </p>
          ) : !items.length ? (
            search || toAddress || filterState.active ? (
              <EmptyState kind="filtered" title={search ? t('email:list.nothingFor', { search }) : t('email:list.nothingFiltered')} onReset={resetAll} />
            ) : (
              <EmptyState kind="new" title={t('email:list.nothingHere')} />
            )
          ) : (
            <div role="list">
              {items.map((thread, index) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  query={debouncedSearch}
                  opened={selectedId === thread.id}
                  selected={selection.selected.has(thread.id)}
                  focused={focusIndex === index}
                  showFolder={showFolder}
                  mailboxLabel={mailboxLabelFor(thread)}
                  onActivate={(e) => handleRowActivate(e, thread.id)}
                  onToggle={() => selection.toggle(thread.id)}
                  onLongPress={{ start: () => startLongPress(thread.id), cancel: cancelLongPress }}
                  onMove={(folder) => move(targetsFor(thread), folder)}
                  onMarkRead={(isRead) => bulkUpdate.mutate({ targets: targetsFor(thread), patch: { isRead } })}
                  onStar={() => star.mutate(thread)}
                  onSnooze={(until) => bulkUpdate.mutate({ targets: targetsFor(thread), patch: { snoozedUntil: until } })}
                  onOpenAttachment={(attachmentId) => {
                    const attachment = thread.attachments.find((a) => a.id === attachmentId)
                    if (attachment) {
                      setViewer({ id: attachment.id, name: attachment.filename, url: `/api/email/attachments/${attachment.id}/download`, mimeType: attachment.contentType ?? '' })
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {total > 0 ? (
          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <Select size="sm" className="w-auto shrink-0" title={t('email:list.perPageHint')} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {t('email:pagination.perPage', { size })}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap tabular-nums">
                {t('email:pagination.range', { from: page * pageSize + 1, to: Math.min((page + 1) * pageSize, total), total })}
              </span>
              <Button variant="ghost" size="icon" title={t('common:actions.previousPage')} aria-label={t('common:actions.previousPage')} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" title={t('common:actions.nextPage')} aria-label={t('common:actions.nextPage')} disabled={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {/* Phone: the selection floats at the bottom, where the thumb is. */}
      {!selectedId && phone ? (
        <SelectionBar count={selection.count} allSelected={selection.allSelected} onSelectAll={selection.selectAll} onClear={selection.clear}>
          <Button variant="ghost" size="icon-sm" title={t('common:actions.archive')} aria-label={t('common:actions.archive')} onClick={() => move(selectedThreads, 'archive')}>
            <Archive className="h-4 w-4" />
          </Button>
          <SnoozeMenu onSnooze={(until) => bulkUpdate.mutate({ targets: selectedThreads, patch: { snoozedUntil: until } })} disabled={bulkUpdate.isPending} />
          <Button variant="ghost" size="icon-sm" title={t('common:actions.delete')} aria-label={t('common:actions.delete')} onClick={() => move(selectedThreads, 'trash')}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => bulkUpdate.mutate({ targets: selectedThreads, patch: { isRead: true } })}>
            {t('email:list.read')}
          </Button>
        </SelectionBar>
      ) : null}
      {selectedId ? (
        <ThreadView threadId={selectedId} neighbors={neighbors} onNavigate={setSelectedId} onBack={() => setSelectedId(null)} onChanged={invalidate} />
      ) : null}
      {viewer ? (
        <FileViewer
          files={[viewer]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setViewer(null)}
          onDownload={(file) => void api.download(file.url, file.name).catch((err: Error) => toast.error(err.message))}
        />
      ) : null}
    </div>
  )
}
