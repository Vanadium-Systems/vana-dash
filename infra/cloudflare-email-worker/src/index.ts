import { EmailMessage } from 'cloudflare:email'
import PostalMime from 'postal-mime'

// Receives email through Cloudflare Email Routing (free) and hands it to the app. Sending
// (compose, reply, forward, bulk) stays on Resend; only the receiving path lives here.
//
// The Worker gets the whole message in one SMTP delivery, so it is parsed once with
// postal-mime and forwarded complete, in a single POST.

export interface Env {
  // Full URL of the app's ingest endpoint; see wrangler.jsonc (vars).
  VANA_DASH_WEBHOOK_URL: string
  // The domain you send from. A From: on it that fails DMARC is certainly forged, because
  // your own mail goes out through Resend with aligned DKIM. Empty turns the check off.
  OWN_DOMAIN?: string
  // A secret, set only with `wrangler secret put CLOUDFLARE_EMAIL_INGEST_TOKEN`, never in code
  // or in wrangler.jsonc. It has to be identical to CLOUDFLARE_EMAIL_INGEST_TOKEN in the app's
  // production .env (backend/src/shared/config.ts). Two places, easy to let drift apart.
  CLOUDFLARE_EMAIL_INGEST_TOKEN: string
  // When the app does not take a message: the raw .eml waits here and the cron below replays it.
  // A KV namespace (a value holds up to 25 MiB, Email Routing's message limit). Optional binding;
  // without it a failed delivery is only forwarded.
  PENDING?: KVNamespace
  // A verified destination address in Email Routing (a mailbox outside the app, e.g. a Gmail).
  // Set with `wrangler secret put FALLBACK_ADDRESS`: it is a personal address, not for the repo.
  FALLBACK_ADDRESS?: string
  // `send_email` binding for the "app is not answering" alert to FALLBACK_ADDRESS.
  ALERT_EMAIL?: SendEmail
}

interface CloudflareInboundPayload {
  from: string
  replyTo: string | null
  to: string
  subject: string
  text: string | null
  html: string | null
  messageId: string | null
  inReplyTo: string | null
  references: string | null
  dmarc: string | null
  attachments: Array<{
    filename: string
    contentType: string | null
    contentBase64: string
    // Ties <img src="cid:X"> in the html to its inline attachment (see
    // backend/src/modules/email/inbound-service.ts).
    contentId: string | null
    disposition: 'attachment' | 'inline' | null
  }>
}

/** A postal-mime `Address` is either a `Mailbox` ({name, address}) or a group ({name, group}).
 *  Only the one with its own `address` is used; a group has no single recipient. */
function mailboxAddress(addr: { address?: string } | undefined): string | null {
  return addr?.address || null
}

/**
 * `Attachment.content` from postal-mime can be `ArrayBuffer | Uint8Array | string` (utf8 for
 * some text attachments), so it is normalized to bytes before base64. No spread
 * (`String.fromCharCode(...bytes)`): on a large attachment it can overflow the argument
 * stack. A plain loop is safe at any size.
 */
function toBase64(content: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof content === 'string' ? new TextEncoder().encode(content)
    : content instanceof Uint8Array ? content
    : new Uint8Array(content)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/**
 * The DMARC result written by the Cloudflare MX. Under p=quarantine Cloudflare does not reject
 * (it rejects only under p=reject) and has no spam folder to put the message in, so a forged
 * From: would land in the inbox like any other message. A sender can add an
 * Authentication-Results header with `dmarc=pass` of their own, so a `fail` anywhere wins.
 */
function dmarcResult(headers: Headers): string | null {
  const values = [headers.get('Authentication-Results'), headers.get('ARC-Authentication-Results')].join(' ')
  const results = [...values.matchAll(/\bdmarc=(\w+)/gi)].map((m) => m[1]!.toLowerCase())
  if (results.length === 0) return null
  return results.includes('fail') ? 'fail' : results[0]!
}

const PENDING_PREFIX = 'inbound-pending/'
// Messages the app refuses for good (4xx) or that cannot be parsed: kept, out of the replay queue.
const DEAD_PREFIX = 'inbound-dead/'
const ALERT_MARKER = 'alerts/app-down'
const ALERT_EVERY_MS = 60 * 60 * 1000
const DELIVERY_TIMEOUT_MS = 25_000
const REPLAY_BATCH = 20

interface PendingMeta {
  from: string
  to: string
  dmarc: string
}

interface Envelope {
  from: string
  to: string
  dmarc: string | null
}

async function buildPayload(rawBuffer: ArrayBuffer, envelope: Envelope): Promise<CloudflareInboundPayload> {
  const parsed = await PostalMime.parse(rawBuffer)
  // `envelope.from` is the SMTP envelope address (MAIL FROM). For bulk and transactional senders
  // it is a bounce address (bounces+xxx@outbound…), not the From: header the recipient sees, and a
  // reply sent there goes nowhere. So the From: header parsed from the message is used, with the
  // envelope as fallback only when there is no From: at all (a malformed message).
  return {
    from: mailboxAddress(parsed.from) ?? envelope.from,
    replyTo: mailboxAddress(parsed.replyTo?.[0]),
    to: envelope.to,
    subject: parsed.subject ?? '',
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references: Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references ?? null),
    dmarc: envelope.dmarc,
    attachments: parsed.attachments.map((a) => ({
      filename: a.filename ?? 'attachment',
      contentType: a.mimeType ?? null,
      contentBase64: toBase64(a.content),
      contentId: a.contentId ?? null,
      disposition: a.disposition ?? null,
    })),
  }
}

type Delivery = 'stored' | 'retry' | 'refused'

/** 'stored' when the app kept it (idempotent on Message-ID, so a replay is safe); 'refused' = 4xx. */
async function deliver(payload: CloudflareInboundPayload, env: Env): Promise<Delivery> {
  try {
    const res = await fetch(env.VANA_DASH_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cloudflare-Email-Token': env.CLOUDFLARE_EMAIL_INGEST_TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    if (res.ok) return 'stored'
    console.error(`[cloudflare-email-worker] the app answered HTTP ${res.status}`)
    // 401/403 is a token out of sync with the app: fixable, so the messages wait (and the alert goes
    // out). 408/429 mean later. Any other 4xx will not change on a retry (bad payload, too large).
    const later = [401, 403, 408, 429].includes(res.status)
    return res.status >= 400 && res.status < 500 && !later ? 'refused' : 'retry'
  } catch (err) {
    console.error('[cloudflare-email-worker] the app did not answer:', err)
    return 'retry'
  }
}

/** At most one alert an hour while the app is down; the marker lives in the pending namespace. */
async function alertAppDown(env: Env, reason: string): Promise<void> {
  if (!env.ALERT_EMAIL || !env.FALLBACK_ADDRESS || !env.PENDING || !env.OWN_DOMAIN) return
  const marker = await env.PENDING.get(ALERT_MARKER)
  const last = marker ? Number(marker) : 0
  if (Date.now() - last < ALERT_EVERY_MS) return
  const from = `alerte@${env.OWN_DOMAIN}`
  const raw = [
    `From: VanaDash <${from}>`,
    `To: ${env.FALLBACK_ADDRESS}`,
    // Headers are ASCII: a subject with diacritics goes in RFC 2047 encoded-word form.
    `Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode('VanaDash nu primește emailuri')))}?=`,
    `Message-ID: <${crypto.randomUUID()}@${env.OWN_DOMAIN}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    `Aplicația nu a preluat un email primit (${reason}), la ${new Date().toISOString()} UTC.`,
    'Emailurile vin între timp și aici, iar copia lor așteaptă în Cloudflare (KV); când aplicația',
    'răspunde din nou, intră singure în ea. Pașii, în docs-internal/CAND_PICA_SERVERUL.md.',
  ].join('\r\n')
  try {
    await env.ALERT_EMAIL.send(new EmailMessage(from, env.FALLBACK_ADDRESS, raw))
    // Only after a send that went out: a failed alert must not silence the next hour.
    await env.PENDING.put(ALERT_MARKER, String(Date.now()))
  } catch (err) {
    console.error('[cloudflare-email-worker] alert not sent:', err)
  }
}

export default {
  async email(message, env: Env): Promise<void> {
    // `message.raw` can be read once: buffer it before anything else.
    const rawBuffer = await new Response(message.raw).arrayBuffer()
    const dmarc = dmarcResult(message.headers)
    try {
      const parsed = await PostalMime.parse(rawBuffer)
      const parsedFrom = mailboxAddress(parsed.from) ?? message.from
      const ownDomain = (env.OWN_DOMAIN ?? '').toLowerCase()
      const fromDomain = parsedFrom.split('@').pop()?.toLowerCase() ?? ''
      if (ownDomain && dmarc === 'fail' && (fromDomain === ownDomain || fromDomain.endsWith(`.${ownDomain}`))) {
        console.warn(`[cloudflare-email-worker] rejected: From ${parsedFrom} fails DMARC (envelope ${message.from})`)
        message.setReject('DMARC fail')
        return
      }
    } catch (err) {
      // An unparseable message still goes through the delivery path below, so it is kept.
      console.error('[cloudflare-email-worker] could not parse for the DMARC check:', err)
    }

    const envelope: Envelope = { from: message.from, to: message.to, dmarc }
    let delivery: Delivery = 'retry'
    try {
      delivery = await deliver(await buildPayload(rawBuffer, envelope), env)
    } catch (err) {
      console.error('[cloudflare-email-worker] error while processing the email:', err)
    }
    if (delivery === 'stored') return

    // Email Routing does not retry: from here on, this Worker is the only copy of the message.
    if (env.PENDING) {
      const prefix = delivery === 'refused' ? DEAD_PREFIX : PENDING_PREFIX
      const key = `${prefix}${new Date().toISOString()}-${crypto.randomUUID()}.eml`
      try {
        await env.PENDING.put(key, rawBuffer, { metadata: { from: envelope.from, to: envelope.to, dmarc: dmarc ?? '' } })
      } catch (err) {
        // The forward below is then the only copy; it must still run.
        console.error('[cloudflare-email-worker] could not keep the message in KV:', err)
      }
    }
    if (env.FALLBACK_ADDRESS) {
      try {
        await message.forward(env.FALLBACK_ADDRESS)
      } catch (err) {
        console.error('[cloudflare-email-worker] forward to the fallback address failed:', err)
      }
    }
    await alertAppDown(env, 'the app did not answer')
  },

  // Replays what waited in KV, oldest first, and stops at the first failure: an app that is still
  // down gets one request every five minutes, not the whole backlog.
  async scheduled(_controller, env: Env): Promise<void> {
    if (!env.PENDING) return
    // KV lists keys in lexicographic order; the keys start with an ISO timestamp, so oldest first.
    const listed = await env.PENDING.list<PendingMeta>({ prefix: PENDING_PREFIX, limit: REPLAY_BATCH })
    for (const item of listed.keys) {
      const raw = await env.PENDING.get(item.name, 'arrayBuffer')
      if (!raw) continue
      const meta: PendingMeta = item.metadata ?? { from: '', to: '', dmarc: '' }
      let delivery: Delivery
      try {
        delivery = await deliver(await buildPayload(raw, { from: meta.from, to: meta.to, dmarc: meta.dmarc || null }), env)
      } catch (err) {
        // Unparseable: retrying will never fix it, and it must not block the messages behind it.
        console.error(`[cloudflare-email-worker] ${item.name} cannot be parsed:`, err)
        delivery = 'refused'
      }
      if (delivery === 'retry') {
        await alertAppDown(env, 'the app is still not answering; messages are waiting in KV')
        return
      }
      if (delivery === 'refused') {
        await env.PENDING.put(item.name.replace(PENDING_PREFIX, DEAD_PREFIX), raw, { metadata: meta })
      }
      await env.PENDING.delete(item.name)
    }
  },
} satisfies ExportedHandler<Env>
