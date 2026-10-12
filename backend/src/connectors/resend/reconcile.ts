// Resend reconciliation: a safety net for delivery statuses the webhook missed (downtime,
// retries exhausted after about 32h). It reads List Sent Emails (`GET /emails`, where
// `last_event` is the delivery status) and is used only by `jobs/email-reconcile.ts`. The
// update logic stays in modules/email; a connector only knows how to talk to the external API.

const FETCH_TIMEOUT_MS = 30_000

export interface ReconcileSentEmail {
  id: string
  last_event: string
}

async function resendGet<T>(path: string, apiKey: string): Promise<{ data: T[]; has_more: boolean }> {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Resend ${path} returned HTTP ${res.status}`)
  return res.json() as Promise<{ data: T[]; has_more: boolean }>
}

export async function listSentEmails(apiKey: string, after?: string): Promise<{ emails: ReconcileSentEmail[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: '50', ...(after ? { after } : {}) })
  const res = await resendGet<ReconcileSentEmail>(`/emails?${params}`, apiKey)
  return { emails: res.data, hasMore: res.has_more }
}
