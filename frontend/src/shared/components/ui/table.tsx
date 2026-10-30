import * as React from 'react'
import { cn } from '@/shared/lib/utils'

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
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

// Narrow screens (T1-T3 in UX_RESEARCH, the GitHub pattern): no sideways scroll. A column with
// `priority="md"` hides below md and its value moves to the <TableDetails> line under the row title;
// `priority="lg"` only hides below lg. `truncate` cuts long text with "…" instead of wrapping it.
type ColumnPriority = 'md' | 'lg'

const PRIORITY_CLASS: Record<ColumnPriority, string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
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
    <td ref={ref} className={cn('p-2 align-middle', priority && PRIORITY_CLASS[priority], truncate && 'w-full max-w-0', className)} {...props}>
      {truncate ? <div className="truncate">{children}</div> : children}
    </td>
  ),
)
TableCell.displayName = 'TableCell'

/** The second line of a row title on narrow screens: the values of the `priority="md"` columns. */
function TableDetails({ items }: { items: React.ReactNode[] }) {
  const shown = items.filter((item) => item !== null && item !== undefined && item !== false && item !== '')
  if (shown.length === 0) return null
  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs font-normal text-muted-foreground md:hidden">
      {shown.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span aria-hidden="true">·</span> : null}
          <span className="truncate">{item}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableDetails }
