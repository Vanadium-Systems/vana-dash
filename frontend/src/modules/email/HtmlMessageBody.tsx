import DOMPurify from 'dompurify'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import type { EmailAttachmentMeta } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

// Randare HTML sigură pt. emailuri primite (Sprint 3, PLAN.md). `bodyHtml` e stocat BRUT,
// nesanitizat, în DB — sanitizarea e strict aici, client-side, la randare.

const FORBID_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link']
const FORBID_ATTR = [
  'onerror',
  'onload',
  'onclick',
  'onmouseover',
  'onmouseout',
  'onfocus',
  'onblur',
  'onchange',
  'onsubmit',
  'onkeydown',
  'onkeyup',
  'onkeypress',
  'ondblclick',
]

/**
 * Rescrie <img src="cid:X"> ÎNAINTE de sanitizare — DOMPurify lasă protocolul `cid:` să treacă
 * (e în allowlist-ul lui default pt. imagini inline), dar browserul nu poate face fetch pe el
 * (e un identificator MIME, nu un URL). `attachments` vine deja scopat la mesajul curent
 * (`EmailMessage.attachments`, filtrat pe `messageId` în backend) — matching-ul pe `contentId`
 * de mai jos e deci STRICT per mesaj, nu global: un `contentId` fabricat nu poate să se
 * potrivească accidental cu atașamentul altui mesaj.
 */
export function rewriteCidReferences(html: string, attachments: EmailAttachmentMeta[]): string {
  return html.replace(/(<img\b[^>]*\bsrc=["'])cid:([^"']+)(["'])/gi, (match, prefix: string, cid: string, suffix: string) => {
    const normalizedCid = cid.replace(/^<|>$/g, '')
    // Header-ul MIME real `Content-ID:` vine cu `<...>` (RFC 2392/2111) — attachment.contentId
    // trebuie normalizat la fel ca cid-ul din HTML, altfel comparația nu se potrivește niciodată.
    const attachment = attachments.find((a) => a.contentId?.replace(/^<|>$/g, '') === normalizedCid)
    // cid necunoscut — lăsăm neschimbat; DOMPurify îl lasă să treacă, browserul nu-l poate
    // rezolva oricum (fail-safe, nu o gaură de securitate — doar o imagine lipsă).
    if (!attachment) return match
    return `${prefix}/api/email/attachments/${attachment.id}/download${suffix}`
  })
}

/**
 * Sanitizează + blochează imaginile externe by-default (pattern Gmail — nu confirmă tăcut
 * expeditorului că mesajul a fost deschis, prin request-ul de fetch al imaginii). Imaginile
 * proprii (`/api/email/attachments/...`, deja rescrise din cid: mai sus) nu sunt considerate
 * "externe". `container.innerHTML = sanitizedHtml` parsează markup DEJA sanitizat (fără
 * `<script>`/handlere) — parsarea DOM nu execută nimic.
 */
export function sanitizeAndGateImages(html: string, showExternalImages: boolean): { html: string; hasExternalImages: boolean } {
  const sanitizedHtml = DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR })
  const container = document.createElement('div')
  container.innerHTML = sanitizedHtml

  // Linkurile din email trebuie să navigheze într-un tab nou — altfel un click înlocuiește
  // SPA-ul curent cu pagina externă (fără istoric de "back" util, tab-ul dash se pierde).
  // rel="noopener noreferrer" obligatoriu alături de target="_blank" (altfel pagina deschisă
  // ar putea accesa window.opener — tabnabbing).
  container.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })

  let hasExternalImages = false
  container.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || ''
    const isOwnAttachment = src.startsWith('/api/email/attachments/')
    const isExternal = /^https?:\/\//i.test(src) && !isOwnAttachment
    if (!isExternal) return
    hasExternalImages = true
    if (!showExternalImages) {
      img.setAttribute('data-blocked-src', src)
      img.removeAttribute('src')
      if (!img.getAttribute('alt')) img.setAttribute('alt', t('email:body.externalImageBlocked'))
    }
  })

  return { html: container.innerHTML, hasExternalImages }
}

// Emailuri cu poze embedate direct ca `data:` base64 în HTML (nu doar `cid:` inline-attachment)
// sau markup extrem de imbricat (newslettere/Outlook) pot avea `bodyHtml` de ordinul MB —
// sanitizarea + parsarea DOM sincronă a acelui string blochează thread-ul principal (freeze). Sub
// prag randăm automat ca înainte; peste prag cerem un click explicit, exact ca la imaginile
// externe — sanitizarea grea rulează abia atunci, nu la fiecare randare a thread-ului.
export const MAX_INLINE_HTML_CHARS = 200_000

export interface RenderedMessage {
  html: string
  hasExternalImages: boolean
}

/**
 * `rewriteCidReferences`/`sanitizeAndGateImages` pe conținut patologic (nesting extrem de adânc)
 * pot arunca (ex. stack overflow în DOMPurify) — izolat aici ca eșecul unui singur mesaj să nu
 * urce spre `ErrorBoundary`-ul global (acela rămâne plasă de siguranță pt. alte cazuri, nu calea
 * normală pt. HTML de email neîncrezător).
 */
export function renderMessageHtml(html: string, attachments: EmailAttachmentMeta[], showExternalImages: boolean): RenderedMessage | null {
  try {
    const rewritten = rewriteCidReferences(html, attachments)
    return sanitizeAndGateImages(rewritten, showExternalImages)
  } catch (err) {
    console.error('[email] HTML rendering failed, falling back to text:', err)
    return null
  }
}

interface HtmlMessageBodyProps {
  html: string
  attachments: EmailAttachmentMeta[]
  fallbackText?: string | null
  /** Setarea "încarcă imaginile" din Setări Email — ON = imaginile externe se încarcă direct,
      fără butonul de confirmare (default OFF, pattern Gmail). */
  autoLoadImages?: boolean
}

// Fixed-width emails (600-700px tables) are shrunk like Gmail does, instead of being cut on the
// right (EM1). `zoom`, not `transform: scale`, so no empty layout space is left behind. "Actual
// size" puts it back at 100% for whoever wants to read the small print, with sideways scroll.
export function fitRatio(available: number, contentWidth: number): number {
  if (contentWidth <= 0) return 1
  const ratio = available / contentWidth
  return ratio < 1 ? Math.max(ratio, 0.4) : 1
}

function useFitToWidth(renderedHtml: string, actualSize: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [shrunk, setShrunk] = useState(false)
  useEffect(() => {
    const box = ref.current
    if (!box) return
    const content = box.firstElementChild as HTMLElement | null
    if (!content) return
    // The outer box keeps its width whatever the zoom, so measuring it never loops.
    const measure = () => {
      content.style.zoom = '1'
      const style = getComputedStyle(box)
      const available = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const ratio = fitRatio(available, content.scrollWidth)
      setShrunk(ratio < 1)
      content.style.zoom = actualSize ? '1' : String(ratio)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [renderedHtml, actualSize])
  return { ref, shrunk }
}

export function HtmlMessageBody({ html, attachments, fallbackText, autoLoadImages }: HtmlMessageBodyProps) {
  const [showExternalImages, setShowExternalImages] = useState(autoLoadImages ?? false)
  const [forceRender, setForceRender] = useState(false)
  const [actualSize, setActualSize] = useState(false)

  const isLarge = html.length > MAX_INLINE_HTML_CHARS
  const shouldRender = !isLarge || forceRender

  const rendered = useMemo(() => {
    if (!shouldRender) return null
    return renderMessageHtml(html, attachments, showExternalImages)
  }, [shouldRender, html, attachments, showExternalImages])
  const fit = useFitToWidth(rendered?.html ?? '', actualSize)

  if (shouldRender && !rendered) {
    return (
      <div className="rounded-md border border-dashed p-3 text-sm">
        <p className="mb-1 text-muted-foreground">{t('email:body.renderFailed')}</p>
        <p className="whitespace-pre-wrap break-words">{fallbackText || t('email:body.noText')}</p>
      </div>
    )
  }

  if (!shouldRender) {
    return (
      <Button variant="outline" onClick={() => setForceRender(true)}>
        {t('email:body.complex')}
      </Button>
    )
  }

  const { html: renderedHtml, hasExternalImages } = rendered as RenderedMessage

  return (
    <div>
      {(hasExternalImages && !showExternalImages) || fit.shrunk ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {hasExternalImages && !showExternalImages ? (
            <Button variant="outline" size="sm" onClick={() => setShowExternalImages(true)}>
              {t('email:body.showImages')}
            </Button>
          ) : null}
          {fit.shrunk ? (
            <Button variant="ghost" size="sm" onClick={() => setActualSize((v) => !v)}>
              {actualSize ? t('email:body.fitToWidth') : t('email:body.actualSize')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* dangerouslySetInnerHTML DOAR pe output-ul deja sanitizat de DOMPurify mai sus.
          Canvas alb forțat (Contract E): emailul HTML e proiectat pe alb indiferent de temă. */}
      <div
        ref={fit.ref}
        className={cn(
          'email-canvas email-html-body max-w-full rounded-sm p-3 text-sm [&_img]:max-w-full',
          actualSize ? 'overflow-x-auto' : 'overflow-x-hidden [&_table]:max-w-full',
        )}
      >
        <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      </div>
    </div>
  )
}
