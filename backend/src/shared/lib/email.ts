import { config } from '../config.js'
import { tr } from './i18n.js'

// Notificări email (alerte + trimiteri cu atașamente) prin Resend (fetch brut — un
// singur POST nu justifică SDK-ul oficial `resend` ca dependență nouă, la fel ca
// ANAF cu fetch brut). Fără RESEND_API_KEY configurat, emailul e dezactivat — logăm
// și mergem mai departe; niciun flow nu depinde hard de email.

const RESEND_URL = 'https://api.resend.com/emails'
const RESEND_RECEIVING_URL = 'https://api.resend.com/emails/receiving'
const FETCH_TIMEOUT_MS = 30_000

export interface EmailAttachment {
  filename: string
  content: Buffer // encodat base64 intern (Resend cere content ca base64 string în payload), apelantul dă Buffer brut
  /** 2026-08-11 — poze inline din editorul rich-text (modules/email/images-service.ts).
   *  Cu asta setat, HTML-ul trebuie să refere atașamentul via `cid:<contentId>` — Resend
   *  randează inline (nu ca fișier separat de descărcat) când găsește potrivirea. */
  contentId?: string
}

export interface SendEmailResult {
  ok: boolean
  error?: string
  /** id-ul Resend al emailului trimis (când ok=true) — folosit de reply-urile de
   *  thread din modulul Email pt. a popula `email_messages.resendEmailId`. */
  id?: string
}

interface SendEmailOpts {
  to: string
  subject: string
  text: string
  /** Versiune HTML opțională (semnătură cu logo etc.) — Resend acceptă text+html
   *  împreună, clienții care randează HTML îl preferă, restul cad pe `text`. */
  html?: string
  attachments?: EmailAttachment[]
  /** Override pt. adresa de expeditor — implicit `config.alertEmailFrom`. Folosit
   *  de reply-urile din modulul Email, care trebuie trimise de la adresa inbound
   *  (subdomeniul dedicat) la care a venit mesajul original, nu de la adresa de alerte. */
  from?: string
  /** Headere custom RFC (In-Reply-To/References) — folosite la reply-uri de thread
   *  (modulul Email) ca destinatarul să vadă corect firul de discuție. */
  headers?: Record<string, string>
}

/**
 * HTML-ul din editorul rich-text (TipTap) nu poartă niciun `font-family` — nodurile
 * lui (p/h2/li/span) nu păstrează acel atribut la parse, deci fără wrapper clientul
 * de email cade pe fontul lui implicit (des serif). Un singur wrapper aici, la ultimul
 * pas înainte de Resend, acoperă toate căile (Compose, bulk, reply, forward) fără să
 * atingă `bodyHtml`-ul stocat (folosit la re-afișare/editare, nu la trimitere).
 */
function wrapHtmlFont(html: string | undefined): string | undefined {
  if (!html) return html
  return `<div style="font-family:system-ui,sans-serif;color:#1a1a1a;line-height:1.5">${html}</div>`
}

/**
 * Face efectiv POST-ul către Resend și întoarce rezultatul (fără să arunce). Sursă
 * unică pentru `sendEmail` (swallow, folosit de alertele existente) și
 * `sendEmailWithResult` (modulul Email, care are nevoie de status per destinatar
 * pentru `email_sends` — regula #9/#7 CLAUDE.md: nu duplicăm logica de trimitere).
 */
async function sendEmailInternal(opts: SendEmailOpts): Promise<SendEmailResult> {
  if (!config.resendApiKey) {
    console.warn(`[email] RESEND_API_KEY neconfigurat — email nesent: ${opts.subject}`)
    return { ok: false, error: tr('errors.email.resendKeyMissing') }
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from ?? config.alertEmailFrom,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        html: wrapHtmlFont(opts.html),
        attachments: opts.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString('base64'),
          ...(a.contentId ? { content_id: a.contentId } : {}),
        })),
        headers: opts.headers,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(tr('errors.email.resendHttp', { status: res.status, detail: detail.slice(0, 300) }))
    }
    const data = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: data?.id }
  } catch (err) {
    const message = String(err)
    // Emailul picat nu oprește nimic — flow-ul apelant continuă neafectat.
    console.error(`[email] Trimitere eșuată pentru "${opts.subject}": ${message}`)
    return { ok: false, error: message }
  }
}

export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  await sendEmailInternal(opts)
}

/** Ca `sendEmail`, dar întoarce succes/eșec — pentru apelanți care trebuie să
 *  înregistreze statusul (ex: `email_sends` din modulul Email). Nu aruncă niciodată. */
export async function sendEmailWithResult(opts: SendEmailOpts): Promise<SendEmailResult> {
  return sendEmailInternal(opts)
}

export async function sendAlertEmail(subject: string, body: string): Promise<void> {
  return sendEmail({ to: config.alertEmailTo, subject: `[vana-dash] ${subject}`, text: body })
}

const RESEND_METRICS_URL = 'https://api.resend.com/emails/metrics'

/**
 * Total REAL de emailuri trimise pe domeniu (cont Resend întreg), nu doar ce a trecut prin
 * `email_sends`/`email_messages` din acest repo — folosit pt. cotă (Setări Email, 2026-09-03,
 * Stefan: contorul local nu vedea alertele dash trimise direct, nici emailurile automate din
 * vanagreen, care rulează pe SMTP relay Resend cu alt user, dar ACELAȘI cont/domeniu
 * vanadium.systems). Vezi changelog Resend „Email Metrics API" — `totals.sent` e agregat la
 * nivel de cont, nu doar pt. cheia API cu care se cheamă requestul.
 * Întoarce null (nu aruncă) dacă Resend nu răspunde — apelantul cade pe numărătoarea locală.
 */
export async function getResendSentCount(startDate: Date, endDate: Date): Promise<number | null> {
  if (!config.resendApiKey) return null
  try {
    const params = new URLSearchParams({
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      metrics: 'sent',
    })
    const res = await fetch(`${RESEND_METRICS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${config.resendApiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[email] Resend metrics a răspuns cu HTTP ${res.status}`)
      return null
    }
    const data = (await res.json().catch(() => null)) as { totals?: { sent?: number } } | null
    return typeof data?.totals?.sent === 'number' ? data.totals.sent : null
  } catch (err) {
    console.error(`[email] Resend metrics eșuat: ${String(err)}`)
    return null
  }
}

// ── Resend inbound (primire) — Received Emails API + Attachments API ──────────
// Webhook-ul `email.received` (modul Email, Sprint B) conține doar metadate —
// corpul complet și link-urile de download pt. atașamente se recuperează separat
// de aici. Sursă unică pt. "cum vorbim cu Resend", simetric cu trimiterea de mai sus.

export interface ReceivedEmailAttachmentMeta {
  id: string
  filename: string
  contentType: string | null
  size: number | null
}

export interface ReceivedEmail {
  id: string
  from: string
  to: string[]
  subject: string
  text: string | null
  html: string | null
  /** Message-ID RFC 5322 (ex: `<111-222-333@email.example.com>`) — folosit pt.
   *  In-Reply-To/References pe reply-urile trimise de Stefan. Confirmat expus
   *  de Received Emails API la research Wave 0 (spre deosebire de In-Reply-To/
   *  References ale mesajului primit, care NU sunt expuse). */
  messageId: string | null
  attachments: ReceivedEmailAttachmentMeta[]
}

interface RawReceivedEmailResponse {
  id: string
  from: string
  to: string[]
  subject: string
  text: string | null
  html: string | null
  message_id: string | null
  attachments?: Array<{ id: string; filename: string; content_type?: string; size?: number }>
}

/** Recuperează corpul complet + lista de atașamente ale unui email primit. `null` la eșec
 *  (fără RESEND_API_KEY, HTTP non-2xx, sau rețea) — apelantul tratează ca failure izolat. */
export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  if (!config.resendApiKey) {
    console.warn(`[email] RESEND_API_KEY neconfigurat — nu pot recupera emailul primit ${emailId}`)
    return null
  }
  try {
    const res = await fetch(`${RESEND_RECEIVING_URL}/${emailId}`, {
      headers: { Authorization: `Bearer ${config.resendApiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(tr('errors.email.resendReceivedHttp', { status: res.status, detail: detail.slice(0, 300) }))
    }
    const data = (await res.json()) as RawReceivedEmailResponse
    return {
      id: data.id,
      from: data.from,
      to: data.to,
      subject: data.subject,
      text: data.text,
      html: data.html,
      messageId: data.message_id ?? null,
      attachments: (data.attachments ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.content_type ?? null,
        size: a.size ?? null,
      })),
    }
  } catch (err) {
    console.error(`[email] Recuperare email primit ${emailId} eșuată: ${String(err)}`)
    return null
  }
}
