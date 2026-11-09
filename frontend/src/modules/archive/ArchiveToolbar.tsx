import { LayoutGrid, List, Search } from 'lucide-react'
import type { RefObject } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'
import { FilterChips, type FilterValues } from './FilterChips'

export type ViewMode = 'list' | 'grid'
export type SortMode = 'recent' | 'oldest' | 'name'

const SORT_LABEL = { recent: 'archive:sort.newest', oldest: 'archive:sort.oldest', name: 'archive:sort.name' } as const

// Search first, then the chips, and the sort and the view mode at the far end. While rows are
// selected the page puts the selection bar in this place instead, same height.
export function ArchiveToolbar({
  searchRef,
  search,
  onSearch,
  filters,
  tagOptions,
  onFilters,
  sort,
  onSort,
  showSort,
  viewMode,
  onViewMode,
}: {
  searchRef: RefObject<HTMLInputElement>
  search: string
  onSearch: (text: string) => void
  filters: FilterValues
  tagOptions: string[]
  onFilters: (next: Partial<FilterValues>) => void
  sort: SortMode
  onSort: (sort: SortMode) => void
  showSort: boolean
  viewMode: ViewMode
  onViewMode: (mode: ViewMode) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full min-w-0 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input ref={searchRef} className="pl-8" type="search" aria-label={t('archive:search.label')} placeholder={t('archive:search.placeholder')} value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <FilterChips values={filters} tagOptions={tagOptions} onChange={onFilters} />
      <div className="ml-auto flex items-center gap-2">
        {showSort ? (
          <Select className="w-auto" value={sort} onChange={(e) => onSort(e.target.value as SortMode)} title={t('archive:view.sortFiles')} aria-label={t('archive:view.sortFiles')}>
            {(Object.keys(SORT_LABEL) as SortMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {t(SORT_LABEL[mode])}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="flex items-center gap-1 rounded-md border border-input p-0.5">
          <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="icon-sm" title={t('archive:view.list')} aria-label={t('archive:view.list')} aria-pressed={viewMode === 'list'} onClick={() => onViewMode('list')}>
            <List className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === 'grid' ? 'default' : 'ghost'} size="icon-sm" title={t('archive:view.grid')} aria-label={t('archive:view.grid')} aria-pressed={viewMode === 'grid'} onClick={() => onViewMode('grid')}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
