import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ME_QUERY_KEY, useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { SessionPayload } from '@/shared/lib/types'
import { isUnseen, visibleReleases } from './releases'
import { intlTag } from '@/shared/lib/format'

const DATE = new Intl.DateTimeFormat(intlTag(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' })

export function UpdatesPage() {
  const { can, session } = useMe()
  const queryClient = useQueryClient()
  const releases = visibleReleases(can)

  // „Nou” se judecă față de momentul de dinaintea acestei vizite: deschiderea paginii mută
  // `updatesSeenAt` la acum, dar etichetele rămân cât stă omul pe pagină.
  const seenBefore = useRef<string | null | undefined>(undefined)
  if (seenBefore.current === undefined && session) seenBefore.current = session.updatesSeenAt

  const sessionLoaded = session !== null
  useEffect(() => {
    if (!sessionLoaded) return
    void api
      .patch<SessionPayload>('/api/auth/me', { updatesSeenAt: new Date().toISOString() })
      .then((fresh) => queryClient.setQueryData(ME_QUERY_KEY, fresh))
      // Dacă nu se salvează (offline), noutățile rămân marcate și la vizita următoare.
      .catch(() => {})
  }, [sessionLoaded])

  return (
    <div className="max-w-2xl space-y-6" data-density="comfortable">
      <PageHeader title="Noutăți" description="Ce s-a schimbat în paginile pe care le folosești." />
      {releases.length === 0 ? (
        <EmptyState kind="new" title="Nicio noutate încă" />
      ) : (
        <ol className="space-y-6">
          {releases.map((release) => (
            <li key={release.publishedAt} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{release.title}</h2>
                {seenBefore.current !== undefined && isUnseen(release, seenBefore.current) ? <Badge variant="secondary">Nou</Badge> : null}
              </div>
              <time dateTime={release.publishedAt} className="block text-xs text-muted-foreground">
                {DATE.format(new Date(release.publishedAt))}
              </time>
              <p className="text-sm">{release.body}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
