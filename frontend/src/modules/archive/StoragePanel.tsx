import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { chartColor } from '@/shared/lib/chart-colors'
import { formatNumber, intlTag } from '@/shared/lib/format'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { StorageSource, StorageUsageDetails } from '@/shared/lib/types'
import { cn, formatBytes } from '@/shared/lib/utils'

const SOURCES: StorageSource[] = ['arhiva', 'note_vocale', 'mesaje']
const sourceLabel = (source: StorageSource) =>
  source === 'arhiva' ? t('archive:space.sources.arhiva') : source === 'note_vocale' ? t('archive:space.sources.note_vocale') : t('archive:space.sources.mesaje')

export function usageTone(ratio: number): { bar: string; text: string } {
  if (ratio > 0.95) return { bar: 'bg-destructive', text: 'text-destructive-text' }
  if (ratio > 0.8) return { bar: 'bg-warning', text: 'text-warning-text' }
  return { bar: 'bg-primary', text: 'text-muted-foreground' }
}

const percent = (part: number, whole: number) =>
  new Intl.NumberFormat(intlTag(), { style: 'percent', maximumFractionDigits: 1 }).format(whole > 0 ? part / whole : 0)

// Color is never the only carrier: every segment has its label, size and file count in the legend.
// `scale` = what a full bar means: the bucket for the source split, the largest person in the
// per-person table, so a person who takes up little gets a short bar, not a full one.
function SourceBar({ bytes, scale, className }: { bytes: Record<StorageSource, number>; scale: number; className?: string }) {
  return (
    <div className={cn('flex h-2 w-full overflow-hidden rounded-full bg-muted', className)} aria-hidden="true">
      {SOURCES.map((source, i) => (
        <span key={source} className="h-full" style={{ width: `${scale > 0 ? (bytes[source] / scale) * 100 : 0}%`, backgroundColor: chartColor(i) }} />
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

// Admin-only (`arhiva.spatiu`): where the R2 space goes, by source, person and folder.
export function StoragePanel({ onOpenFolder }: { onOpenFolder: (id: string) => void }) {
  const usage = useQuery({
    queryKey: ['archive', 'storage-usage'],
    queryFn: () => api.get<StorageUsageDetails>('/api/archive/storage-usage'),
  })

  if (usage.isPending) return <ListSkeleton rows={5} />
  if (usage.isError) return <EmptyState kind="new" title={t('common:states.loadFailed')} />

  const { limitBytes, usedBytes, uncounted, bySource, byPerson, topFolders } = usage.data
  const ratio = limitBytes > 0 ? usedBytes / limitBytes : 0
  const tone = usageTone(ratio)
  const sourceStats = SOURCES.map((source) => bySource.find((entry) => entry.source === source) ?? { source, bytes: 0, files: 0 })
  const sourceBytes = { arhiva: sourceStats[0]!.bytes, note_vocale: sourceStats[1]!.bytes, mesaje: sourceStats[2]!.bytes }

  if (usedBytes === 0 && topFolders.length === 0) return <EmptyState kind="new" title={t('archive:space.empty')} />

  return (
    <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="tnum text-lg font-semibold">{t('archive:space.used', { used: formatBytes(usedBytes), limit: formatBytes(limitBytes) })}</p>
            <p className={cn('tnum text-sm', tone.text)} data-testid="space-percent">
              {t('archive:space.percent', { percent: percent(usedBytes, limitBytes) })}
            </p>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(ratio * 100))}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div data-testid="space-bar" className={cn('h-full', tone.bar)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
        </div>

        <Section title={t('archive:space.source')}>
          <SourceBar bytes={sourceBytes} scale={usedBytes} className="h-3" />
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {sourceStats.map((entry, i) => (
              <li key={entry.source} className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: chartColor(i) }} aria-hidden="true" />
                <span className="min-w-0 truncate">{sourceLabel(entry.source)}</span>
                <span className="tnum ml-auto shrink-0 text-muted-foreground">
                  {formatBytes(entry.bytes)} · {t('archive:space.files', { count: entry.files })}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t('archive:space.byPerson')}>
          {byPerson.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('archive:space.emptyPeople')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('archive:space.person')}</TableHead>
                  <TableHead className="text-right">{t('archive:space.total')}</TableHead>
                  <TableHead priority="md">{t('archive:space.split')}</TableHead>
                  <TableHead priority="lg" className="text-right">{t('archive:space.share')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byPerson.map((person) => {
                  const share = percent(person.bytes, usedBytes)
                  return (
                    <TableRow key={person.userId ?? 'system'}>
                      <TableCell className="font-medium tbl-fill">
                        <div className="truncate">{person.name ?? t('archive:space.system')}</div>
                        <TableDetails items={[share]} />
                      </TableCell>
                      <TableCell className="tnum whitespace-nowrap text-right">{formatBytes(person.bytes)}</TableCell>
                      <TableCell priority="md">
                        <SourceBar bytes={person.bySource} scale={byPerson[0]?.bytes ?? 0} className="min-w-24" />
                      </TableCell>
                      <TableCell priority="lg" className="tnum whitespace-nowrap text-right text-muted-foreground">{share}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title={t('archive:space.topFolders')}>
          {topFolders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('archive:space.emptyFolders')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('archive:space.folder')}</TableHead>
                  <TableHead priority="md">{t('archive:space.owner')}</TableHead>
                  <TableHead priority="lg" className="text-right">{t('archive:space.filesCol')}</TableHead>
                  <TableHead className="text-right">{t('archive:space.size')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topFolders.map((folder) => (
                  <TableRow key={folder.folderId}>
                    <TableCell className="font-medium tbl-fill">
                      <button type="button" className="block max-w-full truncate rounded-sm text-left hover:underline" onClick={() => onOpenFolder(folder.folderId)}>
                        {folder.name}
                      </button>
                      <TableDetails items={[folder.ownerName, t('archive:space.files', { count: folder.files })]} />
                    </TableCell>
                    <TableCell priority="md" className="text-muted-foreground">{folder.ownerName ?? t('archive:space.system')}</TableCell>
                    <TableCell priority="lg" className="tnum text-right text-muted-foreground">{formatNumber(folder.files)}</TableCell>
                    <TableCell className="tnum whitespace-nowrap text-right">{formatBytes(folder.bytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        {uncounted.includes('quarterly-packages') ? <p className="text-xs text-muted-foreground">{t('archive:space.uncounted.quarterly-packages')}</p> : null}
    </div>
  )
}
