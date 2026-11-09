import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { RowActions } from '@/shared/components/ui/row-actions'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import { FILE_TYPE_ICON, fileCategory } from '@/shared/lib/file-type'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { ArchiveTrashEntry } from '@/shared/lib/types'
import { formatBytes } from '@/shared/lib/utils'
import { FolderGlyph } from './FolderGlyph'

const TRASH_KEY = ['archive', 'trash'] as const

function purgeDate(entry: ArchiveTrashEntry): string {
  return t('archive:trash.purgeOn', { date: formatDate(entry.purgeAfter, { day: 'numeric', month: 'short' }) })
}

function contentText(entry: ArchiveTrashEntry): string {
  return entry.rootType === 'folder'
    ? t('archive:trash.contents', { count: entry.itemCount, size: formatBytes(entry.totalBytes) })
    : formatBytes(entry.totalBytes)
}

function EntryGlyph({ entry }: { entry: ArchiveTrashEntry }) {
  if (entry.rootType === 'folder') return <FolderGlyph color={null} className="h-4 w-4" />
  const Icon = FILE_TYPE_ICON[fileCategory(entry.mimeType ?? '')]
  return <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
}

// One row per delete (a batch), not per file: a folder with 34 files is a single line that comes
// back as a whole. Permanent delete lives only here, behind a dialog with the numbers.
export function TrashView({ onOpenFolder }: { onOpenFolder: (id: string) => void }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const trash = useQuery({ queryKey: TRASH_KEY, queryFn: () => api.get<ArchiveTrashEntry[]>('/api/archive/trash') })

  const restore = useMutation({
    mutationFn: (entry: ArchiveTrashEntry) =>
      api.post<{ restoredTo: { id: string; name: string }; name: string }>(`/api/archive/trash/${entry.id}/restore`),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
      toast.success(t('archive:trash.restored', { name: result.name, folder: result.restoredTo.name }), {
        action: { label: t('common:actions.view'), onClick: () => onOpenFolder(result.restoredTo.id) },
      })
    },
    onError: (err) => toast.error(err.message),
  })

  const purge = useMutation({
    mutationFn: (entry: ArchiveTrashEntry) => api.delete<{ itemCount: number; totalBytes: number }>(`/api/archive/trash/${entry.id}`),
    onSuccess: (_result, entry) => {
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
      toast.success(t('archive:trash.purged', { name: entry.rootName }))
    },
    onError: (err) => toast.error(err.message),
  })

  function askPurge(entry: ArchiveTrashEntry) {
    void confirm({
      title: t('archive:trash.purgeTitle', { name: entry.rootName }),
      consequence: t('archive:trash.purgeBody', { count: entry.itemCount, size: formatBytes(entry.totalBytes) }),
      confirmLabel: t('archive:trash.purgeConfirm'),
      destructive: true,
    }).then((ok) => ok && purge.mutate(entry))
  }

  if (trash.isPending) return <ListSkeleton rows={4} />
  if (trash.isError) return <EmptyState kind="new" title={t('common:states.loadFailed')} />
  if (!trash.data.length) return <EmptyState kind="new" title={t('archive:trash.emptyTitle')} description={t('archive:trash.emptyHint')} />

  return (
    <Table>
      <TableHeader className="max-sm:hidden">
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-full">{t('common:labels.name')}</TableHead>
          <TableHead priority="md">{t('archive:trash.content')}</TableHead>
          <TableHead priority="md">{t('archive:trash.deleted')}</TableHead>
          <TableHead priority="lg">{t('archive:trash.purgeHead')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('common:labels.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trash.data.map((entry) => {
          const deleted = `${entry.deletedBy.name}, ${formatDateTime(entry.deletedAt)}`
          return (
            <TableRow key={entry.id} data-row-id={entry.id}>
              <TableCell className="w-full max-w-0 tbl-fill">
                <div className="flex min-w-0 items-center gap-2">
                  <EntryGlyph entry={entry} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={entry.rootName}>
                      {entry.rootName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{t('archive:trash.from', { folder: entry.parentName })}</p>
                    <TableDetails items={[contentText(entry), deleted, purgeDate(entry)]} />
                  </div>
                </div>
              </TableCell>
              <TableCell priority="md" className="whitespace-nowrap text-muted-foreground">
                {contentText(entry)}
              </TableCell>
              <TableCell priority="md" className="whitespace-nowrap text-muted-foreground">
                {deleted}
              </TableCell>
              <TableCell priority="lg" className="whitespace-nowrap text-muted-foreground">
                {purgeDate(entry)}
              </TableCell>
              <TableCell className="w-px">
                <RowActions
                  title={entry.rootName}
                  actions={[
                    { key: 'restore', icon: RotateCcw, label: t('common:actions.restore'), onClick: () => restore.mutate(entry), disabled: restore.isPending },
                    { key: 'purge', icon: Trash2, label: t('archive:trash.purgeConfirm'), onClick: () => askPurge(entry), destructive: true },
                  ]}
                />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
