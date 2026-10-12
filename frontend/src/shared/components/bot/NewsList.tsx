import { formatDay } from './BotReviews'
import { safeHttpUrl } from './types'

const SENTIMENT_LABEL: Record<string, string> = {
  bullish: 'pozitiv',
  bearish: 'negativ',
  neutral: 'neutru',
}

interface NewsItem {
  title: string
  url: string
  publishedAt: string | null
  sentiment: string | null
}

// `tags` sunt monedele la crypto, ETF-urile și tipul evenimentului la bursă.
export function NewsList<T extends NewsItem>({ news, tags, title }: { news: T[]; tags: (n: T) => string[]; title: string }) {
  if (!news.length) return null
  return (
    <div className="space-y-1">
      <h3 className="text-xs text-muted-foreground">{title}</h3>
      <ul className="space-y-2">
        {news.slice(0, 8).map((n) => {
          const href = safeHttpUrl(n.url)
          return (
            <li key={n.url} className="text-sm [overflow-wrap:anywhere]">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {n.title}
                </a>
              ) : (
                n.title
              )}
              <span className="block text-xs text-muted-foreground">
                {[
                  ...tags(n),
                  n.sentiment ? (SENTIMENT_LABEL[n.sentiment] ?? n.sentiment) : null,
                  n.publishedAt ? formatDay(n.publishedAt) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
