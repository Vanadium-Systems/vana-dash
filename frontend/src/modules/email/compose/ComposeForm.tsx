import { useQuery, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import { Paperclip, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react'
import { toast } from 'sonner'
import { RichTextEditor } from '@/shared/components/RichTextEditor'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Select } from '@/shared/components/ui/select'
import { useMe } from '@/shared/hooks/use-me'
import { api, ApiError } from '@/shared/lib/api'
import { readFileAsBase64, type PendingAttachment } from '@/shared/lib/attachments'
import { formatDate, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type {
  EmailDraft,
  EmailDraftAttachment,
  EmailDraftMode,
  EmailIdentity,
  EmailMySettings,
  EmailScheduledSend,
  EmailSenderOptions,
  EmailTemplate,
} from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { ArchiveAttachPicker } from '../ArchiveAttachPicker'
import { identitiesFor, useIdentityKey } from '../IdentityField'
import { identityOptionLabel } from '../identity'
import type { ComposeInit } from './compose-store'
import { isValidAddress, RecipientField } from './RecipientField'
import { trackScheduledSend, type SendFlowHandlers } from './send-flow'
import { htmlHasContent } from '../html-content'

const MAX_ATTACHMENTS = 5
const AUTOSAVE_MS = 1500

type Attachment = EmailDraftAttachment | PendingAttachment
type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'error' } | { kind: 'conflict' }

const bareAddress = (value: string): string => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase()

/** Mirror of `identityKeyForAddress` on the server: the mailbox a reply or forward leaves from. */
function identityKeyForAddress(address: string, identities: EmailIdentity[] | null | undefined): string | null {
  const target = bareAddress(address)
  return identities?.find((identity) => bareAddress(identity.fromAddress) === target)?.key ?? null
}

const splitList = (value: string): string[] => value.split(/[,;\s]+/).map((a) => a.trim()).filter(Boolean)

function modeOf(init: ComposeInit): EmailDraftMode {
  if (init.kind === 'draft') return init.draft.mode
  if (init.kind === 'reply') return init.replyAll ? 'reply_all' : 'reply'
  if (init.kind === 'forward') return 'forward'
  return 'new'
}

export interface ComposeFormProps {
  init: ComposeInit
  variant: 'window' | 'inline' | 'sheet'
  handlers: SendFlowHandlers
  /** The message left (scheduled) or the empty compose was discarded: the host closes. */
  onDone: () => void
  onTitle?: (title: string) => void
  /** Filled with the form's close (save, or discard when empty) for the host's ✕ and Back. */
  closeRef?: MutableRefObject<(() => Promise<void>) | null>
}

/**
 * One form for new, reply, reply all, forward and drafts (E14-E18). It saves its draft by itself
 * (1.5s after the last change), and Send is "save, then send that draft", so attachments, reply
 * headers and Undo all go one way through the server.
 */
export function ComposeForm({ init, variant, handlers, onDone, onTitle, closeRef }: ComposeFormProps) {
  const queryClient = useQueryClient()
  const { can } = useMe()
  const mode = modeOf(init)
  const isNew = mode === 'new'
  const isReply = mode === 'reply' || mode === 'reply_all'
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initialDraft = init.kind === 'draft' ? init.draft : null
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null)
  const updatedAtRef = useRef<string | null>(initialDraft?.updatedAt ?? null)
  const [to, setTo] = useState<string[]>(() =>
    initialDraft ? splitList(initialDraft.to) : init.kind === 'new' ? (init.to ?? []) : init.kind === 'reply' ? init.to : [],
  )
  const [cc, setCc] = useState<string[]>(() => (initialDraft ? splitList(initialDraft.cc) : init.kind === 'reply' ? init.cc : []))
  const [showCc, setShowCc] = useState(cc.length > 0)
  const [subject, setSubject] = useState(() =>
    initialDraft ? initialDraft.subject : init.kind === 'forward' ? (/^fwd:/i.test(init.subject) ? init.subject : `Fwd: ${init.subject}`) : '',
  )
  const [body, setBody] = useState(initialDraft?.body ?? '')
  const [templateId, setTemplateId] = useState(initialDraft?.templateId ?? '')
  const [attachments, setAttachments] = useState<Attachment[]>(initialDraft?.attachments ?? [])
  const [archivePickerOpen, setArchivePickerOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>(initialDraft ? { kind: 'saved', at: initialDraft.updatedAt } : { kind: 'idle' })
  const [sending, setSending] = useState(false)
  const [errors, setErrors] = useState<{ to?: string; subject?: string; banner?: string }>({})
  const [repliedMeanwhile, setRepliedMeanwhile] = useState<{ by: string | null; at: string } | null>(null)
  const [lastSeenMessageId, setLastSeenMessageId] = useState<string | null>(init.kind === 'reply' ? init.lastSeenMessageId : null)

  const threadId = initialDraft?.threadId ?? (init.kind === 'reply' || init.kind === 'forward' ? init.threadId : null)
  const sourceMessageId = initialDraft?.sourceMessageId ?? (init.kind === 'forward' ? init.messageId : null)

  const senderOptions = useQuery({
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
    staleTime: 5 * 60 * 1000,
  })
  const mySettings = useQuery({
    queryKey: ['email', 'me', 'settings'],
    queryFn: () => api.get<EmailMySettings>('/api/email/me/settings'),
    enabled: can('email.setari_proprii'),
    staleTime: 5 * 60 * 1000,
  })
  const templates = useQuery({
    queryKey: ['email', 'templates'],
    queryFn: () => api.get<EmailTemplate[]>('/api/email/templates'),
    enabled: isNew && can('email.sabloane'),
  })
  const recentAddresses = useQuery({
    queryKey: ['email', 'recent-addresses'],
    queryFn: () => api.get<string[]>('/api/email/recent-addresses'),
    staleTime: 60 * 1000,
  })

  // Each chip is checked as it is made (unsubscribed → red at once); the server gate still decides at Send.
  const checkable = useMemo(() => [...new Set([...to, ...cc].filter(isValidAddress).map((a) => a.toLowerCase()))].sort().slice(0, 20), [to, cc])
  const recipientCheck = useQuery({
    queryKey: ['email', 'recipient-check', checkable.join(',')],
    queryFn: () => api.get<{ unsubscribed: string[] }>(`/api/email/recipients/check?addresses=${encodeURIComponent(checkable.join(','))}`),
    enabled: checkable.length > 0,
    staleTime: 60_000,
  })
  const unsubscribed = useMemo(() => new Set((recipientCheck.data?.unsubscribed ?? []).map((a) => a.toLowerCase())), [recipientCheck.data])
  const problemFor = useCallback(
    (address: string) => (unsubscribed.has(address.toLowerCase()) ? t('email:compose.unsubscribed', { address }) : null),
    [unsubscribed],
  )
  const recipientProblem = [...to, ...cc].map((a) => (isValidAddress(a) ? problemFor(a) : null)).find(Boolean) ?? null

  const [from, setFrom, myIdentities] = useIdentityKey(initialDraft?.fromKey ?? 'stefan', senderOptions.data?.identities)
  const { session } = useMe()
  const sendingFromKey =
    init.kind === 'reply' || init.kind === 'forward'
      ? (identityKeyForAddress(init.fromAddress, senderOptions.data?.identities) ?? 'contact')
      : from
  const signatureHtml = useMemo(() => {
    const own = mySettings.data?.signatures[sendingFromKey]
    if (own?.trim()) return own
    const company = senderOptions.data?.signatures
    return company ? (company[sendingFromKey] ?? company['contact'] ?? '') : ''
  }, [mySettings.data, senderOptions.data, sendingFromKey])

  const hasContent = htmlHasContent(body) || attachments.length > 0 || (isNew && (to.length > 0 || subject.trim() !== '')) || (mode === 'forward' && to.length > 0)

  const title = isReply ? t('common:actions.reply') : mode === 'forward' ? subject : subject.trim() || t('email:compose.newMessage')
  useEffect(() => onTitle?.(title), [onTitle, title])

  // ── Draft autosave ─────────────────────────────────────────────────────────

  // Saves run one after another, so a PATCH never races the POST that created the draft.
  const chain = useRef<Promise<string | null>>(Promise.resolve(draftId))
  const generation = useRef(0)
  const latest = useRef({ from, to, cc, subject, body, templateId, attachments })
  latest.current = { from, to, cc, subject, body, templateId, attachments }

  const save = useCallback((): Promise<string | null> => {
    const run = async (currentId: string | null): Promise<string | null> => {
      const snapshot = latest.current
      const savedGeneration = generation.current
      const payload = {
        fromKey: snapshot.from,
        to: snapshot.to.join(', '),
        cc: snapshot.cc.join(', '),
        subject: snapshot.subject,
        body: snapshot.body,
        ...(snapshot.templateId ? { templateId: snapshot.templateId } : {}),
        mode,
        threadId,
        sourceMessageId,
        attachments: snapshot.attachments.map((a) => ('storagePath' in a ? { filename: a.filename, storagePath: a.storagePath } : { filename: a.filename, content: a.content })),
      }
      setSaveState({ kind: 'saving' })
      try {
        const draft = currentId
          ? await api.patch<EmailDraft>(`/api/email/drafts/${currentId}`, { ...payload, expectedUpdatedAt: updatedAtRef.current ?? undefined })
          : await api.post<EmailDraft>('/api/email/drafts', payload)
        updatedAtRef.current = draft.updatedAt
        setDraftId(draft.id)
        // Files saved to the draft come back as storage paths; keep them unless the list changed meanwhile.
        if (generation.current === savedGeneration) setAttachments(draft.attachments)
        setSaveState({ kind: 'saved', at: draft.updatedAt })
        void queryClient.invalidateQueries({ queryKey: ['email', 'drafts'] })
        return draft.id
      } catch (err) {
        if (err instanceof ApiError && err.code === 'DRAFT_CHANGED') setSaveState({ kind: 'conflict' })
        else setSaveState({ kind: 'error' })
        throw err
      }
    }
    const next = chain.current.catch(() => draftId).then(run)
    chain.current = next.catch(() => null)
    return next
  }, [draftId, mode, queryClient, sourceMessageId, threadId])

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    generation.current++
    if (!hasContent || saveState.kind === 'conflict') return
    const timer = setTimeout(() => void save().catch(() => undefined), AUTOSAVE_MS)
    return () => clearTimeout(timer)
    // saveState is read, not watched: a finished save must not schedule the next one.
  }, [from, to, cc, subject, body, templateId, attachments, hasContent, save])

  const reloadDraft = async () => {
    if (!draftId) return
    const draft = await api.get<EmailDraft>(`/api/email/drafts/${draftId}`)
    updatedAtRef.current = draft.updatedAt
    setTo(splitList(draft.to))
    setCc(splitList(draft.cc))
    setSubject(draft.subject)
    setBody(draft.body)
    setAttachments(draft.attachments)
    setSaveState({ kind: 'saved', at: draft.updatedAt })
  }

  /** Close: an empty compose is thrown away without asking; anything typed stays a draft. */
  const close = useCallback(async () => {
    if (!hasContent) {
      if (draftId) await api.delete(`/api/email/drafts/${draftId}`).catch(() => undefined)
      void queryClient.invalidateQueries({ queryKey: ['email', 'drafts'] })
      onDone()
      return
    }
    try {
      await save()
    } catch {
      // The text stays on screen with the error under it; closing would lose it.
      return
    }
    onDone()
  }, [draftId, hasContent, onDone, queryClient, save])
  useEffect(() => {
    if (closeRef) closeRef.current = close
  }, [close, closeRef])

  // ── Send ───────────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const next: typeof errors = {}
    const invalid = [...to, ...cc].find((a) => !isValidAddress(a))
    if (to.length === 0) next.to = t('email:compose.recipientRequired')
    else if (invalid) next.to = t('email:compose.invalidAddress', { address: invalid })
    else if (recipientProblem) next.to = recipientProblem
    if (isNew && !subject.trim()) next.subject = t('email:compose.subjectRequired')
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const send = async (opts: { ignoreReplies?: boolean } = {}) => {
    if (sending || !validate()) return
    setSending(true)
    setRepliedMeanwhile(null)
    try {
      const id = await save()
      if (!id) throw new Error(t('email:compose.saveFailed'))
      const scheduled = await api.post<EmailScheduledSend>(`/api/email/drafts/${id}/send`, {
        lastSeenMessageId: opts.ignoreReplies ? null : lastSeenMessageId,
      })
      trackScheduledSend(scheduled, handlers)
      void queryClient.invalidateQueries({ queryKey: ['email', 'drafts'] })
      onDone()
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = (err.body as { error?: Record<string, unknown> } | undefined)?.error ?? {}
        if (err.code === 'THREAD_REPLIED_MEANWHILE') {
          setRepliedMeanwhile({ by: (detail.by as string | null) ?? null, at: (detail.at as string) ?? new Date().toISOString() })
          return
        }
        if (err.code === 'RECIPIENT_UNSUBSCRIBED') {
          setErrors({ to: t('email:compose.unsubscribed', { address: String(detail.address ?? '') }) })
          return
        }
        if (err.code === 'OUTREACH_CAP_REACHED') {
          setErrors({ banner: t('email:compose.capReached', { limit: Number(detail.limit ?? 0) }) })
          return
        }
      }
      setErrors({ banner: err instanceof Error ? err.message : t('email:compose.sendFailed') })
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape' && variant !== 'inline') {
      e.stopPropagation()
      void close()
    }
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  const addFiles = async (files: FileList) => {
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast.error(t('email:compose.maxAttachments', { MAX_ATTACHMENTS }))
      return
    }
    try {
      const encoded = await Promise.all(Array.from(files).slice(0, remaining).map(readFileAsBase64))
      setAttachments((prev) => [...prev, ...encoded])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('email:attach.readFailed'))
    }
  }

  const suggestions = recentAddresses.data ?? []
  const showFrom = isNew && identitiesFor(senderOptions.data?.identities, session?.mailboxes).length > 1

  return (
    <div className={cn('flex min-h-0 flex-col', variant !== 'inline' && 'h-full')} onKeyDown={onKeyDown}>
      <div className={cn('min-h-0 flex-1 overflow-y-auto', variant === 'inline' ? '' : 'px-4')}>
        {showFrom ? (
          <div className="flex min-h-9 items-center gap-2 border-b py-1">
            <label htmlFor="compose-from" className="w-10 shrink-0 text-sm text-muted-foreground">
              {t('email:compose.from')}
            </label>
            <Select id="compose-from" size="sm" className="w-auto min-w-0 flex-1 border-0 bg-transparent px-0" value={from} onValueChange={(next) => setFrom(next)}>
              {myIdentities.map((identity) => (
                <option key={identity.key} value={identity.key}>
                  {identityOptionLabel(identity)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <RecipientField
          id={`compose-to-${draftId ?? 'new'}`}
          label={t('common:labels.to')}
          value={to}
          onChange={(next) => {
            setTo(next)
            setErrors((e) => ({ ...e, to: undefined }))
          }}
          suggestions={suggestions}
          max={10}
          problemFor={problemFor}
          autoFocus={isNew || mode === 'forward'}
          trailing={
            showCc ? null : (
              <button type="button" className="shrink-0 pt-1.5 text-sm text-muted-foreground hover:text-foreground" onClick={() => setShowCc(true)}>
                {t('email:compose.cc')}
              </button>
            )
          }
        />
        {errors.to || recipientProblem ? <p className="py-1 text-xs text-destructive">{errors.to ?? recipientProblem}</p> : null}
        {showCc ? (
          <RecipientField id={`compose-cc-${draftId ?? 'new'}`} label={t('email:compose.cc')} value={cc} onChange={setCc} suggestions={suggestions} max={10} problemFor={problemFor} />
        ) : null}
        {isReply ? null : (
          <div className="border-b">
            <input
              aria-label={t('common:labels.subject')}
              placeholder={t('common:labels.subject')}
              className="h-9 w-full bg-transparent text-sm outline-none"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value)
                setErrors((x) => ({ ...x, subject: undefined }))
              }}
            />
            {errors.subject ? <p className="pb-1 text-xs text-destructive">{errors.subject}</p> : null}
          </div>
        )}
        {isNew && templates.data?.length ? (
          <div className="flex min-h-9 items-center gap-2 border-b py-1">
            <label htmlFor="compose-template" className="shrink-0 text-sm text-muted-foreground">
              {t('email:compose.templateOptional')}
            </label>
            <Select
              id="compose-template"
              size="sm"
              className="w-auto min-w-0 flex-1 border-0 bg-transparent px-0"
              value={templateId}
              onValueChange={(value) => {
                setTemplateId(value)
                const template = templates.data?.find((x) => x.id === value)
                if (template) {
                  setSubject(template.subject)
                  setBody(template.body)
                }
              }}
            >
              <option value="">{t('email:compose.noTemplate')}</option>
              {templates.data.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <RichTextEditor
          value={body}
          onChange={setBody}
          placeholder={t('email:compose.bodyPlaceholder')}
          autoFocus={isReply || initialDraft !== null}
          className="border-0"
        />
        {signatureHtml.trim() ? (
          <div
            className="email-signature-preview px-3 pb-2 text-xs text-muted-foreground [&_img]:max-h-10"
            title={t('email:compose.signatureAdded')}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(signatureHtml) }}
          />
        ) : null}
        {mode === 'forward' ? <p className="px-3 pb-2 text-xs text-muted-foreground">{t('email:compose.forwardIncludes')}</p> : null}
        {attachments.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 py-2">
            {attachments.map((a, i) => (
              <li key={`${a.filename}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="max-w-48 truncate">{a.filename}</span>
                <button
                  type="button"
                  aria-label={t('email:compose.removeAttachment', { filename: a.filename })}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {repliedMeanwhile ? (
          <Alert
            tone="warning"
            title={t('email:compose.repliedMeanwhile', { by: repliedMeanwhile.by ?? t('email:compose.someoneElse'), at: formatRelativeTime(repliedMeanwhile.at) })}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setLastSeenMessageId(null)
                  void send({ ignoreReplies: true })
                }}
              >
                {t('email:compose.sendAnyway')}
              </Button>
            }
          >
            {t('email:compose.stillHere')}
          </Alert>
        ) : null}
        {errors.banner ? (
          <Alert tone="critical" title={errors.banner}>
            {t('email:compose.stillHere')}
          </Alert>
        ) : null}
        {saveState.kind === 'conflict' ? (
          <Alert
            tone="warning"
            title={t('email:compose.draftChanged')}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void reloadDraft()}>
                {t('email:compose.reload')}
              </Button>
            }
          />
        ) : null}
      </div>

      <div className={cn('flex flex-wrap items-center gap-2 border-t py-2', variant === 'inline' ? '' : 'px-4', variant === 'sheet' && 'pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]')}>
        <Button type="button" onClick={() => void send()} disabled={sending} title={t('email:compose.sendShortcut')}>
          {sending ? t('common:states.sending') : t('common:actions.send')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t('email:compose.attach')}
          aria-label={t('email:compose.attach')}
          disabled={attachments.length >= MAX_ATTACHMENTS}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={attachments.length >= MAX_ATTACHMENTS} onClick={() => setArchivePickerOpen(true)}>
          {t('email:attach.fromArchive')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {saveState.kind === 'saving'
            ? t('email:compose.saving')
            : saveState.kind === 'saved'
              ? t('email:compose.savedAt', { time: formatDate(saveState.at, { timeStyle: 'short' }) })
              : saveState.kind === 'error'
                ? (
                    <button type="button" className="text-destructive underline underline-offset-2" onClick={() => void save().catch(() => undefined)}>
                      {t('email:compose.saveErrorRetry')}
                    </button>
                  )
                : null}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t('email:compose.discard')}
          aria-label={t('email:compose.discard')}
          onClick={async () => {
            if (draftId) await api.delete(`/api/email/drafts/${draftId}`).catch(() => undefined)
            void queryClient.invalidateQueries({ queryKey: ['email', 'drafts'] })
            toast(t('email:compose.discarded'))
            onDone()
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <ArchiveAttachPicker
        open={archivePickerOpen}
        onOpenChange={setArchivePickerOpen}
        onSelect={(attachment) => {
          if (attachments.length >= MAX_ATTACHMENTS) {
            toast.error(t('email:compose.maxAttachments', { MAX_ATTACHMENTS }))
            return
          }
          setAttachments((prev) => [...prev, attachment])
        }}
      />
    </div>
  )
}
