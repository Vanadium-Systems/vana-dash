import { createHash } from 'node:crypto'
import nodemailer, { type Transporter } from 'nodemailer'

export type SmtpErrorCode =
  | 'SMTP_AUTH_FAILED'
  | 'SMTP_UNREACHABLE'
  | 'SMTP_REJECTED'
  | 'SMTP_FAILED'

export interface SmtpMailboxConfig {
  id: string
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

export interface SmtpAttachment {
  filename: string
  content: Buffer
  contentId?: string
}

export interface SmtpSendOptions {
  from: string
  to: string
  subject: string
  text: string
  html?: string
  headers?: Record<string, string>
  attachments?: SmtpAttachment[]
}

export type SmtpSendResult =
  | { ok: true; messageId: string }
  | { ok: false; code: SmtpErrorCode }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'mailpit', 'host.docker.internal'])

export function isLocalSmtpHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase())
}

interface CachedPool {
  signature: string
  transporter: Transporter
}

const pools = new Map<string, CachedPool>()

function configSignature(cfg: SmtpMailboxConfig): string {
  return createHash('sha256')
    .update(`${cfg.host}|${cfg.port}|${cfg.secure}|${cfg.user}|${cfg.pass}`)
    .digest('hex')
}

function getTransporter(cfg: SmtpMailboxConfig): Transporter {
  const sig = configSignature(cfg)
  const existing = pools.get(cfg.id)
  if (existing && existing.signature === sig) return existing.transporter
  if (existing) existing.transporter.close()

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    // Local dev SMTP servers (e.g. Mailpit) run without auth when pass is empty.
    ...(cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    ...(isLocalSmtpHost(cfg.host) ? { tls: { rejectUnauthorized: false } } : {}),
  })

  pools.set(cfg.id, { signature: sig, transporter })
  return transporter
}

export function evictSmtpPool(mailboxId: string): void {
  const existing = pools.get(mailboxId)
  if (existing) {
    existing.transporter.close()
    pools.delete(mailboxId)
  }
}

export function closeAllSmtpPools(): void {
  for (const { transporter } of pools.values()) transporter.close()
  pools.clear()
}

export function mapSmtpError(err: unknown): SmtpErrorCode {
  if (!err || typeof err !== 'object') return 'SMTP_FAILED'
  const e = err as { code?: string; responseCode?: number; rejected?: unknown[] }
  const code = e.code ?? ''
  const rc = e.responseCode ?? 0

  if (code === 'EAUTH' || rc === 535 || rc === 534 || rc === 530) {
    return 'SMTP_AUTH_FAILED'
  }
  if (
    code === 'ECONNECTION' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKET' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET'
  ) {
    return 'SMTP_UNREACHABLE'
  }
  if (
    code === 'EENVELOPE' ||
    (rc >= 550 && rc <= 559) ||
    rc === 501 ||
    rc === 503 ||
    (Array.isArray(e.rejected) && e.rejected.length > 0)
  ) {
    return 'SMTP_REJECTED'
  }
  return 'SMTP_FAILED'
}

export async function sendViaSmtp(cfg: SmtpMailboxConfig, opts: SmtpSendOptions): Promise<SmtpSendResult> {
  try {
    const transporter = getTransporter(cfg)
    const info = await transporter.sendMail({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html ? `<div style="font-family:system-ui,sans-serif;color:#1a1a1a;line-height:1.5">${opts.html}</div>` : undefined,
      headers: opts.headers,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        ...(a.contentId ? { cid: a.contentId } : {}),
      })),
    })
    return { ok: true, messageId: info.messageId }
  } catch (err) {
    return { ok: false, code: mapSmtpError(err) }
  }
}
