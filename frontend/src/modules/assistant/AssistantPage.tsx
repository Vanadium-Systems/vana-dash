import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, CalendarClock, Check, History, MessageSquarePlus, Send, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import { postSse, type AssistantSseEvent } from './sse'
import { ChatBubble, ToolLine, type BubbleMessage } from './ChatBubble'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

const CONVERSATION_STORAGE_KEY = 'assistant-conversation-id'
const INPUT_MAX_CHARS = 32_000

interface ContentBlock {
  type: string
  text?: string
  name?: string
  [key: string]: unknown
}

interface ConversationRow {
  id: string
  title: string | null
  model: string | null
  lastMessageAt: string
}

interface MessageRow {
  id: string
  role: 'user' | 'assistant'
  content: ContentBlock[]
  createdAt: string
  inputTokens?: number | null
  outputTokens?: number | null
}

interface PendingConfirm {
  actionId: string
  toolName: string
  summary: string
}

interface ScheduledRunRow {
  id: string
  kind: 'reminder' | 'report'
  runAt: string
  text: string | null
  prompt: string | null
}

interface AssistantModel {
  id: string
  label: string
  provider: 'anthropic' | 'openrouter' | 'local'
  contextWindow?: number
  inputPricePerMtok?: number
  outputPricePerMtok?: number
}

const SUGGESTIONS = [
  t('assistant:suggestions.unpaidInvoices'),
  t('assistant:suggestions.monthReport'),
  t('assistant:suggestions.activeAlerts'),
  t('assistant:suggestions.unreadEmails'),
]

/** Meter de context (boltnew): tokenii ultimului răspuns vs. fereastra modelului + $ estimat.
 *  Fără context window configurat → arată doar tokenii; fără usage (rânduri vechi) → nimic. */
function TokenMeter({ rows, model }: { rows: Array<{ role: 'user' | 'assistant'; inputTokens?: number | null; outputTokens?: number | null }>; model: AssistantModel | undefined }) {
  const assistantRows = rows.filter((m) => m.role === 'assistant' && m.inputTokens != null)
  const last = assistantRows.at(-1)
  if (!last) return null
  const used = (last.inputTokens ?? 0) + (last.outputTokens ?? 0)
  const pct = model?.contextWindow ? Math.min(100, (used / model.contextWindow) * 100) : null
  // $ estimat pe toată conversația la prețurile modelului CURENT (rândurile vechi nu-și țin modelul)
  const cost = model?.inputPricePerMtok != null || model?.outputPricePerMtok != null
    ? assistantRows.reduce((sum, m) => sum + ((m.inputTokens ?? 0) * (model.inputPricePerMtok ?? 0) + (m.outputTokens ?? 0) * (model.outputPricePerMtok ?? 0)) / 1e6, 0)
    : null
  return (
    <span className="tnum inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs text-muted-foreground" title={t('assistant:meterHint')}>
      {used >= 10_000 ? `${(used / 1000).toFixed(1)}k` : used}
      {model?.contextWindow ? (
        <>
          <span>/</span>
          <span>{model.contextWindow >= 10_000 ? `${Math.round(model.contextWindow / 1000)}k` : model.contextWindow}</span>
          <span className={cn('h-1 w-12 overflow-hidden rounded-full bg-muted')}>
            <span className={cn('block h-full', pct != null && pct > 85 ? 'bg-destructive' : 'bg-primary')} style={{ width: `${pct}%` }} />
          </span>
          <span className={pct != null && pct > 85 ? 'text-destructive' : undefined}>{pct?.toFixed(0)}%</span>
        </>
      ) : null}
      {cost != null ? <span>· ${cost.toFixed(4)}</span> : null}
    </span>
  )
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
}

// Tool-urile apelate rămân în istoric ca linie mică mono (Contract E) — extrase din blocurile
// tool_use persistate în content.
function extractTools(content: ContentBlock[]): string[] {
  return content.filter((b) => b.type === 'tool_use' && typeof b.name === 'string').map((b) => b.name!)
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'acum'
  if (minutes < 60) return t('assistant:minutesAgo', { minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `acum ${hours}h`
  const days = Math.round(hours / 24)
  return `acum ${days}z`
}

export function AssistantPage() {
  const queryClient = useQueryClient()
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState<string | null>(null)
  const [messages, setMessages] = useState<BubbleMessage[]>([])
  // rândurile brute cu usage — separate de BubbleMessage (afisat), pt. TokenMeter
  const [usageRows, setUsageRows] = useState<Array<{ role: 'user' | 'assistant'; inputTokens?: number | null; outputTokens?: number | null }>>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [liveTools, setLiveTools] = useState<string[]>([])
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const models = useQuery({
    queryKey: ['assistant', 'models'],
    queryFn: () => api.get<AssistantModel[]>('/api/assistant/models'),
  })

  const conversations = useQuery({
    queryKey: ['assistant', 'conversations'],
    queryFn: () => api.get<ConversationRow[]>('/api/assistant/conversations'),
  })

  const scheduled = useQuery({
    queryKey: ['assistant', 'scheduled'],
    queryFn: () => api.get<ScheduledRunRow[]>('/api/assistant/scheduled'),
    staleTime: 60_000,
  })

  async function loadConversation(id: string) {
    localStorage.setItem(CONVERSATION_STORAGE_KEY, id)
    setConversationId(id)
    setPendingConfirm(null)
    setLiveText('')
    setLiveTools([])
    try {
      const history = await api.get<MessageRow[]>(`/api/assistant/conversations/${id}/messages`)
      setUsageRows(history.map((m) => ({ role: m.role, inputTokens: m.inputTokens ?? null, outputTokens: m.outputTokens ?? null })))
      setMessages(
        history
          .map((m) => ({ id: m.id, role: m.role, text: extractText(m.content), createdAt: m.createdAt, tools: extractTools(m.content) }))
          .filter((m) => m.text.trim().length > 0 || (m.tools?.length ?? 0) > 0),
      )
    } catch {
      // Conversația a fost ștearsă între timp (sau id-ul din localStorage e invalid) —
      // cădem pe draft, nu blocăm pagina.
      await startDraft(false)
    }
  }

  // Draft = conversație încă ne creată în DB (conversationId null). Se materializează abia la
  // primul mesaj — „Conversație nouă" nu mai poluează DB-ul cu rânduri goale (bug raportat de
  // Stefan, 2026-08-26).
  async function startDraft(clearStorage = true) {
    if (clearStorage) localStorage.removeItem(CONVERSATION_STORAGE_KEY)
    setConversationId(null)
    setPendingConfirm(null)
    setLiveText('')
    setLiveTools([])
    setMessages([])
    setUsageRows([])
  }

  useEffect(() => {
    void (async () => {
      const id = localStorage.getItem(CONVERSATION_STORAGE_KEY)
      if (id) {
        await loadConversation(id)
      } else {
        await startDraft(false)
      }
    })().catch((err) => toast.error(err instanceof Error ? err.message : t('assistant:loadFailed')))
  }, [])

  // Modelul afișat vine din lista de conversații (sursa de adevăr e DB) — se sincronizează
  // singur după orice PATCH, fără state dublu de întreținut.
  useEffect(() => {
    const conv = conversations.data?.find((c) => c.id === conversationId)
    if (conv) setCurrentModel(conv.model)
  }, [conversations.data, conversationId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, liveText, liveTools, pendingConfirm])

  function handleEvent(event: AssistantSseEvent) {
    if (event.type === 'text_delta') {
      setLiveText((text) => text + event.text)
    } else if (event.type === 'tool_call') {
      setLiveTools((tools) => [...tools, event.toolName])
    } else if (event.type === 'confirm_required') {
      setPendingConfirm({ actionId: event.actionId, toolName: event.toolName, summary: event.summary })
    } else if (event.type === 'error') {
      toast.error(event.message)
    }
  }

  function finalizeTurn() {
    setLiveText((finalText) => {
      const toolsSnapshot = liveToolsRef.current
      if (finalText.trim() || toolsSnapshot.length > 0) {
        setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), role: 'assistant', text: finalText, createdAt: new Date().toISOString(), tools: toolsSnapshot }])
      }
      return ''
    })
    setLiveTools([])
    setIsStreaming(false)
    void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
    void queryClient.invalidateQueries({ queryKey: ['assistant', 'scheduled'] })
    // usage-ul rândului nou scris de backend — pt. meter-ul de context. Ref, nu state:
    // după primul mesaj din draft, state-ul încă e null la momentul apelului.
    const convId = conversationIdRef.current
    if (convId) {
      void api
        .get<MessageRow[]>(`/api/assistant/conversations/${convId}/messages`)
        .then((history) => setUsageRows(history.map((m) => ({ role: m.role, inputTokens: m.inputTokens ?? null, outputTokens: m.outputTokens ?? null }))))
        .catch(() => {})
    }
  }

  // snapshot sincron pt. finalizeTurn — setState-ul asincron ar pierde tool-urile ultimului moment
  const liveToolsRef = useRef(liveTools)
  liveToolsRef.current = liveTools
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || isStreaming) return
    setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), role: 'user', text, createdAt: new Date().toISOString() }])
    setInput('')
    resizeTextarea()
    setIsStreaming(true)
    try {
      // Draftul se materializează abia aici — la primul mesaj real.
      let convId = conversationId
      if (!convId) {
        const provider = models.data?.find((m) => m.id === currentModel)?.provider
        const conv = await api.post<ConversationRow>(
          '/api/assistant/conversations',
          currentModel ? { model: currentModel, ...(provider ? { provider } : {}) } : undefined,
        )
        convId = conv.id
        setConversationId(convId)
        localStorage.setItem(CONVERSATION_STORAGE_KEY, convId)
      }
      await postSse(`/api/assistant/conversations/${convId}/messages`, { text }, handleEvent)
    } finally {
      finalizeTurn()
    }
  }

  async function resolveConfirm(approve: boolean) {
    if (!pendingConfirm) return
    const action = pendingConfirm
    setPendingConfirm(null)
    setIsStreaming(true)
    try {
      await postSse(`/api/assistant/actions/${action.actionId}/${approve ? 'confirm' : 'reject'}`, undefined, handleEvent)
    } finally {
      finalizeTurn()
    }
  }

  async function startNewConversation() {
    // Fără POST — draftul devine conversație abia la primul mesaj trimis.
    await startDraft()
    void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
  }

  async function deleteConversation(id: string) {
    try {
      await api.delete(`/api/assistant/conversations/${id}`)
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
      if (id === conversationId) await startDraft()
      else toast.success(t('assistant:deleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('assistant:deleteFailed'))
    }
  }

  async function changeModel(modelId: string) {
    // În draft modelul rămâne local — se trimite la creare, odată cu primul mesaj.
    setCurrentModel(modelId)
    if (!conversationId) return
    // providerul pleacă odată cu modelul — altfel conversația rămâne pe providerul implicit
    const provider = models.data?.find((m) => m.id === modelId)?.provider
    try {
      await api.patch(`/api/assistant/conversations/${conversationId}`, { model: modelId, ...(provider ? { provider } : {}) })
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('assistant:modelChangeFailed'))
    }
  }

  async function cancelScheduledRun(id: string) {
    try {
      await api.delete(`/api/assistant/scheduled/${id}`)
      void queryClient.invalidateQueries({ queryKey: ['assistant', 'scheduled'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('assistant:cancelTaskFailed'))
    }
  }

  function resizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 8 * 24)}px`
  }

  const currentModelLabel = models.data?.find((m) => m.id === currentModel)?.label ?? t('assistant:defaultModel')

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-4 md:h-[calc(100dvh-5rem)]">
      <PageHeader
        title={t('common:nav.assistant')}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-sm hover:bg-accent">
                <Bot className="h-4 w-4" /> {currentModelLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {models.data?.map((m) => (
                  <DropdownMenuItem key={`${m.provider}:${m.id}`} onClick={() => void changeModel(m.id)}>
                    {m.id === currentModel ? <Check className="h-4 w-4" /> : <span className="w-4" />}
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <TokenMeter rows={usageRows} model={models.data?.find((m) => m.id === currentModel)} />

            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-sm hover:bg-accent">
                <History className="h-4 w-4" /> {t('assistant:conversations')}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => void startNewConversation()}>
                  <MessageSquarePlus className="h-4 w-4" /> {t('assistant:newConversation')}
                </DropdownMenuItem>
                {conversations.data?.map((c) => (
                  <DropdownMenuItem key={c.id} onClick={() => void loadConversation(c.id)}>
                    {c.id === conversationId ? <Check className="h-4 w-4 shrink-0" /> : <span className="w-4 shrink-0" />}
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="max-w-56 truncate">{c.title || t('assistant:newConversation')}</span>
                      <span className="text-xs text-muted-foreground">{relativeTime(c.lastMessageAt)}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={c.title ? t('assistant:deleteConversation', { title: c.title }) : t('assistant:deleteNewConversation')}
                      data-testid="assistant-delete-conversation"
                      className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        void deleteConversation(c.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-4">
        {messages.length === 0 && !liveText && !isStreaming ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10" data-testid="assistant-empty-state">
            <p className="max-w-md text-center text-sm text-muted-foreground">
              {t('assistant:intro')}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  data-testid="assistant-suggestion"
                  disabled={isStreaming}
                  onClick={() => void sendMessage(suggestion)}
                  className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}

        {liveText || liveTools.length > 0 ? (
          <div className="flex flex-col gap-1">
            <ToolLine tools={liveTools} />
            <ChatBubble message={{ id: 'live', role: 'assistant', text: liveText }} streaming />
          </div>
        ) : null}

        {isStreaming && !liveText && liveTools.length === 0 ? (
          <p className="pl-8 text-xs text-muted-foreground">{t('assistant:thinking')}</p>
        ) : null}

        {pendingConfirm ? (
          <Card className="border-warning-text/40">
            <CardContent className="space-y-3 pt-4">
              <p className="text-sm font-medium">{t('assistant:confirmNeeded', { toolName: pendingConfirm.toolName })}</p>
              <p className="text-sm text-muted-foreground">{pendingConfirm.summary}</p>
              <div className="flex gap-2">
                <Button onClick={() => void resolveConfirm(true)}>
                  <Check className="h-4 w-4" /> {t('assistant:approve')}
                </Button>
                <Button variant="outline" onClick={() => void resolveConfirm(false)}>
                  <X className="h-4 w-4" /> {t('assistant:reject')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {(scheduled.data?.length ?? 0) > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="assistant-scheduled-chips">
          {scheduled.data!.slice(0, 6).map((run) => (
            <span key={run.id} className="inline-flex max-w-xs items-center gap-1.5 rounded-full border bg-card py-1 pl-2 pr-1 text-xs text-muted-foreground">
              <CalendarClock className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {run.kind === 'reminder' ? run.text : run.prompt}
              </span>
              <span className="tnum shrink-0 font-mono text-xs">
                {new Date(run.runAt).toLocaleString(intlTag(), { timeZone: 'Europe/Bucharest', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                type="button"
                aria-label={t('assistant:cancelScheduled')}
                className="rounded-full p-0.5 hover:bg-accent hover:text-foreground"
                onClick={() => void cancelScheduledRun(run.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {(scheduled.data?.length ?? 0) > 6 ? <span className="text-xs text-muted-foreground">{t('assistant:moreScheduled', { count: scheduled.data!.length - 6 })}</span> : null}
        </div>
      ) : null}

      <div className="flex items-end gap-1 rounded-md border border-input p-1 transition-[border-color,box-shadow] duration-150 ease-out focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          ref={textareaRef}
          className="min-h-0 flex-1 resize-none overflow-hidden border-0 px-2 py-1 focus-visible:ring-0"
          rows={1}
          placeholder={t('assistant:placeholder')}
          value={input}
          maxLength={INPUT_MAX_CHARS}
          disabled={isStreaming || Boolean(pendingConfirm)}
          onChange={(e) => {
            setInput(e.target.value)
            resizeTextarea()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void sendMessage()
            }
          }}
        />
        <Button
          size="icon-sm"
          aria-label={t('common:actions.send')}
          disabled={isStreaming || Boolean(pendingConfirm) || !input.trim()}
          onClick={() => void sendMessage()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
