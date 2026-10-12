// SSE peste POST — EventSource nativ nu suportă POST cu body, deci parsăm manual
// `data: {...}\n\n` dintr-un ReadableStream (pattern standard pt. acest caz, vezi
// PLAN_INAPP_AGENT.md).

export type AssistantSseEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolName: string }
  | { type: 'confirm_required'; actionId: string; toolName: string; toolInput: unknown; summary: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export async function postSse(path: string, body: unknown, onEvent: (event: AssistantSseEvent) => void): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401) {
    window.location.href = '/login'
    return
  }
  if (!res.ok || !res.body) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null
    onEvent({ type: 'error', message: errBody?.error ?? `HTTP ${res.status}` })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sepIndex = buffer.indexOf('\n\n')
    while (sepIndex !== -1) {
      const chunk = buffer.slice(0, sepIndex)
      buffer = buffer.slice(sepIndex + 2)
      if (chunk.startsWith('data: ')) {
        try {
          onEvent(JSON.parse(chunk.slice(6)) as AssistantSseEvent)
        } catch {
          // chunk trunchiat/necorespunzător — ignorat, nu oprim streamul pentru un frame corupt
        }
      }
      sepIndex = buffer.indexOf('\n\n')
    }
  }
}
