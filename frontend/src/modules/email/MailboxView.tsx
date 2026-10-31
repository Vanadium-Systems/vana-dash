import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, ChevronLeft, ChevronRight, Download, FileText, Forward, Mail, MailOpen, Paperclip, RefreshCw, Reply, ShieldAlert, Star, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { ContextMenu, useContextMenu } from '@/shared/components/ui/context-menu'
import { DropdownMenuItem, MenuShortcut } from '@/shared/components/ui/dropdown-menu'
import { SelectionBar } from '@/shared/components/ui/selection-bar'
import { ListSkeleton, Skeleton } from '@/shared/components/ui/skeleton'
import { useHotkeys } from '@/shared/hooks/use-hotkeys'
import { useSelection } from '@/shared/hooks/use-selection'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { undoToast } from '@/shared/lib/undo-toast'
import { FileViewer, type ViewerFile } from '@/shared/components/FileViewer'
import { usePageRefresh } from '@/shared/hooks/use-pull-to-refresh'
import { useSwipeRow } from '@/shared/hooks/use-swipe-row'
import { haptic } from '@/shared/lib/haptics'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { api } from '@/shared/lib/api'
import { dismissDeliveredNotificationsByTag } from '@/shared/lib/native-push'
import { cn } from '@/shared/lib/utils'
import type { EmailAttachmentMeta, EmailMessage, EmailSenderOptions, EmailThread } from '@/shared/lib/types'
import type { EmailView } from './EmailSidebar'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { useMe } from '@/shared/hooks/use-me'
import { extractEmailAddress } from './identity'
import { identitiesFor } from './IdentityField'
import { HtmlMessageBody } from './HtmlMessageBody'
import { SnoozeMenu } from './SnoozeMenu'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(intlTag(), { dateStyle: 'medium', timeStyle: 'short' })
}

// Afișat doar în view-uri "mixte" (etichetă/Marcate/Toate mesajele), unde folder-ul nu e deja
// implicit din context — într-un view de folder unic (Inbox/Arhivă/Spam) ar fi zgomot redundant.
const FOLDER_BADGE_LABEL: Partial<Record<EmailThread['folder'] & string, string>> = {
  archive: t('email:toasts.archived'),
  spam: t('email:folders.spam'),
  trash: t('email:folders.trash'),
}

// Clientele de mail (Gmail etc.) adaugă automat "X a scris:"/"X wrote:" + corpul citat cu
// ">" la fiecare reply — util în client-ul lor, doar zgomot aici (thread-ul original e deja
// afișat ca bulă separată mai sus). Nu atinge datele stocate, doar cum le randăm — Stefan
// poate oricând extinde citatul dacă chiar are nevoie de el.
function splitQuotedReply(text: string): { main: string; quoted: string | null } {
  const match = text.match(/^.*\b(a scris|wrote)\s*:\s*$/im)
  if (!match || match.index === undefined) return { main: text, quoted: null }
  const quoted = text.slice(match.index).trim()
  if (!quoted) return { main: text, quoted: null }
  return { main: text.slice(0, match.index).trimEnd(), quoted }
}

// Corpul emailului e text simplu (nu HTML — vezi shared/lib/api.ts, bodyText), deci fără
// dangerouslySetInnerHTML: transformăm DOAR segmentele care arată ca URL în <a>, restul
// rămâne text simplu escapat normal de React (zero risc XSS din conținut extern).
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"')\]]+)/g

function linkify(text: string) {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part // segment text simplu (indecșii pari, din split cu 1 grup capturat)
    // punctuația de final de propoziție (., ),  !, ?) nu face parte din URL
    const trailing = /[.,;:!?)\]]+$/.exec(part)?.[0] ?? ''
    const url = trailing ? part.slice(0, -trailing.length) : part
    const href = url.startsWith('www.') ? `https://${url}` : url
    return (
      <span key={i}>
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">
          {url}
        </a>
        {trailing}
      </span>
    )
  })
}

function MessageBody({ text }: { text: string }) {
  const { main, quoted } = useMemo(() => splitQuotedReply(text), [text])
  const [showQuoted, setShowQuoted] = useState(false)
  return (
    <div>
      {/* Canvas alb și pt. text simplu (Contract E) — același contract vizual ca HTML. */}
      <p className="email-canvas whitespace-pre-wrap break-words rounded-sm border p-4">{main ? linkify(main) : t('email:body.noText')}</p>
      {quoted ? (
        <button
          type="button"
          className="mt-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:underline"
          onClick={() => setShowQuoted((v) => !v)}
        >
          {showQuoted ? t('email:thread.hideQuoted') : t('email:thread.showQuoted')}
        </button>
      ) : null}
      {quoted && showQuoted ? (
        <p className="mt-1.5 whitespace-pre-wrap break-words border-l-2 pl-2 text-xs text-muted-foreground/70">{linkify(quoted)}</p>
      ) : null}
    </div>
  )
}

const attachmentUrl = (attachment: EmailAttachmentMeta) => `/api/email/attachments/${attachment.id}/download`

// Opens over the page with the thread's other files a ← → away (E12), instead of a new tab or a download.
function AttachmentRow({ attachment, onOpen }: { attachment: EmailAttachmentMeta; onOpen: () => void }) {
  const isImage = attachment.contentType?.startsWith('image/')
  const isPdf = attachment.contentType === 'application/pdf'
  if (isImage) {
    return (
      <button type="button" onClick={onOpen} className="block w-fit max-w-full text-left">
        <img src={attachmentUrl(attachment)} alt={attachment.filename} loading="lazy" className="max-h-40 rounded-md border" />
        <p className="mt-1 max-w-40 truncate text-xs text-muted-foreground">{attachment.filename}</p>
      </button>
    )
  }
  return (
    <button type="button" onClick={onOpen} className="flex max-w-full items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
      {isPdf ? <FileText className="h-4 w-4 shrink-0 text-destructive" /> : <Download className="h-4 w-4 shrink-0" />}
      <span className="truncate">{attachment.filename}</span>
    </button>
  )
}

const isListedAttachment = (attachment: EmailAttachmentMeta) => attachment.disposition !== 'inline'

interface ThreadDetailProps {
  threadId: string
  onReply: (thread: EmailThread, lastInbound: EmailMessage) => void
  onForward: (message: EmailMessage) => void
  onBack: () => void
  onChanged: () => void
}

function ThreadDetail({ threadId, onReply, onForward, onBack, onChanged }: ThreadDetailProps) {
  const queryClient = useQueryClient()
  const { session } = useMe()
  const members = useTeamMembers()
  const myId = session?.user.id
  // Numele trimiștorului vine din lista de membri, deja încărcată pentru „Trimis de" — un
  // query per mesaj ar fi un N+1 pe fir.
  const senderName = (id: string) => {
    const member = members.data?.find((candidate) => candidate.id === id)
    return member ? memberName(member) : 'altcineva'
  }

  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const detail = useQuery({
    queryKey: ['email', 'threads', threadId],
    queryFn: () => api.get<{ thread: EmailThread; messages: EmailMessage[] }>(`/api/email/threads/${threadId}`),
  })

  // Setarea "încarcă imaginile" — citită o dată pe sesiune, schimbată doar din Setări Email
  const settings = useQuery({
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
    staleTime: 5 * 60 * 1000,
  })

  // Șterge notificarea Android rămasă în bară pt. acest thread (tag=`thread-<id>`, setat în
  // backend la trimiterea push-ului) — no-op pe web/dacă native indisponibil (native-push.ts).
  useEffect(() => {
    void dismissDeliveredNotificationsByTag(`thread-${threadId}`)
  }, [threadId])

  // Gardă pe threadId: fără ea, invalidateQueries de mai jos re-declanșează acest efect la
  // fiecare refetch (detail.data capătă mereu o identitate nouă) — dacă refetch-ul ajunge
  // înapoi cu mesajele încă nemarcate (race cu alt poll/tab pe același thread), efectul repornea
  // bulk-update în buclă la viteza rețelei. Incident 2026-08-27: zeci de cereri/secundă pe un
  // singur thread, suficient să epuizeze rate-limit-ul global și să pice email-ul cu 429.
  const markedReadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!detail.data || markedReadRef.current === threadId) return
    const unread = detail.data.messages.filter((m) => m.direction === 'in' && !m.isRead)
    if (unread.length === 0) return
    markedReadRef.current = threadId
    void api
      .post('/api/email/messages/bulk-update', { ids: unread.map((m) => m.id), patch: { isRead: true } })
      .then(() => {
        onChanged()
        void queryClient.invalidateQueries({ queryKey: ['email', 'threads', threadId] })
      })
  }, [detail.data, onChanged, queryClient, threadId])

  const applyFolder = {
    mutate: (folder: MoveFolder) => {
      const ids = (detail.data?.messages ?? []).filter((m) => m.direction === 'in').map((m) => m.id)
      const origin = detail.data?.thread.folder ?? 'inbox'
      onBack()
      void undoToast(
        t(`email:toasts.moved.${folder}`, { count: 1 }),
        () => api.post('/api/email/messages/bulk-update', { ids, patch: { folder } }).then(onChanged),
        () => api.post('/api/email/messages/bulk-update', { ids, patch: { folder: origin } }).then(onChanged),
      )
    },
  }

  const snooze = useMutation({
    mutationFn: (until: string) => {
      const ids = (detail.data?.messages ?? []).filter((m) => m.direction === 'in').map((m) => m.id)
      return api.post('/api/email/messages/bulk-update', { ids, patch: { snoozedUntil: until } })
    },
    onSuccess: (_, until) => {
      onChanged()
      onBack()
      toast.success(t('email:snooze.done', { when: formatDateTime(until) }))
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleStar = useMutation({
    mutationFn: (messageId: string) => api.patch(`/api/email/messages/${messageId}`, { isStarred: true }),
    onSuccess: () => {
      onChanged()
      void queryClient.invalidateQueries({ queryKey: ['email', 'threads', threadId] })
    },
  })

  if (detail.isPending) return <Skeleton className="h-64 w-full" />
  if (detail.isError || !detail.data) return <p className="text-sm text-destructive">{t('email:thread.loadFailed')}</p>

  const { thread, messages } = detail.data
  const threadFiles: ViewerFile[] = messages.flatMap((m) =>
    m.attachments.filter(isListedAttachment).map((a) => ({ id: a.id, name: a.filename, url: attachmentUrl(a), mimeType: a.contentType ?? '' })),
  )
  const openFile = (attachmentId: string) => setViewerIndex(threadFiles.findIndex((file) => file.id === attachmentId))
  // messages vine sortat descrescător de la backend (cel mai recent primul) — primul inbound
  // găsit AICI e deja cel mai recent, fără reverse.
  const lastInbound = messages.find((m) => m.direction === 'in')

  return (
    <Card className="min-w-0">
      <CardContent className="min-w-0 space-y-4 pt-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="min-w-0 truncate text-lg font-semibold">{thread.subject}</h2>
          </div>
          <div className="flex gap-1">
            <SnoozeMenu onSnooze={(until) => snooze.mutate(until)} disabled={snooze.isPending} />
            <Button variant="outline" title={t('common:actions.archive')} onClick={() => applyFolder.mutate('archive')}>
              <Archive className="h-4 w-4" />
            </Button>
            <Button variant="outline" title={t('email:folders.spam')} onClick={() => applyFolder.mutate('spam')}>
              <ShieldAlert className="h-4 w-4" />
            </Button>
            <Button variant="outline" title={t('common:actions.delete')} onClick={() => applyFolder.mutate('trash')}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {lastInbound ? (
          <Button onClick={() => onReply(thread, lastInbound)}>
            <Reply className="h-4 w-4" /> {t('common:actions.reply')}
          </Button>
        ) : null}
        <div className="space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn('rounded-md border p-3 text-sm', m.direction === 'in' ? 'bg-muted/50' : 'ml-6 border-primary/30 bg-primary/5')}
            >
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {m.direction === 'in' ? (
                    <>
                      {m.fromAddress} <span className="rounded bg-muted px-1 py-0.5">→ {m.toAddress}</span>
                    </>
                  ) : (
                    <>
                      {m.sentByUserId && m.sentByUserId !== myId ? (
                        <span>
                          {t('email:thread.sentBy', { sentByUserId: senderName(m.sentByUserId), toAddress: m.toAddress })}
                        </span>
                      ) : (
                        <>
                          {t('email:thread.youTo', { toAddress: m.toAddress })}
                        </>
                      )}
                    </>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span>{formatDateTime(m.receivedAt ?? m.createdAt)}</span>
                  {m.direction === 'in' ? (
                    <button onClick={() => toggleStar.mutate(m.id)} title={t('email:thread.star')}>
                      <Star className={cn('h-3.5 w-3.5', m.isStarred ? 'fill-warning text-warning' : 'text-muted-foreground')} />
                    </button>
                  ) : null}
                </div>
              </div>
              {m.bodyHtml ? (
                <HtmlMessageBody html={m.bodyHtml} attachments={m.attachments} fallbackText={m.bodyText} autoLoadImages={settings.data?.autoLoadImages} />
              ) : (
                <MessageBody text={m.bodyText ?? t('email:body.noText')} />
              )}
              {/* disposition='inline' — poze embedate pt. estetica emailului (logo, iconițe
                  semnătură), deja randate ÎN corp de HtmlMessageBody (cid: rescris mai sus) —
                  apăreau greșit și aici, a doua oară, ca „atașamente" reale. */}
              {m.attachments.filter((a) => a.disposition !== 'inline').length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.attachments
                    .filter((a) => a.disposition !== 'inline')
                    .map((a) => (
                      <AttachmentRow key={a.id} attachment={a} onOpen={() => openFile(a.id)} />
                    ))}
                </div>
              ) : null}
              {m.direction === 'in' ? (
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" onClick={() => onForward(m)}>
                    <Forward className="h-3.5 w-3.5" /> {t('email:actions.forward')}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
      {viewerIndex !== null && viewerIndex >= 0 ? (
        <FileViewer
          files={threadFiles}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onDownload={(file) => void api.download(file.url, file.name).catch((err: Error) => toast.error(err.message))}
        />
      ) : null}
    </Card>
  )
}

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

type MoveFolder = 'archive' | 'spam' | 'trash'

function ThreadRow({
  thread,
  opened,
  selected,
  showFolderBadge,
  onActivate,
  onToggle,
  onLongPress,
  onMove,
  onMarkRead,
}: {
  thread: EmailThread
  opened: boolean
  selected: boolean
  showFolderBadge: boolean
  onActivate: (e: MouseEvent) => void
  onToggle: () => void
  onLongPress: { start: () => void; cancel: () => void }
  onMove: (folder: MoveFolder) => void
  onMarkRead: (isRead: boolean) => void
}) {
  const contextMenu = useContextMenu()
  // Swipe left on a phone moves the thread to Trash, with the same undo as the menu (E31).
  const swipe = useSwipeRow({
    onSwipeLeft: () => {
      void haptic('tap')
      onMove('trash')
    },
  })
  return (
    <div className="relative overflow-hidden rounded-md">
      {swipe.offset < 0 ? (
        <div aria-hidden="true" className="absolute inset-0 flex items-center justify-end bg-destructive px-4 text-destructive-foreground">
          <Trash2 className="h-5 w-5" />
        </div>
      ) : null}
      <div
        className={cn('relative flex items-start gap-2 rounded-md bg-card p-2 text-sm transition-colors hover:bg-muted', (opened || selected) && 'bg-muted')}
        onContextMenu={contextMenu.onContextMenu}
        style={swipe.style}
        {...swipe.handlers}
      >
        <Checkbox className="mt-0.5" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label={thread.subject || t('email:labels.noSubject')} />
        <button
          className="flex min-w-0 flex-1 select-none items-start gap-1.5 text-left"
          onClick={onActivate}
          onTouchStart={onLongPress.start}
          onTouchEnd={onLongPress.cancel}
          onTouchMove={onLongPress.cancel}
        >
          {!thread.isRead ? (
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive" title={t('common:states.unread')} />
          ) : (
            <span className="mt-1.5 h-2 w-2 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            <p className={cn('flex items-center gap-1', !thread.isRead && 'font-semibold')}>
              <span className="min-w-0 truncate">
                {thread.isStarred ? <Star className="mr-1 inline h-3 w-3 fill-warning text-warning" /> : null}
                {thread.subject || t('email:labels.noSubject')}
              </span>
              {thread.attachmentNames.length > 0 ? (
                <span
                  className="ml-auto flex shrink-0 items-center gap-0.5 text-xs font-normal text-muted-foreground"
                  title={thread.attachmentNames.join(', ')}
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  {thread.attachmentNames.length > 1 ? <span className="shrink-0">{thread.attachmentNames.length}·</span> : null}
                  <span className="max-w-[110px] truncate">{thread.attachmentNames.join(', ')}</span>
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{thread.fromAddress ?? thread.participants.join(', ')}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="shrink-0">{formatDateTime(thread.lastMessageAt)}</span>
              <span className="ml-auto flex min-w-0 items-center gap-1">
                {thread.toAddress ? (
                  <span className="truncate rounded bg-muted px-1 py-0.5" title={t('email:list.receivedOn', { toAddress: thread.toAddress })}>
                    → {thread.toAddress}
                  </span>
                ) : null}
                {showFolderBadge && thread.folder && FOLDER_BADGE_LABEL[thread.folder] ? (
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5">{FOLDER_BADGE_LABEL[thread.folder]}</span>
                ) : null}
              </span>
            </p>
          </span>
        </button>
        <ContextMenu state={contextMenu}>
          <DropdownMenuItem onClick={() => onMove('archive')}>
            <Archive className="h-4 w-4" /> {t('common:actions.archive')}
            <MenuShortcut>E</MenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMarkRead(!thread.isRead)}>
            {thread.isRead ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            {thread.isRead ? t('common:states.unread') : t('email:list.read')}
            <MenuShortcut>{thread.isRead ? `${t('common:keys.shift')} U` : `${t('common:keys.shift')} I`}</MenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove('spam')}>
            <ShieldAlert className="h-4 w-4" /> {t('email:folders.spam')}
            <MenuShortcut>!</MenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem destructive onClick={() => onMove('trash')}>
            <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
            <MenuShortcut>#</MenuShortcut>
          </DropdownMenuItem>
        </ContextMenu>
      </div>
    </div>
  )
}

export function MailboxView({
  view,
  onReply,
  onForward,
}: {
  view: Extract<EmailView, { kind: 'mailbox' }>
  onReply: (thread: EmailThread, lastInbound: EmailMessage) => void
  onForward: (message: EmailMessage) => void
}) {
  const queryClient = useQueryClient()
  const { session } = useMe()
  // Persistat în URL (?thread=<id>), nu doar în state local — reload/link direct/bookmark pe
  // un thread anume revenea mereu la listă goală, silențios (bug 1d). Pattern identic
  // viewFromParams/paramsFromView din EmailPage.tsx.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('thread')
  const setSelectedId = (id: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id) next.set('thread', id)
      else next.delete('thread')
      return next
    })
  }
  // In the URL, so a search survives reload and Back and can be linked to (E25).
  const [search, setSearch] = useUrlState('q')
  const [toAddress, setToAddress] = useState('')
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  const debouncedSearch = useDebounced(search, 300)

  // Adresele lui de recepție (stefan@, contact@, outreach@ etc.) — sursa filtrului „pe ce
  // adresă am primit" (Stefan are mai multe identități, vrea să separe fluxul).
  const settingsForFilter = useQuery({
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
    staleTime: 5 * 60 * 1000,
  })
  // Filtrele „pe ce adresă am primit" arată doar cutiile omului — un coleg nu are ce căuta
  // pe o cutie care nu e a lui, iar serverul oricum n-ar returna nimic.
  const receivingAddresses = identitiesFor(settingsForFilter.data?.identities, session?.mailboxes)
    .map((i) => ({ key: i.key, label: i.label, address: extractEmailAddress(i.fromAddress) }))
    .filter((i) => i.address)
  // Etichetă/Marcate/Toate mesajele — mixează folderele, badge-ul de folder e util acolo.
  // Un folder unic (Inbox/Arhivă/Spam/Coș) îl arată deja contextul paginii, ar fi zgomot.
  const showFolderBadge = !view.folder || view.folder === 'all' || Boolean(view.starred)

  // Skip pe primul render — altfel un reload/link direct pe ?thread=<id> ar fi golit chiar
  // el imediat parametrul, înainte să apuce să fie folosit (view.folder e "schimbat" și la
  // montarea inițială, din perspectiva efectului).
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setSelectedId(null)
    selection.clear()
    setPage(0)
  }, [view.folder, view.starred, view.snoozed, view.labelId, debouncedSearch, toAddress, pageSize])

  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (view.folder) p.set('folder', view.folder)
    if (view.starred) p.set('isStarred', 'true')
    if (view.snoozed) p.set('snoozed', 'true')
    if (view.labelId) p.set('labelId', view.labelId)
    if (debouncedSearch) p.set('q', debouncedSearch)
    if (toAddress) p.set('toAddress', toAddress)
    p.set('limit', String(pageSize))
    p.set('offset', String(page * pageSize))
    return p.toString()
  }, [view, debouncedSearch, toAddress, pageSize, page])

  const threads = useQuery({
    queryKey: ['email', 'threads', params],
    queryFn: () => api.get<{ items: EmailThread[]; total: number }>(`/api/email/threads?${params}`),
    // Poll — Cloudflare Email Routing ingerează în timp real pe backend, dar fără push
    // (websocket ar fi bloat pt. un singur utilizator) frontend-ul nu știe altfel. 30s.
    refetchInterval: 30_000,
  })
  usePageRefresh(() => threads.refetch())
  const items = useMemo(() => threads.data?.items ?? [], [threads.data])
  const total = threads.data?.total ?? 0
  const threadIds = useMemo(() => items.map((thread) => thread.id), [items])
  const selection = useSelection(threadIds)
  const selectedThreads = items.filter((thread) => selection.selected.has(thread.id))

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['email', 'threads'] })
    void queryClient.invalidateQueries({ queryKey: ['email', 'unread-counts'] })
  }

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

  const move = (targets: EmailThread[], folder: MoveFolder) => {
    selection.clear()
    void moveThreads(targets, folder, invalidate)
  }

  // A right click on a selected row acts on the whole selection, as in a file manager.
  const targetsFor = (thread: EmailThread) => (selection.selected.has(thread.id) ? selectedThreads : [thread])

  useHotkeys(
    [
      { keys: 'e', label: t('common:actions.archive'), onKey: () => move(selectedThreads, 'archive') },
      { keys: 'shift+#', label: t('common:actions.delete'), onKey: () => move(selectedThreads, 'trash') },
      { keys: 'shift+!', label: t('email:folders.spam'), onKey: () => move(selectedThreads, 'spam') },
      { keys: 'shift+i', label: t('email:list.read'), onKey: () => bulkUpdate.mutate({ targets: selectedThreads, patch: { isRead: true } }) },
      { keys: 'shift+u', label: t('common:states.unread'), onKey: () => bulkUpdate.mutate({ targets: selectedThreads, patch: { isRead: false } }) },
    ],
    { enabled: selection.count > 0 && !selectedId },
  )

  // Selecție tip file-manager (Stefan, 2026-09-03): desktop — Ctrl/Cmd+click pe rând = toggle
  // checkbox, ca în Explorer/Finder. Mobil — apăsare lungă (fără click dreapta) intră în "mod
  // selecție"; odată ce ceva e deja selectat (indiferent cum — checkbox, ctrl+click, apăsare
  // lungă), un tap/click simplu pe ORICE rând continuă să selecteze (nu mai deschide thread-ul)
  // până selecția ajunge goală sau apeși „Anulează selecția" din bara de acțiuni.
  const LONG_PRESS_MS = 500
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  function startLongPress(id: string) {
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      selection.toggle(id)
    }, LONG_PRESS_MS)
  }
  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }
  function handleRowActivate(e: MouseEvent, id: string) {
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    if (selection.onRowClick(e, id)) return
    setSelectedId(id)
  }

  // Un singur "panou" vizibil deodată, full-width — lista SAU thread-ul deschis, niciodată
  // amândouă alăturate (Stefan, 2026-09-03: pe desktop rămâneau permanent lipite, iar cu lista
  // singură ocupa doar coloana îngustă din stânga, cu un placeholder gol lângă ea).
  return (
    <div>
      <div className={cn('space-y-3', selectedId ? 'hidden' : '')}>
        <div className="flex gap-2">
          <Input
            type="search"
            aria-label={t('email:list.searchAria')}
            placeholder={t('email:list.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {receivingAddresses.length > 0 ? (
            <Select
              className="w-auto shrink-0"
              title={t('email:list.receivedOnHint')}
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
            >
              <option value="">{t('email:list.anyAddress')}</option>
              {receivingAddresses.map((a) => (
                <option key={a.key} value={a.address}>
                  {a.label}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            title={t('common:actions.refresh')}
            disabled={threads.isFetching}
            onClick={() => invalidate()}
          >
            <RefreshCw className={cn('h-4 w-4', threads.isFetching && 'animate-spin')} />
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            {threads.isPending ? (
              <ListSkeleton rows={8} lines={3} />
            ) : threads.isError ? (
              <p className="text-sm">
                {t('email:list.loadFailed')}{' '}
                <button type="button" className="underline underline-offset-2" onClick={() => void threads.refetch()}>
                  {t('common:actions.retry')}
                </button>
              </p>
            ) : !items.length ? (
              search || toAddress ? (
                <EmptyState
                  kind="filtered"
                  title={search ? t('email:list.nothingFor', { search }) : t('email:list.nothingOnAddress')}
                  onReset={() => {
                    setSearch('')
                    setToAddress('')
                  }}
                />
              ) : (
                <EmptyState kind="new" title={t('email:list.nothingHere')} />
              )
            ) : (
              <div className="space-y-1">
                {items.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    opened={selectedId === thread.id}
                    selected={selection.selected.has(thread.id)}
                    showFolderBadge={showFolderBadge}
                    onActivate={(e) => handleRowActivate(e, thread.id)}
                    onToggle={() => selection.toggle(thread.id)}
                    onLongPress={{ start: () => startLongPress(thread.id), cancel: cancelLongPress }}
                    onMove={(folder) => move(targetsFor(thread), folder)}
                    onMarkRead={(isRead) => bulkUpdate.mutate({ targets: targetsFor(thread), patch: { isRead } })}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        {total > 0 ? (
          <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <Select
              size="sm"
              className="w-auto shrink-0"
              title={t('email:list.perPageHint')}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {t('email:pagination.perPage', { size })}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">
                {t('email:pagination.range', { from: page * pageSize + 1, to: Math.min((page + 1) * pageSize, total), total })}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title={t('common:actions.previousPage')}
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="w-8"
                title={t('common:actions.nextPage')}
                disabled={(page + 1) * pageSize >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {selectedId ? null : (
        <SelectionBar count={selection.count} allSelected={selection.allSelected} onSelectAll={selection.selectAll} onClear={selection.clear}>
          <Button variant="ghost" size="icon-sm" title={t('common:actions.archive')} aria-label={t('common:actions.archive')} onClick={() => move(selectedThreads, 'archive')}>
            <Archive className="h-4 w-4" />
          </Button>
          <SnoozeMenu onSnooze={(until) => bulkUpdate.mutate({ targets: selectedThreads, patch: { snoozedUntil: until } })} disabled={bulkUpdate.isPending} />
          <Button variant="ghost" size="icon-sm" title={t('email:folders.spam')} aria-label={t('email:folders.spam')} onClick={() => move(selectedThreads, 'spam')}>
            <ShieldAlert className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('common:actions.delete')} aria-label={t('common:actions.delete')} onClick={() => move(selectedThreads, 'trash')}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => bulkUpdate.mutate({ targets: selectedThreads, patch: { isRead: true } })}>
            {t('email:list.read')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => bulkUpdate.mutate({ targets: selectedThreads, patch: { isRead: false } })}>
            {t('common:states.unread')}
          </Button>
        </SelectionBar>
      )}
      {selectedId ? (
        <ThreadDetail
          threadId={selectedId}
          onReply={onReply}
          onForward={onForward}
          onBack={() => setSelectedId(null)}
          onChanged={invalidate}
        />
      ) : null}
    </div>
  )
}
