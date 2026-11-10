import { Badge } from '@/shared/components/ui/badge'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import type { PersonRow } from './types'
import type { ProspectStatusEntry } from '@/shared/lib/types'

/** The Oameni tab: one row per person with the company they belong to. Opening a row opens the company. */
export function PeopleTable({ rows, statuses, openProspect, fetching }: { rows: PersonRow[]; statuses: ProspectStatusEntry[]; openProspect: (id: string) => void; fetching: boolean }) {
  const statusLabel = (key: string) => statuses.find((status) => status.key === key)?.label ?? key
  return (
    <div className={cn('transition-opacity', fetching && 'opacity-60')} aria-busy={fetching}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('clients:prospects.people.person')}</TableHead>
            <TableHead priority="md">{t('common:labels.company')}</TableHead>
            <TableHead priority="md">{t('clients:prospects.columns.contact')}</TableHead>
            <TableHead priority="lg">{t('common:labels.status')}</TableHead>
            <TableHead priority="lg">{t('clients:prospects.columns.owner')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((person) => {
            const contact = person.phone ?? person.email
            return (
              <TableRow key={person.id} data-row-id={person.id} className="cursor-pointer" onClick={() => openProspect(person.prospectId)}>
                <TableCell className="tbl-fill tbl-fill-lg md:max-w-[16rem]">
                  <div className="truncate font-medium">{person.name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{person.role ?? t('clients:prospects.people.noRole')}</span>
                    {person.isDecisionMaker ? <Badge variant="secondary">{t('clients:prospects.people.decisionMaker')}</Badge> : null}
                    {person.doNotContact ? <Badge variant="destructive">{t('clients:prospects.people.doNotContact')}</Badge> : null}
                  </div>
                  <div className="tbl-lg-fallback truncate text-xs text-muted-foreground">{[statusLabel(person.status), person.ownerName].filter(Boolean).join(' · ')}</div>
                  <TableDetails items={[person.prospectName, contact]} />
                </TableCell>
                <TableCell priority="md">
                  <span className="block max-w-[14rem] truncate">{person.prospectName}</span>
                </TableCell>
                <TableCell priority="md">
                  <div className="max-w-[13rem] text-xs leading-tight">
                    {person.phone ? <div className="truncate">{person.phone}</div> : null}
                    {person.email ? <div className="truncate text-muted-foreground">{person.email}</div> : null}
                    {contact ? null : <span className="text-muted-foreground">—</span>}
                  </div>
                </TableCell>
                <TableCell priority="lg">{statusLabel(person.status)}</TableCell>
                <TableCell priority="lg">{person.ownerName ?? <span className="text-muted-foreground">—</span>}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
