import { createHash } from 'node:crypto'
import { ensureAlertRule, raiseAlert } from '../../shared/lib/alerting.js'

/**
 * Extracție defensivă — Sentry are DOUĂ forme posibile de webhook pt. issue-uri, în funcție
 * de cum configurează Stefan integrarea în dashboard-ul Sentry:
 *   - Internal Integration, subscriere la evenimente `issue` → `data.issue.{id,title,culprit,
 *     permalink,level,metadata,shortId}`
 *   - Issue Alert Rule → acțiune "Send a notification via webhook" → `data.event.{event_id,
 *     message,culprit,tags,exception,web_url,transaction}`
 * Nu putem testa live contra Sentry-ul real al lui Stefan din acest mediu — extragem best-effort
 * din ambele forme, cu fallback la payload brut dacă nimic nu se potrivește, ca alerta să
 * rămână utilă (nu goală) chiar dacă forma exactă diferă puțin de ce am presupus aici.
 */
interface ExtractedIssue {
  dedupeKey: string
  title: string
  culprit: string | null
  level: string | null
  permalink: string | null
  exceptionSummary: string | null
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function extractException(event: Record<string, unknown>): string | null {
  const exception = asRecord(event.exception)
  const values = exception.values
  if (!Array.isArray(values) || values.length === 0) return null
  const first = asRecord(values[0])
  const type = asString(first.type)
  const value = asString(first.value)
  if (!type && !value) return null
  return [type, value].filter(Boolean).join(': ')
}

export function extractIssue(payload: unknown): ExtractedIssue {
  const body = asRecord(payload)
  const data = asRecord(body.data)
  const issue = asRecord(data.issue)
  const event = asRecord(data.event)

  const id = asString(issue.id) ?? asString(event.event_id)
  const title = asString(issue.title) ?? asString(event.message) ?? asString(event.title) ?? 'Eroare Sentry fără titlu'
  const culprit = asString(issue.culprit) ?? asString(event.culprit) ?? asString(event.transaction)
  const level = asString(issue.level) ?? asString(event.level)
  const permalink = asString(issue.permalink) ?? asString(event.web_url)
  const exceptionSummary = extractException(event)

  // Fără id stabil (nici pe issue, nici pe event) — dedup pe hash-ul titlu+culprit, ca să nu
  // spamăm la fiecare livrare a aceluiași payload de test/retry Sentry.
  const dedupeKey = id ?? createHash('sha256').update(`${title}|${culprit ?? ''}`).digest('hex').slice(0, 16)

  return { dedupeKey, title, culprit, level, permalink, exceptionSummary }
}

export async function handleSentryIssueWebhook(payload: unknown): Promise<void> {
  const issue = extractIssue(payload)

  const ruleKey = `sentry.${issue.dedupeKey}`
  const ruleId = await ensureAlertRule(ruleKey, `Sentry — ${issue.title}`.slice(0, 255))

  const parts = [issue.title]
  if (issue.exceptionSummary && issue.exceptionSummary !== issue.title) parts.push(issue.exceptionSummary)
  if (issue.culprit) parts.push(`la ${issue.culprit}`)
  const message = parts.join(' — ')

  const emailBody = [
    message,
    issue.level ? `Nivel: ${issue.level}` : null,
    issue.permalink ? `Detalii complete (stack trace, tags, request): ${issue.permalink}` : null,
    '\nDetectat de Sentry în vanagreen — vezi link-ul de mai sus pentru tot contextul (stack trace, browser/os, request).',
  ]
    .filter(Boolean)
    .join('\n')

  await raiseAlert(ruleId, `[vanagreen] ${message}`, { emailBody, url: issue.permalink ?? '/alerts' })
}
