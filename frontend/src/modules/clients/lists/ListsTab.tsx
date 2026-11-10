import { FolderPlus, ListPlus, Mail, Pencil, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { RowActions } from '@/shared/components/ui/row-actions'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { useMe } from '@/shared/hooks/use-me'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { usePageActions } from '@/shared/lib/page-actions'
import { EnrollListDialog } from '@/modules/email/sequence/EnrollListDialog'
import { FolderDialog, ListDialog } from './ListDialogs'
import type { ListEntry, ListFolder } from './types'
import { listFilterParam, useListActions, useListFolders, useLists } from './use-lists-data'

const NUMBER = 'text-right tabular-nums'

const shareLabel = (shared: boolean) => (shared ? t('clients:lists.sharedBadge') : t('clients:lists.privateBadge'))

function ListsTable({ lists, canWrite, canEnroll, onOpen, onEdit, onDelete, onEnroll }: { lists: ListEntry[]; canWrite: boolean; canEnroll: boolean; onOpen: (list: ListEntry) => void; onEdit: (list: ListEntry) => void; onDelete: (list: ListEntry) => void; onEnroll: (list: ListEntry) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('clients:lists.name')}</TableHead>
          <TableHead className={NUMBER}>{t('clients:lists.members')}</TableHead>
          <TableHead priority="md">{t('clients:lists.owner')}</TableHead>
          <TableHead priority="lg">{t('clients:lists.visibility')}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{t('common:labels.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lists.map((list) => (
          <TableRow key={list.id} className="cursor-pointer" onClick={() => onOpen(list)}>
            <TableCell className="tbl-fill">
              <button
                type="button"
                className="block max-w-full truncate rounded-sm text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(list)
                }}
              >
                {list.name}
              </button>
              <TableDetails items={[list.isMine ? t('clients:lists.mine') : list.ownerName, shareLabel(list.shared)]} />
            </TableCell>
            <TableCell className={NUMBER}>{formatNumber(list.memberCount)}</TableCell>
            <TableCell priority="md">{list.isMine ? t('clients:lists.mine') : list.ownerName}</TableCell>
            <TableCell priority="lg">
              <Badge variant="secondary">{shareLabel(list.shared)}</Badge>
            </TableCell>
            <TableCell>
              {(canWrite && list.isMine) || canEnroll ? (
                <RowActions
                  actions={[]}
                  title={list.name}
                  menu={[
                    ...(canEnroll ? [{ key: 'enroll', icon: Mail, label: t('email:sequences.enrollList.open'), onClick: () => onEnroll(list) }] : []),
                    ...(canWrite && list.isMine
                      ? [
                          { key: 'edit', icon: Pencil, label: t('common:actions.edit'), onClick: () => onEdit(list) },
                          { key: 'delete', icon: Trash2, label: t('common:actions.delete'), destructive: true, onClick: () => onDelete(list) },
                        ]
                      : []),
                  ]}
                />
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** The tab "Liste": folders with their lists. Opening a list shows its members in the prospect list. */
export function ListsTab() {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [, setSearchParams] = useSearchParams()
  const { can } = useMe()
  // Reading is `clienti.view`; creating and editing is the same write right as the rest of prospecting.
  const canWrite = can('clienti.prospectare')
  const canEnroll = can('email.bulk')
  const folders = useListFolders()
  const lists = useLists()
  const actions = useListActions()

  const [folderDialog, setFolderDialog] = useState<{ folder: ListFolder | null } | null>(null)
  const [enrollList, setEnrollList] = useState<ListEntry | null>(null)
  const [listDialog, setListDialog] = useState<{ list: ListEntry | null; folderId: string | null } | null>(null)

  const open = (list: ListEntry) => setSearchParams({ f: listFilterParam(list.id) })
  const fromSearch = () => navigate('/clients/lists/from-search')

  usePageActions(
    canWrite
      ? [
          { id: 'lists-new', label: t('clients:lists.palette.newList'), icon: ListPlus, run: () => setListDialog({ list: null, folderId: null }) },
          { id: 'lists-new-folder', label: t('clients:lists.palette.newFolder'), icon: FolderPlus, run: () => setFolderDialog({ folder: null }) },
          { id: 'lists-from-search', label: t('clients:lists.palette.fromSearch'), icon: Search, run: fromSearch },
        ]
      : [],
  )

  const deleteList = (list: ListEntry) =>
    void confirm({
      title: t('clients:lists.deleteTitle', { name: list.name }),
      consequence: t('clients:lists.deleteBody', { count: list.memberCount, n: formatNumber(list.memberCount) }),
      confirmLabel: t('clients:lists.deleteConfirm'),
      destructive: true,
    }).then((ok) => ok && actions.deleteList.mutate(list.id))

  const deleteFolder = (folder: ListFolder, inside: number) =>
    void confirm({
      title: t('clients:lists.folder.deleteTitle', { name: folder.name }),
      consequence: t('clients:lists.folder.deleteBody', { count: inside, n: formatNumber(inside) }),
      confirmLabel: t('clients:lists.folder.deleteConfirm'),
      destructive: true,
    }).then((ok) => ok && actions.deleteFolder.mutate(folder.id))

  if (folders.isPending || lists.isPending) return <ListSkeleton rows={6} />
  if (folders.isError || lists.isError) {
    return <EmptyState kind="filtered" title={t('clients:lists.loadFailed')} onReset={() => void Promise.all([folders.refetch(), lists.refetch()])} />
  }

  const allLists = lists.data
  const loose = allLists.filter((list) => !list.folderId || !folders.data.some((folder) => folder.id === list.folderId))
  const toolbar = canWrite ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button type="button" variant="outline" onClick={fromSearch}>
        <Search aria-hidden="true" /> {t('clients:lists.fromSearch')}
      </Button>
      <Button type="button" variant="outline" onClick={() => setFolderDialog({ folder: null })}>
        <FolderPlus aria-hidden="true" /> {t('clients:lists.folder.new')}
      </Button>
      <Button type="button" onClick={() => setListDialog({ list: null, folderId: null })}>
        <ListPlus aria-hidden="true" /> {t('clients:lists.new')}
      </Button>
    </div>
  ) : null

  const tableProps = { canWrite, canEnroll, onEnroll: setEnrollList, onOpen: open, onEdit: (list: ListEntry) => setListDialog({ list, folderId: null }), onDelete: deleteList }

  return (
    <div className="space-y-6">
      {toolbar}

      {allLists.length === 0 && folders.data.length === 0 ? (
        <EmptyState
          kind="new"
          title={t('clients:lists.emptyTitle')}
          description={t('clients:lists.emptyBody')}
          action={
            canWrite ? (
              <Button type="button" onClick={() => setListDialog({ list: null, folderId: null })}>
                <ListPlus aria-hidden="true" /> {t('clients:lists.new')}
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {folders.data.map((folder) => {
        const inside = allLists.filter((list) => list.folderId === folder.id)
        return (
          <section key={folder.id} className="space-y-2" aria-label={folder.name}>
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold">{folder.name}</h2>
              <Badge variant="secondary">{shareLabel(folder.shared)}</Badge>
              {folder.isMine ? null : <span className="min-w-0 truncate text-xs text-muted-foreground">{t('clients:lists.byOwner', { name: folder.ownerName })}</span>}
              {canWrite && folder.isMine ? (
                <div className="ml-auto">
                  <RowActions
                    actions={[]}
                    title={folder.name}
                    menu={[
                      { key: 'add', icon: ListPlus, label: t('clients:lists.new'), onClick: () => setListDialog({ list: null, folderId: folder.id }) },
                      { key: 'edit', icon: Pencil, label: t('common:actions.edit'), onClick: () => setFolderDialog({ folder }) },
                      { key: 'delete', icon: Trash2, label: t('common:actions.delete'), destructive: true, onClick: () => deleteFolder(folder, inside.length) },
                    ]}
                  />
                </div>
              ) : null}
            </div>
            {inside.length === 0 ? <p className="text-sm text-muted-foreground">{t('clients:lists.folder.empty')}</p> : <ListsTable lists={inside} {...tableProps} />}
          </section>
        )
      })}

      {loose.length > 0 ? (
        <section className="space-y-2" aria-label={t('clients:lists.noFolder')}>
          {folders.data.length > 0 ? <h2 className="text-sm font-semibold">{t('clients:lists.noFolder')}</h2> : null}
          <ListsTable lists={loose} {...tableProps} />
        </section>
      ) : null}

      <FolderDialog
        open={folderDialog !== null}
        folder={folderDialog?.folder ?? null}
        pending={actions.createFolder.isPending || actions.updateFolder.isPending}
        onOpenChange={(next) => !next && setFolderDialog(null)}
        onSave={(values) => {
          const folder = folderDialog?.folder
          const done = { onSuccess: () => setFolderDialog(null) }
          if (folder) actions.updateFolder.mutate({ id: folder.id, body: values }, done)
          else actions.createFolder.mutate(values, done)
        }}
      />
      <ListDialog
        open={listDialog !== null}
        list={listDialog?.list ?? null}
        defaultFolderId={listDialog?.folderId}
        folders={folders.data.filter((folder) => folder.isMine || folder.shared)}
        pending={actions.createList.isPending || actions.updateList.isPending}
        onOpenChange={(next) => !next && setListDialog(null)}
        onSave={(values) => {
          const list = listDialog?.list
          const done = { onSuccess: () => setListDialog(null) }
          if (list) actions.updateList.mutate({ id: list.id, body: values }, done)
          else actions.createList.mutate(values, done)
        }}
      />
      {enrollList ? <EnrollListDialog open list={enrollList} onOpenChange={(next) => !next && setEnrollList(null)} /> : null}
    </div>
  )
}
