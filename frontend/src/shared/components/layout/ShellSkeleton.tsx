import { ListSkeleton, Skeleton } from '@/shared/components/ui/skeleton'

/** What a page shows while its code loads: a title and list rows, inside a shell that stays put. */
export function ContentSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <Skeleton className="h-7 w-48" />
      <ListSkeleton rows={8} />
    </div>
  )
}

/** The shell's outline before the session is known, same widths as AppLayout, so nothing jumps. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen">
      <aside aria-hidden="true" className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-2 border-r bg-card p-3 md:flex">
        <Skeleton className="mb-4 h-7 w-32" />
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton key={index} className="h-5" style={{ width: `${60 + ((index * 17) % 30)}%` }} />
        ))}
      </aside>
      <main className="safe-top flex-1 p-4 md:p-6">
        <div className="mx-auto max-w-6xl">
          <ContentSkeleton />
        </div>
      </main>
    </div>
  )
}
