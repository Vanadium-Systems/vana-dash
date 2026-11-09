import { useQuery } from '@tanstack/react-query'
import { Download, Star, StarOff } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { SidePeek } from '@/shared/components/ui/side-peek'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useMe } from '@/shared/hooks/use-me'
import { api, ApiError } from '@/shared/lib/api'
import { fileCategory, fileTypeLabel } from '@/shared/lib/file-type'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { ArchiveDetails, ArchivePerson } from '@/shared/lib/types'
import { formatBytes } from '@/shared/lib/utils'
import { FolderGlyph } from './FolderGlyph'
import type { ItemActions } from './ItemMenu'
import { ItemGlyph } from './ItemName'
import type { ArchiveItem } from './items'

// The id comes from the URL, which does not say file or folder: a file is tried first.
async function fetchDetails(id: string): Promise<ArchiveDetails> {
  try {
    return await api.get<ArchiveDetails>(`/api/archive/files/${id}/details`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return api.get<ArchiveDetails>(`/api/archive/folders/${id}/details`)
    throw err
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function who(person: ArchivePerson | null, at: string) {
  return person ? t('archive:details.byAt', { name: person.name, date: formatDateTime(at) }) : formatDateTime(at)
}

export function DetailsPeek({
  id,
  item,
  actions,
  raised,
  onClose,
  onOpenFolder,
}: {
  id: string | null
  /** The row it was opened from, when it is on screen: gives the thumbnail and the actions. */
  item: ArchiveItem | null
  actions: ItemActions
  /** Above the file viewer (z-[60]), when it was opened from there. */
  raised: boolean
  onClose: () => void
  onOpenFolder: (folderId: string) => void
}) {
  const { session } = useMe()
  const details = useQuery({
    queryKey: ['archive', 'details', id],
    queryFn: () => fetchDetails(id!),
    enabled: id !== null,
  })
  const data = details.data
  const isFile = data ? data.mimeType !== undefined : item?.kind === 'file'
  const mine = data?.access.find((entry) => entry.userId === session?.user.id)
  const readOnly = data && data.owner?.id !== session?.user.id && mine?.level === 'view'
  const starred = data?.starred ?? item?.starred ?? false

  return (
    <SidePeek open={id !== null} onClose={onClose} title={data?.name ?? item?.name ?? t('archive:details.title')} className={raised ? 'z-[70]' : undefined}>
      {details.isError ? (
        <p className="text-sm text-muted-foreground">{t('archive:details.gone')}</p>
      ) : !data ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="aspect-[4/3] w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-muted">
            {item?.previewUrl ? (
              <img src={item.previewUrl} alt="" className="h-full w-full object-contain" />
            ) : isFile ? (
              item ? <ItemGlyph item={item} className="h-12 w-12" /> : null
            ) : (
              <FolderGlyph color={data.color ?? null} className="h-12 w-12" />
            )}
          </div>

          {item ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => actions.download([item])}>
                <Download className="h-4 w-4" /> {t('common:actions.download')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => actions.toggleStar([item])}>
                {starred ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                {starred ? t('archive:menu.unstar') : t('archive:menu.star')}
              </Button>
            </div>
          ) : null}

          {readOnly ? <p className="rounded-md bg-muted px-3 py-2 text-sm">{t('archive:details.readOnly', { name: data.owner?.name ?? '' })}</p> : null}

          <dl className="space-y-2">
            <Field label={t('common:labels.type')}>{data.mimeType !== undefined ? fileTypeLabel(fileCategory(data.mimeType)) : t('archive:types.folder')}</Field>
            {data.sizeBytes !== undefined ? <Field label={t('archive:labels.size')}>{formatBytes(data.sizeBytes)}</Field> : null}
            <Field label={t('archive:labels.location')}>
              {data.path.length ? (
                <span className="flex flex-wrap items-center gap-x-1">
                  {data.path.map((place, index) => (
                    <span key={place.id} className="flex items-center gap-1">
                      {index > 0 ? <span aria-hidden="true">/</span> : null}
                      <button type="button" className="hover:underline" onClick={() => onOpenFolder(place.id)}>
                        {place.name}
                      </button>
                    </span>
                  ))}
                </span>
              ) : (
                t('archive:folders.root')
              )}
            </Field>
            <Field label={t('archive:details.created')}>{who(data.createdBy, data.createdAt)}</Field>
            <Field label={t('archive:details.modified')}>{who(data.updatedBy, data.updatedAt)}</Field>
            {data.tags?.length ? (
              <Field label={t('archive:labels.tags')}>
                <span className="flex flex-wrap gap-1">
                  {data.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </span>
              </Field>
            ) : null}
          </dl>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('archive:details.access')}</h3>
            <ul className="divide-y text-sm">
              {data.owner ? (
                <li className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate">{data.owner.name}</span>
                  <span className="shrink-0 text-muted-foreground">{t('archive:details.owner')}</span>
                </li>
              ) : null}
              {data.access.map((entry) => (
                <li key={entry.userId} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate">{entry.name}</p>
                    {entry.inherited ? (
                      <p className="text-xs text-muted-foreground">
                        {entry.inheritedFrom ? t('archive:details.inheritedFrom', { folder: entry.inheritedFrom.name }) : t('archive:details.inheritedAbove')}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {entry.level === 'edit' ? t('common:access.share.levelEdit') : t('common:access.share.levelView')}
                  </Badge>
                </li>
              ))}
            </ul>
            {data.access.length === 0 ? <p className="text-sm text-muted-foreground">{t('archive:details.onlyOwner')}</p> : null}
          </section>
        </div>
      )}
    </SidePeek>
  )
}
