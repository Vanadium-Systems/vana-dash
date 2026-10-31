import { cn } from '@/shared/lib/utils'

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

// Widths cycle by row index, not Math.random(), so the placeholder does not reshuffle on re-render.
const FIRST_LINE_WIDTHS = ['w-3/5', 'w-1/2', 'w-2/3', 'w-[55%]']
const SECOND_LINE_WIDTHS = ['w-2/5', 'w-1/3', 'w-1/2', 'w-[35%]']

function ListSkeleton({ rows = 6, lines = 2, avatar = false, className }: { rows?: number; lines?: number; avatar?: boolean; className?: string }) {
  return (
    <div className={cn('divide-y', className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-3 px-3 py-3">
          {avatar ? <Skeleton className="h-8 w-8 shrink-0 rounded-full" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={cn('h-4', FIRST_LINE_WIDTHS[row % FIRST_LINE_WIDTHS.length])} />
            {lines > 1 ? <Skeleton className={cn('h-3', SECOND_LINE_WIDTHS[row % SECOND_LINE_WIDTHS.length])} /> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export { Skeleton, ListSkeleton }
