import { BotReviews } from '@/shared/components/bot/BotReviews'
import { NewsList } from '@/shared/components/bot/NewsList'
import { formatPct, type ReviewMeta } from '@/shared/components/bot/types'
import type { BotSnapshot } from './types'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

export function LearningPanel({ snapshot, reviews }: { snapshot: BotSnapshot; reviews: ReviewMeta[] }) {
  const { model } = snapshot

  return (
    <section className="min-w-0 space-y-6" aria-labelledby="bot-learning-title">
      <h2 id="bot-learning-title" className="text-sm font-semibold">
        {t('crypto:learning.title')}
      </h2>

      <div className="space-y-2">
        <p className="text-sm">
          {tNodes('crypto:learning.model', {
            state: model.promoted ? (
              <span className="font-medium">
                {model.holdoutRetPct != null
                  ? t('crypto:learning.promotedWithHoldout', { pct: formatPct(model.holdoutRetPct) })
                  : t('crypto:learning.promoted')}
              </span>
            ) : (
              <span className="text-muted-foreground">{t('crypto:learning.notPromoted')}</span>
            ),
          })}
        </p>
        {model.trainLogTail.length ? (
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {model.trainLogTail.join('\n')}
          </pre>
        ) : null}
      </div>

      <BotReviews reviews={reviews} />

      <NewsList news={snapshot.news} tags={(n) => [n.coins.join(', ')]} title={t('crypto:learning.newsHint')} />
    </section>
  )
}
