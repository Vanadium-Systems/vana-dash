import { t } from '@/shared/lib/i18n'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { CallTableRow } from './CallTableRow'
import type { CallRow } from './types'

export function CallsTable({ calls }: { calls: CallRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('calls:columns.title')}</TableHead>
          <TableHead priority="md">{t('calls:columns.when')}</TableHead>
          <TableHead priority="lg" className="text-right">{t('calls:columns.duration')}</TableHead>
          <TableHead priority="lg" className="text-right">{t('calls:columns.participants')}</TableHead>
          <TableHead priority="md">{t('calls:columns.linkedTo')}</TableHead>
          <TableHead priority="md">{t('calls:columns.status')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('calls:actions.join')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {calls.map((call) => <CallTableRow key={call.id} call={call} />)}
      </TableBody>
    </Table>
  )
}
