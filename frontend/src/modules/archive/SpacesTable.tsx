import { Badge } from '@/shared/components/ui/badge'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { t } from '@/shared/lib/i18n'
import type { AccessLevel, ArchiveSpaceEntry } from '@/shared/lib/types'
import { FolderGlyph } from './FolderGlyph'

const LEVEL_LABEL: Record<AccessLevel, string> = { view: t('common:access.share.levelView'), edit: t('common:access.share.levelEdit') }

// Folders shared with the person or, for an administrator, the roots of every space. The owner is
// written on the row, not implied by grouping: the same list mixes the spaces of several people.
export function SpacesTable({ entries, onOpen }: { entries: ArchiveSpaceEntry[]; onOpen: (id: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t('archive:labels.folder')}</TableHead>
          <TableHead priority="md">{t('archive:labels.owner')}</TableHead>
          <TableHead className="text-right">{t('archive:labels.access')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id} className="cursor-pointer" onClick={() => onOpen(entry.id)}>
            <TableCell className="w-full max-w-0 font-medium">
              <span className="flex min-w-0 items-center gap-2">
                <FolderGlyph color={null} className="h-4 w-4" /> <span className="truncate">{entry.name}</span>
              </span>
              <TableDetails items={[entry.ownerName]} />
            </TableCell>
            <TableCell priority="md" className="whitespace-nowrap text-muted-foreground">
              {entry.ownerName}
            </TableCell>
            <TableCell className="text-right">
              <Badge variant="secondary">{LEVEL_LABEL[entry.level]}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
