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

export default {
  async email(message, env: Env): Promise<void> {
    try {
      // `message.raw` can be read once: buffer it before anything else.
      const rawBuffer = await new Response(message.raw).arrayBuffer()
      const parsed = await PostalMime.parse(rawBuffer)

      // `message.from` is the SMTP envelope address (MAIL FROM). For bulk and transactional
      // senders it is a bounce address (bounces+xxx@outbound…), not the From: header the
      // recipient sees, and a reply sent there goes nowhere. So the From: header parsed from
      // the message is used, with the envelope as fallback only when there is no From: at all
      // (a malformed message).
      const parsedFrom = mailboxAddress(parsed.from) ?? message.from
      const parsedReplyTo = mailboxAddress(parsed.replyTo?.[0])
      const dmarc = dmarcResult(message.headers)

      const ownDomain = (env.OWN_DOMAIN ?? '').toLowerCase()
      const fromDomain = parsedFrom.split('@').pop()?.toLowerCase() ?? ''
      if (ownDomain && dmarc === 'fail' && (fromDomain === ownDomain || fromDomain.endsWith(`.${ownDomain}`))) {
        console.warn(`[cloudflare-email-worker] rejected: From ${parsedFrom} fails DMARC (envelope ${message.from})`)
        message.setReject('DMARC fail')
        return
      }

      const payload: CloudflareInboundPayload = {
        from: parsedFrom,
        replyTo: parsedReplyTo,
        to: message.to,
        subject: parsed.subject ?? '',
        text: parsed.text ?? null,
        html: parsed.html ?? null,
        messageId: parsed.messageId ?? null,
        inReplyTo: parsed.inReplyTo ?? null,
        references: Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references ?? null),
        dmarc,
        attachments: parsed.attachments.map((a) => ({
          filename: a.filename ?? 'attachment',
          contentType: a.mimeType ?? null,
          contentBase64: toBase64(a.content),
          contentId: a.contentId ?? null,
          disposition: a.disposition ?? null,
        })),
      }

      const res = await fetch(env.VANA_DASH_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cloudflare-Email-Token': env.CLOUDFLARE_EMAIL_INGEST_TOKEN },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        console.error(`[cloudflare-email-worker] the app answered HTTP ${res.status} for the message from ${message.from}`)
      }
    } catch (err) {
      // Cloudflare Email Routing does not retry on failure, so a throw here would lose the
      // email for good and gain nothing.
      console.error('[cloudflare-email-worker] error while processing the email:', err)
    }
  },
} satisfies ExportedHandler<Env>
