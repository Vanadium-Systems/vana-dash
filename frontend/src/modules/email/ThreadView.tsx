import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Forward, Image as ImageIcon, MessageSquareShare, MoreHorizontal, Paperclip, Reply, ReplyAll, ShieldAlert, Star, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileViewer, type ViewerFile } from '@/shared/components/FileViewer'
import { useShareToMessages } from '@/shared/components/ShareToMessagesDialog'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ResponsiveMenu, ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useHotkeys } from '@/shared/hooks/use-hotkeys'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { api, ApiError } from '@/shared/lib/api'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { linkify } from '@/shared/lib/linkify'
import { dismissDeliveredNotificationsByTag } from '@/shared/lib/native-push'
import { undoToast } from '@/shared/lib/undo-toast'
import type { EmailAttachmentMeta, EmailDraft, EmailMessage, EmailSenderOptions, EmailThread } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { openCompose, type ComposeInit } from './compose/compose-store'
import { ComposeForm } from './compose/ComposeForm'
import { usePhoneLayout, useSendFlowHandlers } from './compose/ComposeWindows'
import { HtmlMessageBody } from './HtmlMessageBody'
import { SnoozeMenu } from './SnoozeMenu'
import { Avatar, senderName, type MoveFolder } from './ThreadRow'

const COLLAPSED_RUN_LIMIT = 4

const attachmentUrl = (attachment: EmailAttachmentMeta) => `/api/email/attachments/${attachment.id}/download`
const listed = (attachment: EmailAttachmentMeta) => attachment.disposition !== 'inline'
const bare = (value: string) => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase()

/** Mail clients append "X wrote:" and the quoted thread; it is shown on request (E14). */
export function splitQuotedReply(text: string): { main: string; quoted: string | null } {
  const match = text.match(/^.*\b(a scris|wrote)\s*:\s*$/im)
  if (!match || match.index === undefined) return { main: text, quoted: null }
  const quoted = text.slice(match.index).trim()
  if (!quoted) return { main: text, quoted: null }
  return { main: text.slice(0, match.index).trimEnd(), quoted }
}

function TextBody({ text }: { text: string }) {
  const { main, quoted } = useMemo(() => splitQuotedReply(text), [text])
  const [showQuoted, setShowQuoted] = useState(false)
  return (
    <div className="email-canvas rounded-sm p-3 text-sm">
      <p className="whitespace-pre-wrap break-words">{main ? linkify(main) : t('email:body.noText')}</p>
      {quoted ? (
        <button type="button" className="mt-1.5 rounded px-1 text-xs opacity-60 hover:opacity-100" aria-expanded={showQuoted} onClick={() => setShowQuoted((v) => !v)}>
          {showQuoted ? t('email:thread.hideQuoted') : t('email:thread.showQuotedShort')}
        </button>
      ) : null}
      {quoted && showQuoted ? <p className="mt-1.5 whitespace-pre-wrap break-words text-xs opacity-70">{linkify(quoted)}</p> : null}
    </div>
  )
}

function AttachmentChip({ attachment, onOpen }: { attachment: EmailAttachmentMeta; onOpen: () => void }) {
  const Icon = attachment.contentType?.startsWith('image/') ? ImageIcon : attachment.contentType === 'application/pdf' ? FileText : Paperclip
  return (
    <button type="button" onClick={onOpen} title={attachment.filename} className="inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-muted">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{attachment.filename}</span>
    </button>
  )
}

export interface ThreadNeighbors {
  position: number
  total: number
  prevId: string | null
  nextId: string | null
}

type Item = { kind: 'message'; message: EmailMessage; expanded: boolean } | { kind: 'more'; count: number; ids: string[] }

/**
 * `messages` newest first (the owner's choice over Gmail's oldest first: the latest is what one
 * reads and answers, so it sits under the subject). Read messages collapse to a line; the newest
 * and unread ones stay open; a run of more than four collapsed lines becomes one "N older" line.
 */
export function buildThreadItems(messages: EmailMessage[], expandedIds: Set<string>, revealedIds: Set<string>): Item[] {
  const last = messages[0]
  const open = (m: EmailMessage) => m.id === last?.id || (m.direction === 'in' && !m.isRead) || expandedIds.has(m.id)
  const items: Item[] = []
  let run: EmailMessage[] = []
  const flush = () => {
    if (run.length > COLLAPSED_RUN_LIMIT && !run.some((m) => revealedIds.has(m.id))) {
      const middle = run.slice(1, -1)
      items.push({ kind: 'message', message: run[0] as EmailMessage, expanded: false })
      items.push({ kind: 'more', count: middle.length, ids: middle.map((m) => m.id) })
      items.push({ kind: 'message', message: run[run.length - 1] as EmailMessage, expanded: false })
    } else {
      for (const m of run) items.push({ kind: 'message', message: m, expanded: false })
    }
    run = []
  }
  for (const m of messages) {
    if (open(m)) {
      flush()
      items.push({ kind: 'message', message: m, expanded: true })
    } else run.push(m)
  }
  flush()
  return items
}

export function ThreadView({
  threadId,
  neighbors,
  onNavigate,
  onBack,
  onChanged,
}: {
  threadId: string
  neighbors: ThreadNeighbors | null
  onNavigate: (threadId: string) => void
  onBack: () => void
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const { session, can } = useMe()
  const members = useTeamMembers()
  const phone = usePhoneLayout()
  const handlers = useSendFlowHandlers()
  const { canShare, share, dialog: shareDialog } = useShareToMessages()
  const messagesRef = useRef<HTMLDivElement>(null)
  const [quote, setQuote] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [detailsFor, setDetailsFor] = useState<string | null>(null)
  const [reply, setReply] = useState<ComposeInit | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  useEffect(() => {
    setExpandedIds(new Set())
    setRevealedIds(new Set())
    setReply(null)
    setDetailsFor(null)
  }, [threadId])

  // A selection inside the message bodies can be shared to Messages as a quote (MS7).
  useEffect(() => {
    const onSelectionChange = () => {
      const selection = document.getSelection()
      const container = messagesRef.current
      const text = selection?.toString().trim() ?? ''
      const inside = Boolean(container && selection?.anchorNode && selection.focusNode && container.contains(selection.anchorNode) && container.contains(selection.focusNode))
      setQuote(inside && text.length > 0 ? text.slice(0, 1000) : '')
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const detail = useQuery({
    queryKey: ['email', 'threads', threadId],
    queryFn: () => api.get<{ thread: EmailThread; messages: EmailMessage[] }>(`/api/email/threads/${threadId}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  })
  const senderOptions = useQuery({
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
    staleTime: 5 * 60 * 1000,
  })
  // A reply started earlier on this thread reopens where it was left (E16).
  const replyDraft = useQuery({
    queryKey: ['email', 'drafts', 'thread', threadId],
    queryFn: () => api.get<EmailDraft[]>(`/api/email/drafts?threadId=${threadId}`),
    enabled: can('email.trimitere'),
  })
  useEffect(() => {
    const draft = replyDraft.data?.find((d) => d.mode === 'reply' || d.mode === 'reply_all')
    if (draft && !reply && !phone) setReply({ kind: 'draft', draft })
    // Only when the drafts arrive; closing the reply must not reopen it.
  }, [replyDraft.data])

  useEffect(() => {
    void dismissDeliveredNotificationsByTag(`thread-${threadId}`)
  }, [threadId])

  // Guarded on threadId: every refetch gives detail.data a new identity, and an unguarded effect
  // re-sent bulk-update in a loop (2026-08-27, enough to hit the global rate limit).
  const markedReadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!detail.data || markedReadRef.current === threadId) return
    const unread = detail.data.messages.filter((m) => m.direction === 'in' && !m.isRead)
    if (unread.length === 0) return
    markedReadRef.current = threadId
    void api.post('/api/email/messages/bulk-update', { ids: unread.map((m) => m.id), patch: { isRead: true } }).then(onChanged)
  }, [detail.data, onChanged, threadId])

  const inboundIds = (detail.data?.messages ?? []).filter((m) => m.direction === 'in').map((m) => m.id)
  const applyFolder = (folder: MoveFolder) => {
    const origin = detail.data?.thread.folder ?? 'inbox'
    onBack()
    void undoToast(
      t(`email:toasts.moved.${folder}`, { count: 1 }),
      () => api.post('/api/email/messages/bulk-update', { ids: inboundIds, patch: { folder } }).then(onChanged),
      () => api.post('/api/email/messages/bulk-update', { ids: inboundIds, patch: { folder: origin } }).then(onChanged),
    )
  }
  const snooze = useMutation({
    mutationFn: (until: string) => api.post('/api/email/messages/bulk-update', { ids: inboundIds, patch: { snoozedUntil: until } }),
    onSuccess: (_, until) => {
      onChanged()
      onBack()
      toast.success(t('email:snooze.done', { when: formatDateTime(until) }))
    },
    onError: (err) => toast.error(err.message),
  })
  const toggleStar = useMutation({
    mutationFn: (message: EmailMessage) => api.patch(`/api/email/messages/${message.id}`, { isStarred: !message.isStarred }),
    onSuccess: () => {
      onChanged()
      void queryClient.invalidateQueries({ queryKey: ['email', 'threads', threadId] })
    },
  })

  // Newest first, as the API returns them.
  const messages = useMemo(() => detail.data?.messages ?? [], [detail.data])
  const lastInbound = useMemo(() => messages.find((m) => m.direction === 'in'), [messages])
  const items = useMemo(() => buildThreadItems(messages, expandedIds, revealedIds), [messages, expandedIds, revealedIds])

  const ownAddresses = useMemo(
    () => new Set((senderOptions.data?.identities ?? []).map((i) => bare(i.fromAddress)).filter(Boolean)),
    [senderOptions.data],
  )
  const startReply = (replyAll: boolean) => {
    if (!detail.data || !lastInbound) return
    const to = [bare(lastInbound.replyToAddress || lastInbound.fromAddress)]
    const cc = replyAll
      ? Array.from(new Set(detail.data.thread.participants.map(bare))).filter((a) => a && !ownAddresses.has(a) && a !== bare(lastInbound.toAddress) && !to.includes(a)).slice(0, 10)
      : []
    const init: ComposeInit = { kind: 'reply', threadId, replyAll, lastSeenMessageId: messages[0]?.id ?? null, fromAddress: lastInbound.toAddress, to, cc }
    // A phone gets the whole screen; on a desktop the reply sits under the thread (E14).
    if (phone) openCompose(init)
    else setReply(init)
  }
  const startForward = (message: EmailMessage) =>
    openCompose({ kind: 'forward', messageId: message.id, threadId, subject: message.subject, fromAddress: message.toAddress })

  const canSend = can('email.trimitere')
  useHotkeys(
    [
      { keys: 'r', label: t('common:actions.reply'), onKey: (e) => { e.preventDefault(); startReply(false) } },
      { keys: 'a', label: t('email:thread.replyAll'), onKey: (e) => { e.preventDefault(); startReply(true) } },
      { keys: 'f', label: t('email:actions.forward'), onKey: (e) => { e.preventDefault(); if (lastInbound) startForward(lastInbound) } },
      { keys: 'e', label: t('common:actions.archive'), onKey: () => applyFolder('archive') },
      { keys: 'shift+#', label: t('common:actions.delete'), onKey: () => applyFolder('trash') },
      { keys: 'j', label: t('email:thread.next'), onKey: () => neighbors?.nextId && onNavigate(neighbors.nextId) },
      { keys: 'k', label: t('email:thread.previous'), onKey: () => neighbors?.prevId && onNavigate(neighbors.prevId) },
      { keys: 'u', label: t('email:thread.backToList'), onKey: onBack },
    ],
    { enabled: Boolean(detail.data) && !reply },
  )

  if (detail.isPending) return <Skeleton className="h-64 w-full" />
  if (detail.isError || !detail.data) {
    const gone = detail.error instanceof ApiError && detail.error.status === 404
    return (
      <EmptyState
        kind="new"
        title={gone ? t('email:thread.gone') : t('email:thread.loadFailed')}
        action={
          <Button variant="outline" onClick={onBack}>
            {t('email:thread.backToList')}
          </Button>
        }
      />
    )
  }

  const { thread } = detail.data
  const threadFiles: ViewerFile[] = messages.flatMap((m) =>
    m.attachments.filter(listed).map((a) => ({ id: a.id, name: a.filename, url: attachmentUrl(a), mimeType: a.contentType ?? '' })),
  )
  const openFile = (attachmentId: string) => setViewerIndex(threadFiles.findIndex((file) => file.id === attachmentId))
  const authorOf = (m: EmailMessage) => {
    if (m.direction === 'in') return senderName(m.fromAddress)
    if (!m.sentByUserId || m.sentByUserId === session?.user.id) return t('email:thread.me')
    const member = members.data?.find((candidate) => candidate.id === m.sentByUserId)
    return member ? memberName(member) : senderName(m.fromAddress)
  }

  const actions = (
    <>
      {canShare ? (
        <DropdownMenuItem onClick={() => share({ type: 'email_thread', id: thread.id, title: thread.subject || t('email:labels.noSubject') })}>
          <MessageSquareShare className="h-4 w-4" /> {t('messages:share.action')}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={() => applyFolder('spam')}>
        <ShieldAlert className="h-4 w-4" /> {t('email:folders.spam')}
      </DropdownMenuItem>
    </>
  )

  return (
    <div className="min-w-0">
      <div className="flex min-h-9 items-center gap-1 pb-2">
        <Button variant="ghost" size="icon" title={t('email:thread.backToList')} aria-label={t('email:thread.backToList')} onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="hidden items-center gap-1 sm:flex">
          <Button variant="ghost" size="icon" title={t('common:actions.archive')} aria-label={t('common:actions.archive')} onClick={() => applyFolder('archive')}>
            <Archive className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title={t('common:actions.delete')} aria-label={t('common:actions.delete')} onClick={() => applyFolder('trash')}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <SnoozeMenu onSnooze={(until) => snooze.mutate(until)} disabled={snooze.isPending} triggerClassName="inline-flex h-control-md w-control-md items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" />
        </div>
        <ResponsiveMenu>
          <DropdownMenuTrigger className="inline-flex h-control-md w-control-md items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('common:actions.more')}</span>
          </DropdownMenuTrigger>
          <ResponsiveMenuContent title={thread.subject || t('email:labels.noSubject')} align="start">
            <div className="sm:hidden">
              <DropdownMenuItem onClick={() => applyFolder('archive')}>
                <Archive className="h-4 w-4" /> {t('common:actions.archive')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => applyFolder('trash')}>
                <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
              </DropdownMenuItem>
            </div>
            {actions}
          </ResponsiveMenuContent>
        </ResponsiveMenu>
        {canShare && quote ? (
          <Button
            variant="ghost"
            size="sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => share({ type: 'email_thread', id: thread.id, title: thread.subject || t('email:labels.noSubject'), quote })}
          >
            <MessageSquareShare className="h-4 w-4" /> {t('messages:share.quote')}
          </Button>
        ) : null}
        {neighbors ? (
          <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{t('email:thread.position', { position: neighbors.position, total: neighbors.total })}</span>
            <Button variant="ghost" size="icon" title={t('email:thread.previous')} aria-label={t('email:thread.previous')} disabled={!neighbors.prevId} onClick={() => neighbors.prevId && onNavigate(neighbors.prevId)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" title={t('email:thread.next')} aria-label={t('email:thread.next')} disabled={!neighbors.nextId} onClick={() => neighbors.nextId && onNavigate(neighbors.nextId)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      <h2 className="px-1 pb-3 text-lg font-semibold [overflow-wrap:anywhere]">{thread.subject || t('email:labels.noSubject')}</h2>

      {canSend && lastInbound ? (
        reply && !phone ? (
          <div className="mb-3 rounded-md border px-3">
            <ComposeForm key={reply.kind === 'draft' ? reply.draft.id : 'reply'} init={reply} variant="inline" handlers={handlers} onDone={() => setReply(null)} />
          </div>
        ) : (
          // E34: on a phone the three actions sit at the bottom, under the thumb: a third of the
          // width each, icon over a short label, so "Reply all" fits without stretching the row.
          phone ? (
            <div className="glass fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-30 grid grid-cols-3 gap-1 border-t px-2 py-1.5">
              {[
                { key: 'reply', icon: <Reply className="h-4 w-4" />, label: t('common:actions.reply'), onClick: () => startReply(false) },
                { key: 'all', icon: <ReplyAll className="h-4 w-4" />, label: t('email:thread.replyAll'), onClick: () => startReply(true) },
                { key: 'fwd', icon: <Forward className="h-4 w-4" />, label: t('email:actions.forward'), onClick: () => startForward(lastInbound) },
              ].map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  className="flex min-w-0 flex-col items-center gap-0.5 rounded-md py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {action.icon}
                  <span className="max-w-full truncate">{action.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mb-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => startReply(false)}>
                <Reply className="h-4 w-4" /> {t('common:actions.reply')}
              </Button>
              <Button variant="outline" onClick={() => startReply(true)}>
                <ReplyAll className="h-4 w-4" /> {t('email:thread.replyAll')}
              </Button>
              <Button variant="outline" onClick={() => startForward(lastInbound)}>
                <Forward className="h-4 w-4" /> {t('email:actions.forward')}
              </Button>
            </div>
          )
        )
      ) : null}
      <div ref={messagesRef} className="divide-y border-y">
        {items.map((item) => {
          if (item.kind === 'more') {
            return (
              <button
                key={`more-${item.ids[0]}`}
                type="button"
                className="block w-full py-2 text-center text-sm text-muted-foreground hover:bg-muted"
                onClick={() => setRevealedIds((prev) => new Set([...prev, ...item.ids]))}
              >
                {t('email:thread.older', { count: item.count })}
              </button>
            )
          }
          const m = item.message
          const date = m.receivedAt ?? m.createdAt
          if (!item.expanded) {
            return (
              <button
                key={m.id}
                type="button"
                className="flex w-full items-center gap-3 px-1 py-2 text-left text-sm hover:bg-muted"
                onClick={() => setExpandedIds((prev) => new Set([...prev, m.id]))}
              >
                <Avatar address={m.fromAddress} size={32} />
                <span className="w-32 shrink-0 truncate font-medium sm:w-44">{authorOf(m)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{(m.bodyText ?? '').replace(/\s+/g, ' ').slice(0, 160)}</span>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={date} title={formatDateTime(date)}>
                  {formatRelativeTime(date)}
                </time>
              </button>
            )
          }
          const files = m.attachments.filter(listed)
          return (
            <article key={m.id} className="px-1 py-3">
              <header className="mb-2 flex items-start gap-3">
                <Avatar address={m.fromAddress} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold">{authorOf(m)}</span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{bare(m.fromAddress)}</span>
                  </p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
                    aria-expanded={detailsFor === m.id}
                    onClick={() => setDetailsFor((id) => (id === m.id ? null : m.id))}
                  >
                    {ownAddresses.has(bare(m.toAddress)) ? t('email:thread.toMe') : t('email:thread.toAddress', { address: bare(m.toAddress) })}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {detailsFor === m.id ? (
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <dt>{t('email:compose.from')}</dt>
                      <dd className="min-w-0 [overflow-wrap:anywhere]">{m.fromAddress}</dd>
                      <dt>{t('common:labels.to')}</dt>
                      <dd className="min-w-0 [overflow-wrap:anywhere]">{m.toAddress}</dd>
                      <dt>{t('email:thread.date')}</dt>
                      <dd>{formatDateTime(date)}</dd>
                    </dl>
                  ) : null}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={date} title={formatDateTime(date)}>
                  {formatRelativeTime(date)}
                </time>
                {m.direction === 'in' ? (
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                    title={m.isStarred ? t('email:thread.unstar') : t('email:thread.star')}
                    aria-label={m.isStarred ? t('email:thread.unstar') : t('email:thread.star')}
                    aria-pressed={m.isStarred}
                    onClick={() => toggleStar.mutate(m)}
                  >
                    <Star className={cn('h-4 w-4', m.isStarred && 'fill-warning text-warning')} />
                  </button>
                ) : null}
              </header>
              {m.bodyHtml ? (
                <HtmlMessageBody html={m.bodyHtml} attachments={m.attachments} fallbackText={m.bodyText} autoLoadImages={senderOptions.data?.autoLoadImages} />
              ) : (
                <TextBody text={m.bodyText ?? ''} />
              )}
              {files.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {files.map((a) => (
                    <AttachmentChip key={a.id} attachment={a} onOpen={() => openFile(a.id)} />
                  ))}
                  {files.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void api
                          .download(`/api/email/messages/${m.id}/attachments.zip`, `${(thread.subject || 'attachments').slice(0, 60)}.zip`)
                          .catch((err: Error) => toast.error(err instanceof ApiError && err.code === 'ZIP_TOO_LARGE' ? t('email:thread.zipTooLarge') : err.message))
                      }
                    >
                      <Download className="h-3.5 w-3.5" /> {t('email:thread.downloadAll')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {m.direction === 'in' && canSend ? (
                <div className="mt-2">
                  <Button variant="ghost" size="sm" onClick={() => startForward(m)}>
                    <Forward className="h-3.5 w-3.5" /> {t('email:actions.forward')}
                  </Button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>

      {phone ? <div aria-hidden="true" className="h-16" /> : null}

      {viewerIndex !== null && viewerIndex >= 0 ? (
        <FileViewer
          files={threadFiles}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onDownload={(file) => void api.download(file.url, file.name).catch((err: Error) => toast.error(err.message))}
        />
      ) : null}
      {shareDialog}
    </div>
  )
}
