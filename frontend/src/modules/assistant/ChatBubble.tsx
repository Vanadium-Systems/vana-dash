import { useEffect, useState } from 'react'
import { Bitcoin, Bell, Calendar, Check, Copy, FileText, FolderOpen, Mail, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BrandMark } from '@/shared/components/BrandMark'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { AssistantText } from './AssistantText'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

export interface BubbleMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt?: string
  tools?: string[]
}

// Iconiță pe prefixul domeniului din numele tool-ului — chips-urile rămân mici și recunoscibile.
const TOOL_ICONS: Array<[RegExp, LucideIcon]> = [
  [/email|send_|reply|forward/i, Mail],
  [/invoice|issue_/i, FileText],
  [/calendar|reminder|schedule/i, Calendar],
  [/alert/i, Bell],
  [/archive/i, FolderOpen],
  [/crypto|coin/i, Bitcoin],
]

function ToolIcon(toolName: string): LucideIcon {
  for (const [pattern, icon] of TOOL_ICONS) {
    if (pattern.test(toolName)) return icon
  }
  return Wrench
}

export function ToolLine({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 font-mono text-xs text-muted-foreground" data-testid="assistant-tool-line">
      {tools.map((tool, i) => {
        const Icon = ToolIcon(tool)
        return (
          <span key={`${tool}-${i}`} className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5">
            <Icon className="h-3 w-3" /> {tool}
          </span>
        )
      })}
    </div>
  )
}

function Avatar({ role }: { role: 'user' | 'assistant' }) {
  if (role === 'assistant') return <BrandMark className="h-6 w-6" />
  return (
    <div
      className="flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      aria-hidden
    >
      S
    </div>
  )
}

// Ora și copierea stau lângă bulă, nu sub ea — un rând de metadate sub bulă împinge avatarul
// mai jos decât mesajul. Apar la hover și la focus (tastatură).
function MessageMeta({ text, iso }: { text: string; iso?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const time = iso
    ? new Date(iso).toLocaleTimeString(intlTag(), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' })
    : null
  return (
    <div className="flex shrink-0 items-center gap-1 self-end opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
      {time ? <span className="tnum font-mono text-xs text-muted-foreground">{time}</span> : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? t('common:states.copied') : t('assistant:copyMessage')}
        className="text-muted-foreground"
        onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

/** Bula de chat (Contract E): asistent = fundal muted, colț jos-dreapta ascuțit;
 * user = primary, colț jos-stânga; ambele max-w-[85ch]; ora și copierea la hover, lângă bulă. */
export function ChatBubble({ message, streaming = false }: { message: BubbleMessage; streaming?: boolean }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('group flex items-end gap-2', isUser ? 'flex-row-reverse self-end' : 'self-start')}>
      <Avatar role={message.role} />
      <div className={cn('flex min-w-0 max-w-[85ch] flex-col gap-1', isUser && 'items-end')}>
        {message.tools && !streaming ? <ToolLine tools={message.tools} /> : null}
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm leading-relaxed',
            isUser
              ? 'rounded-bl-sm bg-primary text-primary-foreground whitespace-pre-wrap [&_a]:text-inherit'
              : 'rounded-br-sm bg-muted/50',
          )}
          data-testid={isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}
        >
          {isUser ? message.text : <AssistantText text={message.text} />}
          {streaming ? <span className="animate-pulse">▍</span> : null}
        </div>
      </div>
      {!streaming && message.text.trim() ? <MessageMeta text={message.text} iso={message.createdAt} /> : null}
    </div>
  )
}
