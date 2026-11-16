import { Link } from 'react-router-dom'
import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'

// The saved reports as cards that come out of a folder (UX research X5): each card carries a
// thumbnail of the shape its report draws, a click opens that report in the Reports tab. The thumbnails
// are drawn, not fetched: the folder costs no request, and the shape says which report it is.

type ReportId = 'mrr' | 'compare' | 'expenses' | 'monthly'

const REPORTS: ReportId[] = ['mrr', 'compare', 'expenses', 'monthly']

function Thumbnail({ report }: { report: ReportId }) {
  return (
    <svg viewBox="0 0 64 36" className="h-9 w-16 shrink-0" aria-hidden="true">
      {report === 'mrr' ? (
        <>
          <path d="M2 30 L14 26 L26 27 L38 18 L50 14 L62 6" fill="none" className="stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 32 L14 31 L26 29 L38 28 L50 25 L62 22" fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="2 3" strokeLinecap="round" />
        </>
      ) : report === 'compare' ? (
        <>
          <rect x={10} y={10} width={14} height={24} rx={2} className="fill-primary" />
          <rect x={28} y={18} width={14} height={16} rx={2} className="fill-muted-foreground/50" />
          <path d="M48 26 L54 20 L60 26" fill="none" className="stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : report === 'expenses' ? (
        <>
          <rect x={2} y={4} width={58} height={6} rx={2} className="fill-primary" />
          <rect x={2} y={15} width={40} height={6} rx={2} className="fill-primary/70" />
          <rect x={2} y={26} width={22} height={6} rx={2} className="fill-primary/40" />
        </>
      ) : (
        <>
          <rect x={18} y={2} width={28} height={32} rx={3} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} />
          <path d="M24 11 H40 M24 17 H40 M24 23 H34" className="stroke-muted-foreground" strokeWidth={1.5} strokeLinecap="round" />
          <rect x={36} y={22} width={14} height={10} rx={2} className="fill-primary" />
        </>
      )}
    </svg>
  )
}

export function ReportsFolder() {
  const { can } = useMe()
  if (!can('financiar.rapoarte')) return null
  return (
    <section aria-labelledby="reports-folder-title" className="rounded-lg bg-muted p-3 sm:p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 id="reports-folder-title" className="text-sm font-semibold">
          {t('financials:reportsFolder.title')}
        </h2>
        <Link to="/financials?tab=rapoarte" className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          {t('financials:reportsFolder.all')}
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
        {REPORTS.map((report) => (
          <li key={report}>
            {/* The card rises out of the folder on hover; reduced motion keeps only the colour change. */}
            <Link
              to={`/financials?tab=rapoarte#${report}`}
              className="flex h-full items-center gap-3 rounded-md border bg-card p-3 transition-[transform,background-color] duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5 [@media(hover:hover)]:hover:bg-accent/40"
            >
              <Thumbnail report={report} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{t(`financials:reportsFolder.${report}.title`)}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{t(`financials:reportsFolder.${report}.hint`)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
