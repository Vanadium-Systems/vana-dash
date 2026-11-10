import { ArrowLeft, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { useAssignees, useStatuses } from '../prospects/use-prospect-data'
import type { MergeField, MergeFieldRow, MergeMoves, Side } from './types'
import { useMerge, useMergePreview, useDuplicates } from './use-health'

const FIELD_TEXTS: Record<MergeField, TKey> = {
  name: 'clients:health.merge.fields.name',
  cif: 'clients:health.merge.fields.cif',
  website: 'clients:health.merge.fields.website',
  caenCode: 'clients:health.merge.fields.caenCode',
  foundingYear: 'clients:health.merge.fields.foundingYear',
  employeeCount: 'clients:health.merge.fields.employeeCount',
  revenue: 'clients:health.merge.fields.revenue',
  profit: 'clients:health.merge.fields.profit',
  debt: 'clients:health.merge.fields.debt',
  equity: 'clients:health.merge.fields.equity',
  cash: 'clients:health.merge.fields.cash',
  receivables: 'clients:health.merge.fields.receivables',
  inventory: 'clients:health.merge.fields.inventory',
  valueAmount: 'clients:health.merge.fields.valueAmount',
  valueCurrency: 'clients:health.merge.fields.valueCurrency',
  expectedCloseAt: 'clients:health.merge.fields.expectedCloseAt',
  source: 'clients:health.merge.fields.source',
  isActive: 'clients:health.merge.fields.isActive',
  status: 'clients:health.merge.fields.status',
  assignedUserId: 'clients:health.merge.fields.assignedUserId',
}

const NUMERIC: ReadonlySet<MergeField> = new Set(['revenue', 'profit', 'debt', 'equity', 'cash', 'receivables', 'inventory', 'valueAmount', 'foundingYear', 'employeeCount'])

const MOVE_TEXTS: Record<keyof MergeMoves, TKey> = {
  people: 'clients:health.merge.moves.people',
  contactPoints: 'clients:health.merge.moves.contactPoints',
  notes: 'clients:health.merge.moves.notes',
  tasks: 'clients:health.merge.moves.tasks',
  listMemberships: 'clients:health.merge.moves.listMemberships',
  enrollments: 'clients:health.merge.moves.enrollments',
  stageEvents: 'clients:health.merge.moves.stageEvents',
  collaborators: 'clients:health.merge.moves.collaborators',
  calls: 'clients:health.merge.moves.calls',
}

function Choice({ name, label, value, checked, onSelect }: { name: string; label: string; value: string; checked: boolean; onSelect: () => void }) {
  return (
    <label className={cn('flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', checked ? 'border-primary bg-accent' : 'hover:bg-accent/50')}>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="radio" name={name} checked={checked} onChange={onSelect} className="accent-primary" />
        <span className="truncate">{label}</span>
      </span>
      <span className="break-words">{value}</span>
    </label>
  )
}

export function MergeView({ masterId, otherId, onSwap, onClose }: { masterId: string; otherId: string; onSwap: () => void; onClose: () => void }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const preview = useMergePreview(masterId, otherId)
  const merge = useMerge()
  const statuses = useStatuses().data ?? []
  const assignees = useAssignees().data ?? []
  // A name that is the same on both sides is not in the preview's differing fields, so the pair list is the fallback.
  const pairs = useDuplicates(0, 100)
  const names = useMemo(() => {
    const parts = pairs.data?.items.flatMap((pair) => [pair.a, pair.b]) ?? []
    return (id: string) => parts.find((part) => part.id === id)?.name ?? null
  }, [pairs.data])
  const nameRow = preview.data?.fields.find((row) => row.field === 'name')
  const masterName = (typeof nameRow?.master === 'string' ? nameRow.master : null) ?? names(masterId) ?? t('clients:health.merge.master')
  const otherName = (typeof nameRow?.other === 'string' ? nameRow.other : null) ?? names(otherId) ?? t('clients:health.merge.other')

  const [choices, setChoices] = useState<Partial<Record<MergeField, Side>>>({})
  useEffect(() => {
    if (preview.data) setChoices(Object.fromEntries(preview.data.fields.map((row) => [row.field, row.proposed])))
  }, [preview.data])

  const show = (row: MergeFieldRow, side: Side): string => {
    const value = row[side]
    if (value === null || value === '') return t('clients:health.merge.empty')
    if (row.field === 'isActive') return value === true || value === 'true' ? t('common:actions.yes') : t('common:actions.no')
    if (row.field === 'status') return statuses.find((s) => s.key === value)?.label ?? String(value)
    if (row.field === 'assignedUserId') {
      const person = assignees.find((a) => a.id === value)
      return person ? (person.displayName ?? person.email) : String(value)
    }
    if (row.field === 'expectedCloseAt') return formatDate(String(value))
    if (NUMERIC.has(row.field) && Number.isFinite(Number(value))) return formatNumber(Number(value))
    return String(value)
  }

  const submit = async () => {
    const ok = await confirm({
      title: t('clients:health.merge.confirmTitle', { name: masterName }),
      consequence: t('clients:health.merge.confirmBody', { other: otherName }),
      confirmLabel: t('clients:health.merge.confirm', { name: masterName }),
      destructive: true,
    })
    if (!ok) return
    merge.mutate(
      { masterId, otherId, fields: choices },
      {
        onSuccess: () => {
          toast.success(t('clients:health.merge.done', { name: masterName }))
          navigate(`/clients/${masterId}`)
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const moves = preview.data ? (Object.keys(MOVE_TEXTS) as Array<keyof MergeMoves>).filter((key) => preview.data.moves[key] > 0) : []

  return (
    <div data-density="comfortable" className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('clients:health.merge.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('clients:health.merge.description')}</p>
        </div>
        <Button type="button" variant="outline" onClick={onClose}>
          <ArrowLeft aria-hidden="true" /> {t('common:actions.back')}
        </Button>
      </div>
      {preview.isPending ? <ListSkeleton /> : null}
      {preview.isError ? <EmptyState kind="filtered" title={preview.error.message} onReset={onClose} /> : null}
      {preview.data ? (
        <>
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">{t('clients:health.merge.survivor', { name: masterName })}</p>
                <Button type="button" variant="outline" size="sm" onClick={onSwap}>
                  <ArrowLeftRight aria-hidden="true" />
                  {t('clients:health.merge.swap')}
                </Button>
              </div>
              {preview.data.fields.length === 0 ? <Alert>{t('clients:health.merge.identical')}</Alert> : null}
              {preview.data.fields.map((row) => (
                <fieldset key={row.field} className="space-y-1.5">
                  <legend className="mb-1.5 text-sm font-medium">{t(FIELD_TEXTS[row.field])}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Choice name={row.field} label={masterName} value={show(row, 'master')} checked={choices[row.field] === 'master'} onSelect={() => setChoices((c) => ({ ...c, [row.field]: 'master' }))} />
                    <Choice name={row.field} label={otherName} value={show(row, 'other')} checked={choices[row.field] === 'other'} onSelect={() => setChoices((c) => ({ ...c, [row.field]: 'other' }))} />
                  </div>
                </fieldset>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h2 className="text-sm font-semibold">{t('clients:health.merge.movesTitle', { name: masterName })}</h2>
              {moves.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('clients:health.merge.noMoves')}</p>
              ) : (
                <ul className="text-sm">
                  {moves.map((key) => (
                    <li key={key}>{t(MOVE_TEXTS[key], { count: preview.data.moves[key] })}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="button" disabled={merge.isPending} onClick={() => void submit()}>
              {merge.isPending ? t('common:states.saving') : t('clients:health.merge.confirm', { name: masterName })}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
