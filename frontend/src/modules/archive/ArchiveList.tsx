import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import { t } from '@/shared/lib/i18n'
import { ArchiveRow } from './ArchiveRow'
import type { ArchiveItem } from './items'
import type { ListEnv } from './list-env'

export interface ListPagination {
  /** 1-based, as in the URL. */
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  onPageSize: (pageSize: number) => void
}

// No header on a phone: the rows carry their own second line (type, date, size). The columns after
// the name leave by priority as the table narrows, `useTableFit` inside `Table` makes sure of it.
export function ArchiveList({ items, env, pagination }: { items: ArchiveItem[]; env: ListEnv; pagination?: ListPagination }) {
  return (
    <>
      <Table>
        <TableHeader className="max-sm:hidden">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full">{t('common:labels.name')}</TableHead>
            <TableHead priority="lg">{t('common:labels.type')}</TableHead>
            <TableHead priority="md">{t('archive:labels.modified')}</TableHead>
            <TableHead priority="md" className="text-right">
              {t('archive:labels.size')}
            </TableHead>
            <TableHead>
              <span className="sr-only">{t('common:labels.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <ArchiveRow key={`${item.kind}:${item.id}`} item={item} env={env} />
          ))}
        </TableBody>
      </Table>
      {pagination ? (
        <TablePagination
          page={pagination.page - 1}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPage={(page) => pagination.onPage(page + 1)}
          onPageSize={pagination.onPageSize}
        />
      ) : null}
    </>
  )
}
