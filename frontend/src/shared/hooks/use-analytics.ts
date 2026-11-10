import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { PostHog } from 'posthog-js'
import { api } from '@/shared/lib/api'
import type { SessionPayload } from '@/shared/lib/types'

// PostHog only inside the signed-in shell (public booking pages never mount it) and only when the
// company saved a key in Settings. Loaded lazily, so without a key nothing reaches the bundle.
// Notes, email, Archive and Messages are personal data: replays and autocapture mask every text
// and every field, so what PostHog sees is clicks, pages and errors, not content.

let client: PostHog | null = null

export function useAnalytics(session: SessionPayload | null) {
  const config = useQuery({
    queryKey: ['analytics', 'client-config'],
    queryFn: () => api.get<{ key: string; host: string } | null>('/api/analytics/client-config'),
    enabled: session !== null,
    staleTime: Infinity,
  })

  const userId = session?.user.id
  const name = session?.user.displayName ?? null
  const role = session?.user.role?.name ?? null
  const tenant = session?.tenant ?? null

  useEffect(() => {
    const cfg = config.data
    if (!cfg || !userId) return
    let cancelled = false
    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) return
      if (!client) {
        posthog.init(cfg.key, {
          api_host: cfg.host,
          person_profiles: 'identified_only',
          autocapture: true,
          rageclick: true,
          capture_dead_clicks: true,
          capture_exceptions: true,
          mask_all_text: true,
          mask_all_element_attributes: true,
          session_recording: { maskAllInputs: true, maskTextSelector: '*' },
        })
        client = posthog
      }
      posthog.identify(userId, { name, role })
      if (tenant) posthog.group('company', tenant.id, { name: tenant.name })
    })
    return () => {
      cancelled = true
    }
  }, [config.data, userId, name, role, tenant])
}

/** On logout, so the next person on the same browser is not glued to the previous one. */
export function resetAnalytics() {
  client?.reset()
}
