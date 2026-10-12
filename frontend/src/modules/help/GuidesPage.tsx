import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { useMe } from '@/shared/hooks/use-me'
import { findNavItem } from '@/shared/lib/nav-items'
import { searchGuides, visibleGuides, type Guide } from './guides'
import { t } from '@/shared/lib/i18n'

const pageLabel = (route: string) => findNavItem(route)?.label ?? route

export function GuidesPage() {
  const { can } = useMe()
  // Pagina și căutarea stau în URL: „?” din antetul unei pagini deschide lista deja filtrată.
  const [searchParams, setSearchParams] = useSearchParams()
  const route = searchParams.get('pagina') ?? ''
  const query = searchParams.get('q') ?? ''

  const mine = visibleGuides(can)
  const routes = [...new Set(mine.map((guide) => guide.route))]
  const shown = searchGuides(route ? mine.filter((guide) => guide.route === route) : mine, query)

  const setParam = (key: 'pagina' | 'q', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const groups = routes
    .map((r) => ({ route: r, guides: shown.filter((guide) => guide.route === r) }))
    .filter((group) => group.guides.length > 0)

  return (
    <div className="max-w-3xl space-y-6" data-density="comfortable">
      <PageHeader title={t('common:nav.guides')} description={t('help:description')} />

      {mine.length === 0 ? (
        <EmptyState
          kind="new"
          title={t('help:emptyTitle')}
          description={t('help:emptyHint')}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              value={query}
              onChange={(event) => setParam('q', event.target.value)}
              placeholder={t('help:searchPlaceholder')}
              aria-label={t('help:searchPlaceholder')}
            />
            <Select className="max-w-52" aria-label={t('help:pageFilter')} value={route} onChange={(event) => setParam('pagina', event.target.value)}>
              <option value="">{t('help:allPages')}</option>
              {routes.map((r) => (
                <option key={r} value={r}>
                  {pageLabel(r)}
                </option>
              ))}
            </Select>
          </div>

          {groups.length === 0 ? (
            <EmptyState kind="filtered" title={t('help:noMatch')} onReset={() => setSearchParams({}, { replace: true })} />
          ) : (
            groups.map((group) => (
              <section key={group.route} className="space-y-4">
                <h2 className="text-sm font-medium text-muted-foreground">{pageLabel(group.route)}</h2>
                {group.guides.map((guide) => (
                  <GuideArticle key={guide.id} guide={guide} />
                ))}
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}

function GuideArticle({ guide }: { guide: Guide }) {
  return (
    <article id={guide.id} className="space-y-2">
      <h3 className="text-base font-semibold">{guide.title}</h3>
      <p className="text-sm text-muted-foreground">{guide.summary}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.videoUrl ? (
        <a href={guide.videoUrl} target="_blank" rel="noreferrer" className="inline-block text-sm underline underline-offset-4">
          {t('help:seeRecording')}
        </a>
      ) : null}
    </article>
  )
}
