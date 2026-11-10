import { useDroppable } from '@dnd-kit/core'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { PageGuidesLink } from '@/shared/components/PageHeader'
import { DropdownMenu, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useCollapsingTitle } from '@/shared/hooks/use-collapsing-title'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { StorageUsage } from '@/shared/lib/types'
import { cn, formatBytes } from '@/shared/lib/utils'

export type ArchiveView = 'own' | 'shared' | 'all' | 'recent' | 'starred' | 'trash' | 'space'

export interface Crumb {
  id: string | null
  name: string
  /** A folder a dragged item can be dropped on from the path. */
  dropFolderId?: string
}

// Red over 90% of the free R2 tier (config.r2.freeTierLimitGb): seen in time, before the plan
// changes by itself.
function StorageUsageIndicator() {
  const usage = useQuery({
    queryKey: ['archive', 'storage'],
    queryFn: () => api.get<StorageUsage>('/api/archive/storage'),
    staleTime: 5 * 60 * 1000,
  })
  if (!usage.data) return null
  const ratio = usage.data.usedBytes / usage.data.limitBytes
  const tone = ratio >= 0.9 ? 'text-destructive-text' : ratio >= 0.7 ? 'text-warning-text' : 'text-muted-foreground'
  return (
    <span className={cn('tnum whitespace-nowrap text-xs', tone)} title={t('archive:storage.hint')}>
      {formatBytes(usage.data.usedBytes)} / {formatBytes(usage.data.limitBytes)}
    </span>
  )
}

export const crumbDropId = (crumb: Crumb) => `crumb:${crumb.id ?? 'root'}`

function CrumbLink({ crumb, onNavigate }: { crumb: Crumb; onNavigate: (id: string | null) => void }) {
  const drop = useDroppable({ id: crumbDropId(crumb), disabled: !crumb.dropFolderId })
  return (
    <button
      ref={drop.setNodeRef}
      type="button"
      className={cn('max-w-[40vw] truncate rounded-md px-1 text-muted-foreground hover:text-foreground hover:underline', drop.isOver && 'bg-accent text-foreground')}
      onClick={() => onNavigate(crumb.id)}
    >
      {crumb.name}
    </button>
  )
}

export function ArchiveHeader({
  tabs,
  view,
  onView,
  trail,
  onNavigate,
  folderMenu,
  ownerNote,
  actions,
}: {
  tabs: { value: ArchiveView; label: string }[]
  view: ArchiveView
  onView: (view: ArchiveView) => void
  trail: Crumb[]
  onNavigate: (id: string | null) => void
  /** The items of the last segment's menu (New folder, Upload...); none = a plain title. */
  folderMenu: ReactNode | null
  ownerNote: string | null
  actions: ReactNode
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const collapsed = useCollapsingTitle(titleRef)
  const last = trail[trail.length - 1]
  const parents = trail.slice(0, -1)

  return (
    <div className="space-y-3">
      {/* On a phone the path climbs into a bar at the top once it scrolls out of view. */}
      <div className="sticky top-0 z-30 h-0 md:hidden">
        <div
          aria-hidden={!collapsed}
          className={cn(
            'glass absolute inset-x-0 top-0 truncate border-b px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] text-sm font-medium transition-opacity duration-fast',
            collapsed ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          {last?.name}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 ref={titleRef} className="min-w-0 text-xl font-semibold">
              <nav aria-label={t('archive:header.path')}>
                <ol className="flex flex-wrap items-center gap-x-0.5">
                  {parents.map((crumb) => (
                    <li key={crumb.id ?? 'root'} className="flex items-center gap-0.5">
                      <CrumbLink crumb={crumb} onNavigate={onNavigate} />
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </li>
                  ))}
                  <li className="min-w-0" aria-current="page">
                    {folderMenu ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex max-w-full items-center gap-1 rounded-md px-1 hover:bg-accent">
                          <span className="max-w-[60vw] truncate">{last?.name}</span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <ResponsiveMenuContent title={last?.name} align="start">
                          {folderMenu}
                        </ResponsiveMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="block truncate">{last?.name}</span>
                    )}
                  </li>
                </ol>
              </nav>
            </h1>
            <PageGuidesLink />
          </div>
          {ownerNote ? <p className="mt-0.5 text-sm text-muted-foreground">{ownerNote}</p> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StorageUsageIndicator />
          {actions}
        </div>
      </div>

      <Tabs value={view} onValueChange={(value) => onView(value as ArchiveView)}>
        <TabsList variant="segmented">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
