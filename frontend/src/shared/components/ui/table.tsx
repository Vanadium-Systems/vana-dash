import * as React from 'react'
import { cn } from '@/shared/lib/utils'

type TableFit = 'full' | 'no-lg' | 'no-md'

// Width breakpoints can't promise a fit: long addresses, IBANs or a 150% zoom make a table wider
// than any fixed threshold expects. So the wrapper measures itself and drops the `lg` columns, then
// the `md` ones, until the table fits (`data-fit` in index.css). Starting from `full` every time
// makes the result depend only on the current width and content, so a resize can't make it flap.
// A callback ref, so it also works where the table appears only after loading.
export function useTableFit<T extends HTMLElement>() {
  const observer = React.useRef<ResizeObserver | null>(null)
  return React.useCallback((wrapper: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!wrapper) return
    // A title column cut to a few letters counts as not fitting too (the subject in Sent at 1280px).
    const titleTooNarrow = () => {
      const cell = wrapper.querySelector<HTMLElement>('tbody td.tbl-truncate, tbody td.tbl-fill')
      return Boolean(cell && cell.offsetParent && cell.clientWidth < 128)
    }
    const fit = () => {
      for (const level of ['full', 'no-lg', 'no-md'] as TableFit[]) {
        wrapper.dataset.fit = level
        if (wrapper.scrollWidth <= wrapper.clientWidth + 1 && !titleTooNarrow()) return
      }
    }
    fit()
    observer.current = new ResizeObserver(fit)
    observer.current.observe(wrapper)
    const table = wrapper.querySelector('table')
    if (table) observer.current.observe(table)
  }, [])
}

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => {
    const wrapperRef = useTableFit<HTMLDivElement>()
    return (
      <div ref={wrapperRef} className="tbl-container relative w-full overflow-auto">
        <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
      </div>
    )
  },
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />,
)
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  ),
)
TableBody.displayName = 'TableBody'

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn('border-b transition-colors duration-100 hover:bg-muted/50', className)} {...props} />
  ),
)
TableRow.displayName = 'TableRow'

// No table scrolls sideways (the GitHub pattern). The breakpoints are the table's own width, not
// the screen's (`.tbl-*` container queries in index.css): `priority="md"` hides under 40rem and its
// value moves to the <TableDetails> line under the row title, `priority="lg"` hides under 56rem.
// `truncate` cuts long text with "…" instead of wrapping it; `tbl-fill` on the title cell gives it
// the room left over.
type ColumnPriority = 'md' | 'lg'

const PRIORITY_CLASS: Record<ColumnPriority, string> = {
  md: 'tbl-md',
  lg: 'tbl-lg',
}

interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  priority?: ColumnPriority
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, priority, ...props }, ref) => (
    <th
      ref={ref}
      className={cn('h-control-md whitespace-nowrap px-2 text-left align-middle text-xs font-medium text-muted-foreground', priority && PRIORITY_CLASS[priority], className)}
      {...props}
    />
  ),
)
TableHead.displayName = 'TableHead'

interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  priority?: ColumnPriority
  truncate?: boolean
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, priority, truncate = false, children, ...props }, ref) => (
    <td ref={ref} className={cn('p-2 align-middle', priority && PRIORITY_CLASS[priority], truncate && 'tbl-truncate w-full max-w-0', className)} {...props}>
      {truncate ? <div className="truncate">{children}</div> : children}
    </td>
  ),
)
TableCell.displayName = 'TableCell'

/** The second line of a row title in a narrow table: the values of the `priority="md"` columns. */
function TableDetails({ items }: { items: React.ReactNode[] }) {
  const shown = items.filter((item) => item !== null && item !== undefined && item !== false && item !== '')
  if (shown.length === 0) return null
  return (
    // Wraps instead of cutting every value to a few letters when the title column is narrow.
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs font-normal text-muted-foreground tbl-details">
      {shown.map((item, i) => (
        <span key={i} className="max-w-full truncate">
          {item}
        </span>
      ))}
    </div>
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableDetails }
