import { BotReviews } from '@/shared/components/bot/BotReviews'
import { NewsList } from '@/shared/components/bot/NewsList'
import { formatPct, type ReviewMeta } from '@/shared/components/bot/types'
import type { BotSnapshot } from './types'

export function LearningPanel({ snapshot, reviews }: { snapshot: BotSnapshot; reviews: ReviewMeta[] }) {
  const { model } = snapshot

  return (
    <section className="min-w-0 space-y-6" aria-labelledby="bot-learning-title">
      <h2 id="bot-learning-title" className="text-sm font-semibold">
        Ce învață
      </h2>

      <div className="space-y-2">
        <p className="text-sm">
          Model LightGBM:{' '}
          {model.promoted ? (
            <span className="font-medium">
              promovat
              {model.holdoutRetPct != null ? `, ${formatPct(model.holdoutRetPct)} pe holdout` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">nepromovat, traderul stă flat până trece poarta</span>
          )}
        </p>
        {model.trainLogTail.length ? (
          <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {model.trainLogTail.join('\n')}
          </pre>
        ) : null}
      </div>

      <BotReviews reviews={reviews} />

      <NewsList news={snapshot.news} tags={(n) => [n.coins.join(', ')]} title="Știri importante, cu sentimentul lui Jeff" />
    </section>
  )
}
