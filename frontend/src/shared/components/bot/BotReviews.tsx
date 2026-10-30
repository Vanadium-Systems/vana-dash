import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CircleCheck, OctagonAlert } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import { safeHttpUrl, type ReviewMeta, type ReviewSeverity } from './types'
import { t } from '@/shared/lib/i18n'
import { intlTag } from '@/shared/lib/format'

const SEVERITY: Record<ReviewSeverity, { label: string; icon: typeof CircleCheck; className: string }> = {
  ok: { label: t('common:actions.ok'), icon: CircleCheck, className: 'text-success' },
  warn: { label: t('common:states.warning'), icon: AlertTriangle, className: 'text-warning' },
  critical: { label: t('common:states.critical'), icon: OctagonAlert, className: 'text-destructive-text' },
}

// Un raport Claude acoperă tot botul (crypto + bursă), deci aceeași listă apare în ambele tab-uri.
// Pe crypto stă sub „Ce învață" (titlu de subsecțiune); pe bursă e coloana ei (`standalone`).
export function BotReviews({ reviews, standalone = false }: { reviews: ReviewMeta[]; standalone?: boolean }) {
  const [openReviewId, setOpenReviewId] = useState<string | null>(null)

  return (
    <div className={standalone ? 'min-w-0 space-y-2' : 'space-y-1'}>
      {standalone ? (
        <h2 className="text-sm font-semibold">{t('common:bot.reviews.title')}</h2>
      ) : (
        <h3 className="text-xs text-muted-foreground">{t('common:bot.reviews.title')}</h3>
      )}
      {!reviews.length ? (
        <p className="text-sm text-muted-foreground">{t('common:bot.reviews.empty')}</p>
      ) : (
        <ul className="-mx-2">
          {reviews.map((r) => {
            const sev = SEVERITY[r.severity]
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpenReviewId(r.id)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted"
                >
                  <sev.icon className={cn('mt-0.5 h-4 w-4 shrink-0', sev.className)} aria-label={sev.label} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">
                      {r.kind === 'weekly' ? t('common:bot.reviews.weekly') : t('common:bot.reviews.daily')} · {formatDay(r.date)}
                    </span>
                    <span className="line-clamp-2 text-sm [overflow-wrap:anywhere]">{r.summary}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <ReviewDialog id={openReviewId} onClose={() => setOpenReviewId(null)} />
    </div>
  )
}

function ReviewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const review = useQuery({
    queryKey: ['jeffbot', 'review', id],
    queryFn: () => api.get<ReviewMeta & { markdown: string }>(`/api/jeffbot/reviews/${id}`),
    enabled: id !== null,
    staleTime: Infinity,
  })

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {review.data
              ? t(review.data.kind === 'weekly' ? 'common:bot.reviews.weeklyTitle' : 'common:bot.reviews.dailyTitle', { date: formatDay(review.data.date) })
              : t('common:bot.reviews.report')}
          </DialogTitle>
        </DialogHeader>
        {review.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : review.isError ? (
          <p className="text-sm text-muted-foreground">{t('common:bot.reviews.loadFailed')}</p>
        ) : (
          <div className="max-h-[70vh] space-y-2 overflow-y-auto text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:font-semibold [&_h3]:font-medium [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children, href }) => {
                  const safe = href ? safeHttpUrl(href) : null
                  return safe ? (
                    <a href={safe} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      {children}
                    </a>
                  ) : (
                    <span>{children}</span>
                  )
                },
                // Fixed layout with wrapping cells: a review table never scrolls sideways on a phone.
                table: ({ children }) => <table className="w-full table-fixed text-xs">{children}</table>,
                th: ({ children }) => <th className="break-words py-1 pr-2 text-left font-normal text-muted-foreground sm:pr-4">{children}</th>,
                td: ({ children }) => <td className="tnum break-words py-1 pr-2 sm:pr-4">{children}</td>,
                code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>,
                pre: ({ children }) => (
                  <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-2 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>
                ),
              }}
            >
              {review.data.markdown}
            </ReactMarkdown>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(intlTag(), {
    day: 'numeric',
    month: 'short',
  })
}
