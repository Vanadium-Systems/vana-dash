import DOMPurify from 'dompurify'
import { useState, type ReactNode } from 'react'
import { RichTextEditor } from '@/shared/components/RichTextEditor'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

// Settings read top to bottom as rows: what it is and why on the left, the controls on the right.
// No card per setting; a hairline between rows is the only separation, so a long page does not
// turn into a stack of boxes and the width of the screen is used.

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-6 first:pt-0">
      <h2 className="pb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function SettingsSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-10 gap-y-3 border-t py-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <div className="min-w-0 max-w-3xl space-y-3">{children}</div>
    </div>
  )
}

const plainText = (html: string) => html.replace(/<img\b/gi, 'x').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

export interface SignatureMailbox {
  key: string
  label: string
  fromAddress: string
  /** Shown when this mailbox has no signature of its own (the company's or the mailbox's). */
  fallback?: string
}

/**
 * One editor, the mailbox picked above it, instead of an editor per mailbox stacked down the page.
 * Each pill says whether that mailbox has its own text or falls back.
 */
export function SignatureEditor({
  mailboxes,
  values,
  onChange,
  fallbackLabel,
}: {
  mailboxes: SignatureMailbox[]
  values: Record<string, string>
  onChange: (key: string, html: string) => void
  /** "uses the company signature" / "uses the mailbox signature". */
  fallbackLabel: string
}) {
  const [current, setCurrent] = useState(mailboxes[0]?.key ?? '')
  const mailbox = mailboxes.find((m) => m.key === current) ?? mailboxes[0]
  if (!mailbox) return null
  const value = values[mailbox.key] ?? ''
  const usesFallback = !plainText(value) && Boolean(mailbox.fallback && plainText(mailbox.fallback))

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label={t('email:settings.signatureMailbox')} className="flex flex-wrap gap-1.5">
        {mailboxes.map((m) => {
          const own = Boolean(plainText(values[m.key] ?? ''))
          return (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={m.key === mailbox.key}
              onClick={() => setCurrent(m.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                m.key === mailbox.key ? 'border-foreground/40 bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {m.label}
              <span className={cn('h-1.5 w-1.5 rounded-full', own ? 'bg-foreground' : 'bg-muted-foreground/40')} aria-hidden="true" />
              <span className="sr-only">{own ? t('email:settings.signatureOwn') : fallbackLabel}</span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{mailbox.fromAddress || t('email:settings.addressNotConfigured')}</p>
      <div className="rounded-md border">
        <RichTextEditor
          key={mailbox.key}
          id={`signature-${mailbox.key}`}
          value={value}
          onChange={(html) => onChange(mailbox.key, html)}
          placeholder={t('email:mySettings.signaturePlaceholder')}
          className="[&_.ProseMirror]:min-h-24"
        />
      </div>
      {usesFallback ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{fallbackLabel}</p>
          <div
            className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground [&_img]:max-h-10"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(mailbox.fallback ?? '') }}
          />
        </div>
      ) : null}
    </div>
  )
}
