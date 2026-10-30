import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'
import { Select } from './select'
import { t } from '@/shared/lib/i18n'

export const PAGE_SIZES = [10, 25, 50] as const

// The footer under a long table: rows per page, the range shown, previous / next. `page` counts from 0.
export function TablePagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize: (pageSize: number) => void
}) {
  if (total <= PAGE_SIZES[0]) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
      <Select size="sm" className="w-auto shrink-0" title={t('common:pagination.rowsPerPage')} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {t('common:pagination.perPage', { size })}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-1.5">
        <span className="whitespace-nowrap tabular-nums">
          {t('common:pagination.range', { from: page * pageSize + 1, to: Math.min((page + 1) * pageSize, total), total })}
        </span>
        <Button variant="outline" size="icon" title={t('common:actions.previousPage')} aria-label={t('common:actions.previousPage')} disabled={page === 0} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" title={t('common:actions.nextPage')} aria-label={t('common:actions.nextPage')} disabled={(page + 1) * pageSize >= total} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
