import { useMemo, useState } from 'react'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Select } from '@/shared/components/ui/select'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useMe } from '@/shared/hooks/use-me'
import { formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import type { ProspectAssignee } from '@/shared/lib/types'
import { FILL_TEXTS, ROW_ERROR_TEXTS, labelOf } from './use-import'
import type { Distribution, DistributionMode, ImportAction, ImportPreview, PreviewRow } from './types'

const TAB_TEXTS: Record<ImportAction, TKey> = {
  new: 'clients:import.preview.tabs.new',
  update: 'clients:import.preview.tabs.update',
  error: 'clients:import.preview.tabs.error',
  skip: 'clients:import.preview.tabs.skip',
}
const TABS = Object.keys(TAB_TEXTS) as ImportAction[]

function rowNote(row: PreviewRow): string {
  if (row.action === 'update') {
    const fills = row.fills.map((field) => labelOf(FILL_TEXTS, field)).join(', ')
    const base = fills ? t('clients:import.preview.fills', { fields: fills }) : t('clients:import.preview.nothingToFill')
    return row.ownerName ? `${base} · ${t('clients:import.preview.staysWith', { owner: row.ownerName })}` : base
  }
  if (row.action === 'error') return row.error ? labelOf(ROW_ERROR_TEXTS, row.error) : ''
  if (row.action === 'skip') return row.reason ? labelOf(ROW_ERROR_TEXTS, row.reason) : ''
  return ''
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const shown = rows.slice(page * pageSize, (page + 1) * pageSize)
  if (rows.length === 0) return <EmptyState kind="new" title={t('clients:import.preview.emptyTab')} />
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16 text-right">{t('clients:import.preview.line')}</TableHead>
            <TableHead>{t('clients:import.preview.company')}</TableHead>
            <TableHead priority="md">{t('clients:import.preview.note')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={row.line}>
              <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(row.line)}</TableCell>
              <TableCell className="tbl-fill">
                <span className="block max-w-full truncate font-medium">{row.name}</span>
                <TableDetails items={[rowNote(row)]} />
              </TableCell>
              <TableCell priority="md">{rowNote(row)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination page={page} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(0) }} />
    </>
  )
}

interface PreviewStepProps {
  preview: ImportPreview
  assignees: ProspectAssignee[]
  onBack: () => void
  onCommit: (distribution: Distribution) => void
}

export function PreviewStep({ preview, assignees, onBack, onCommit }: PreviewStepProps) {
  const { can } = useMe()
  const canAssign = can('clienti.repartizare')
  const [tab, setTab] = useState<ImportAction>(preview.counts.new > 0 ? 'new' : preview.counts.update > 0 ? 'update' : 'error')
  const [mode, setMode] = useState<DistributionMode>('me')
  const [userId, setUserId] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  const byAction = useMemo(() => {
    const groups: Record<ImportAction, PreviewRow[]> = { new: [], update: [], error: [], skip: [] }
    for (const row of preview.rows) groups[row.action].push(row)
    return groups
  }, [preview.rows])

  const writes = preview.counts.new + preview.counts.update
  const distribution: Distribution | null =
    mode === 'me' ? { mode } : mode === 'user' ? (userId ? { mode, userIds: [userId] } : null) : picked.length > 0 ? { mode, userIds: picked } : null
  const assigneeName = (a: ProspectAssignee) => a.displayName ?? a.email

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium tabular-nums" aria-live="polite">
            {t('clients:import.preview.summary', { created: formatNumber(preview.counts.new), updated: formatNumber(preview.counts.update), errors: formatNumber(preview.counts.error) })}
          </p>
          {preview.counts.skip > 0 ? <p className="text-sm text-muted-foreground">{t('clients:import.preview.skipped', { count: preview.counts.skip })}</p> : null}
          <Tabs value={tab} onValueChange={(next) => setTab(next as ImportAction)}>
            <TabsList variant="segmented">
              {TABS.filter((key) => key !== 'skip' || preview.counts.skip > 0).map((key) => (
                <TabsTrigger key={key} value={key}>
                  {t(TAB_TEXTS[key])} · {formatNumber(preview.counts[key])}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {/* Keyed by tab so each one starts on its first page. */}
          <PreviewTable key={tab} rows={byAction[tab]} />
        </CardContent>
      </Card>

      {preview.counts.new > 0 ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-sm font-semibold">{t('clients:import.assign.title')}</h2>
            {canAssign ? (
              <>
                <Field label={t('clients:import.assign.mode')}>
                  <Select
                    value={mode}
                    onValueChange={(next) => setMode(next as DistributionMode)}
                    options={[
                      { value: 'me', label: t('clients:import.assign.me') },
                      { value: 'user', label: t('clients:import.assign.user') },
                      { value: 'round_robin', label: t('clients:import.assign.roundRobin') },
                    ]}
                  />
                </Field>
                {mode === 'user' ? (
                  <Field label={t('clients:import.assign.person')}>
                    <Select value={userId} onValueChange={setUserId} options={[{ value: '', label: t('clients:import.assign.choose') }, ...assignees.map((a) => ({ value: a.id, label: assigneeName(a) }))]} />
                  </Field>
                ) : null}
                {mode === 'round_robin' ? (
                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-sm font-medium">{t('clients:import.assign.people')}</legend>
                    {assignees.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={picked.includes(a.id)} onChange={(e) => setPicked((current) => (e.target.checked ? [...current, a.id] : current.filter((id) => id !== a.id)))} /> {assigneeName(a)}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('clients:import.assign.onlyMe')}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {writes === 0 ? <Alert tone="warning">{t('clients:import.preview.nothingToImport')}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('clients:import.preview.otherFile')}
        </Button>
        <Button type="button" disabled={writes === 0 || (preview.counts.new > 0 && !distribution)} onClick={() => onCommit(distribution ?? { mode: 'me' })}>
          {t('clients:import.preview.start', { count: writes })}
        </Button>
      </div>
    </div>
  )
}
