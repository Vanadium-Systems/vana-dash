import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import type { FilterField } from '@/shared/lib/filters'
import { ClauseEditor } from './ClauseEditor'
import type { ScoreCriterion, ScoreLabelKey, ScoreLabels } from './types'
import { useClauseFields } from './use-clause-fields'
import { useScoringConfig, useScoringPreview, useSaveScoring, useSignals, type ScoreDraft } from './use-clients-settings'

const IMPACTS: Array<{ points: number; label: TKey }> = [
  { points: 20, label: 'clients:settings.score.impact.high' },
  { points: 10, label: 'clients:settings.score.impact.medium' },
  { points: 5, label: 'clients:settings.score.impact.low' },
  { points: 0, label: 'clients:settings.score.impact.none' },
]

const LABEL_TEXTS: Record<ScoreLabelKey, TKey> = {
  excellent: 'clients:settings.score.labels.excellent',
  good: 'clients:settings.score.labels.good',
  fit: 'clients:settings.score.labels.fit',
  unfit: 'clients:settings.score.labels.unfit',
}

const digits = (value: string) => value.replace(/\D/g, '')

function Distribution({ draft }: { draft: ScoreDraft | null }) {
  const preview = useScoringPreview(draft)
  const total = preview.data?.total ?? 0
  return (
    <aside className="space-y-3 rounded-lg border p-4" aria-live="polite">
      <h3 className="text-sm font-semibold">{t('clients:settings.score.distribution')}</h3>
      {preview.isError ? <p className="text-sm text-muted-foreground">{t('clients:settings.score.previewFailed')}</p> : null}
      {!preview.data && preview.isPending && draft ? <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p> : null}
      {!draft ? <p className="text-sm text-muted-foreground">{t('clients:settings.score.incomplete')}</p> : null}
      {preview.data ? (
        <ul className="space-y-3">
          {preview.data.distribution.map((row) => (
            <li key={row.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>{t(LABEL_TEXTS[row.label])}</span>
                <span className="tabular-nums">{formatNumber(row.count)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${total ? (row.count / total) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {preview.data ? <p className="text-xs text-muted-foreground">{t('clients:settings.score.total', { n: formatNumber(total) })}</p> : null}
    </aside>
  )
}

function CriterionRow({ criterion, fields, canEdit, onChange, onRemove }: { criterion: ScoreCriterion; fields: FilterField[]; canEdit: boolean; onChange: (next: ScoreCriterion) => void; onRemove: () => void }) {
  const known = IMPACTS.some((impact) => impact.points === criterion.points)
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('clients:settings.score.criterionName')} className="min-w-0 flex-1 basis-48">
          <Input value={criterion.name} maxLength={120} disabled={!canEdit} onChange={(e) => onChange({ ...criterion, name: e.target.value })} />
        </Field>
        <Field label={t('clients:settings.score.impact.label')} className="w-48">
          <Select
            value={String(criterion.points)}
            disabled={!canEdit}
            onValueChange={(value) => onChange({ ...criterion, points: Number(value) })}
            options={[...IMPACTS.map((impact) => ({ value: String(impact.points), label: `${t(impact.label)} (${impact.points})` })), ...(known ? [] : [{ value: String(criterion.points), label: t('clients:settings.score.impact.custom', { points: criterion.points }) }])]}
          />
        </Field>
        {canEdit ? (
          <Button type="button" variant="ghost" size="icon" aria-label={t('clients:settings.score.removeCriterion')} onClick={onRemove}>
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <ClauseEditor fields={fields} value={criterion.filters} disabled={!canEdit} onChange={(filters) => onChange({ ...criterion, filters })} />
    </li>
  )
}

export function ScoreSection({ canEdit }: { canEdit: boolean }) {
  const config = useScoringConfig()
  const save = useSaveScoring()
  const signals = useSignals()
  const signalField = useMemo<FilterField[]>(
    () => [{ key: 'signal', label: t('clients:settings.score.signalField'), type: 'enum', group: t('clients:settings.score.signalGroup'), options: (signals.data ?? []).flatMap((group) => group.signals.map((s) => ({ value: s.id, label: s.name }))) }],
    [signals.data],
  )
  const fields = useClauseFields(signalField)

  const [baseWeight, setBaseWeight] = useState(1)
  const [criteria, setCriteria] = useState<ScoreCriterion[]>([])
  const [labels, setLabels] = useState<Record<keyof ScoreLabels, string>>({ excellent: '', good: '', fit: '' })

  useEffect(() => {
    const data = config.data
    if (!data) return
    setBaseWeight(Number(data.baseWeight))
    setCriteria(data.criteria)
    const l = data.labels ?? { excellent: Number(data.hotThreshold), good: Number(data.warmThreshold), fit: Number(data.nurtureThreshold) }
    setLabels({ excellent: String(l.excellent), good: String(l.good), fit: String(l.fit) })
  }, [config.data])

  const numericLabels = { excellent: Number(labels.excellent), good: Number(labels.good), fit: Number(labels.fit) }
  const labelsValid = Object.values(numericLabels).every((n) => Number.isFinite(n) && n >= 0 && n <= 100) && numericLabels.excellent >= numericLabels.good && numericLabels.good >= numericLabels.fit
  const complete = criteria.every((c) => c.name.trim() && c.filters.length > 0)
  // A criterion still being written would be refused by the server; the preview skips it, saving waits for it.
  const draft: ScoreDraft | null = labelsValid ? { baseWeight, criteria: criteria.filter((c) => c.name.trim() && c.filters.length > 0), labels: numericLabels } : null
  // Compared by value: a new object on every render would restart the wait forever.
  const settledKey = useDebounced(JSON.stringify(draft), 500)
  const settled = useMemo(() => JSON.parse(settledKey) as ScoreDraft | null, [settledKey])

  const submit = () => {
    if (!config.data || !draft || !complete) return
    save.mutate(
      { config: config.data, draft },
      { onSuccess: (done) => toast.success(t('pricing:scoring.saved', { count: done.recalculated })), onError: (err) => toast.error(err.message) },
    )
  }

  if (config.isPending) return <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
  if (config.isError) return <p className="text-sm text-destructive-text">{t('common:states.loadFailed')}</p>

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('clients:settings.score.base')}</h3>
          <p className="text-sm text-muted-foreground">{t('clients:settings.score.baseHint')}</p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={baseWeight}
              disabled={!canEdit}
              aria-label={t('clients:settings.score.base')}
              onChange={(e) => setBaseWeight(Number(e.target.value))}
              className="w-full max-w-xs accent-primary"
            />
            <span className="w-12 text-sm tabular-nums">{formatNumber(Math.round(baseWeight * 100), '%')}</span>
          </div>
        </section>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">{t('clients:settings.score.criteria')}</h3>
          {criteria.length === 0 ? <p className="text-sm text-muted-foreground">{t('clients:settings.score.noCriteria')}</p> : null}
          <ul className="divide-y">
            {criteria.map((criterion) => (
              <CriterionRow
                key={criterion.id}
                criterion={criterion}
                fields={fields}
                canEdit={canEdit}
                onChange={(next) => setCriteria((current) => current.map((c) => (c.id === next.id ? next : c)))}
                onRemove={() => setCriteria((current) => current.filter((c) => c.id !== criterion.id))}
              />
            ))}
          </ul>
          {canEdit && criteria.length < 30 ? (
            <Button type="button" variant="outline" onClick={() => setCriteria((current) => [...current, { id: crypto.randomUUID(), name: '', filters: [], points: 10 }])}>
              <Plus aria-hidden="true" /> {t('clients:settings.score.addCriterion')}
            </Button>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('clients:settings.score.thresholds')}</h3>
          <p className="text-sm text-muted-foreground">{t('clients:settings.score.thresholdsHint')}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {(['excellent', 'good', 'fit'] as const).map((key) => (
              <Field key={key} label={t(LABEL_TEXTS[key])} error={!labelsValid && key === 'fit' ? t('clients:settings.score.thresholdsInvalid') : null}>
                <Input inputMode="numeric" value={labels[key]} disabled={!canEdit} onChange={(e) => setLabels((current) => ({ ...current, [key]: digits(e.target.value) }))} />
              </Field>
            ))}
          </div>
        </section>

        {canEdit ? (
          <Button type="button" disabled={save.isPending || !draft || !complete} onClick={submit}>
            {save.isPending ? t('common:states.saving') : t('pricing:scoring.save')}
          </Button>
        ) : null}
      </div>
      <Distribution draft={settled} />
    </div>
  )
}
