import { Archive, ArchiveRestore, ListChecks, ListPlus, Trash2, UserRound, Workflow } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { t } from '@/shared/lib/i18n'
import type { ProspectAssignee } from '@/shared/lib/types'
import type { ProspectList } from './types'
import type { ProspectStatusEntry } from '@/shared/lib/types'

const TRIGGER = 'inline-flex h-control-sm items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4'

/**
 * The buttons of the selection bar. Owner, sequence and delete work on the picked rows only:
 * the backend takes filters instead of ids just for status, archive and lists.
 */
export function SelectionActions({
  statuses,
  assignees,
  lists,
  allMatching,
  archivedView,
  onStatus,
  onOwner,
  onList,
  onNewList,
  onSequence,
  onArchive,
  onDelete,
}: {
  statuses: ProspectStatusEntry[]
  assignees: ProspectAssignee[]
  lists: ProspectList[]
  allMatching: boolean
  archivedView: boolean
  onStatus: (status: string) => void
  onOwner: (userId: string) => void
  onList: (listId: string) => void
  /** Only for people who may create lists. */
  onNewList?: () => void
  onSequence: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={TRIGGER}>
          <ListChecks aria-hidden="true" /> {t('clients:prospects.bulk.status')}
        </DropdownMenuTrigger>
        <ResponsiveMenuContent title={t('clients:prospects.bulk.status')} align="start">
          {statuses.map((status) => (
            <DropdownMenuItem key={status.id} onClick={() => onStatus(status.key)}>
              {status.label}
            </DropdownMenuItem>
          ))}
        </ResponsiveMenuContent>
      </DropdownMenu>
      {allMatching ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger className={TRIGGER}>
            <UserRound aria-hidden="true" /> {t('clients:prospects.bulk.owner')}
          </DropdownMenuTrigger>
          <ResponsiveMenuContent title={t('clients:prospects.bulk.owner')} align="start">
            {assignees.map((person) => (
              <DropdownMenuItem key={person.id} onClick={() => onOwner(person.id)}>
                {person.displayName ?? person.email}
              </DropdownMenuItem>
            ))}
          </ResponsiveMenuContent>
        </DropdownMenu>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger className={TRIGGER}>
          <ListPlus aria-hidden="true" /> {t('clients:prospects.bulk.list')}
        </DropdownMenuTrigger>
        <ResponsiveMenuContent title={t('clients:prospects.bulk.list')} align="start">
          {lists.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t('clients:prospects.bulk.noLists')}</p> : null}
          {lists.map((list) => (
            <DropdownMenuItem key={list.id} onClick={() => onList(list.id)}>
              {list.name}
            </DropdownMenuItem>
          ))}
          {onNewList ? <DropdownMenuItem onClick={onNewList}>{t('clients:lists.add.newOption')}</DropdownMenuItem> : null}
        </ResponsiveMenuContent>
      </DropdownMenu>
      {allMatching ? null : (
        <Button type="button" variant="ghost" size="sm" onClick={onSequence}>
          <Workflow aria-hidden="true" /> {t('clients:prospects.bulk.sequence')}
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onArchive}>
        {archivedView ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />} {t(archivedView ? 'clients:prospects.bulk.unarchive' : 'clients:prospects.bulk.archive')}
      </Button>
      {allMatching ? null : (
        <Button type="button" variant="ghost" size="sm" className="text-destructive-text" onClick={onDelete}>
          <Trash2 aria-hidden="true" /> {t('common:actions.delete')}
        </Button>
      )}
    </>
  )
}
