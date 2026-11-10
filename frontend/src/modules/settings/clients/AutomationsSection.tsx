import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'
import { formatNumber, formatRelativeTime } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { useProspectLists, useStatuses } from '@/modules/clients/prospects/use-prospect-data'
import type { AutomationRule, RuleKey } from './types'
import { useAutomations, useSaveAutomation } from './use-clients-settings'

const digits = (value: string) => value.replace(/\D/g, '')

const SENTENCES: Record<RuleKey, TKey> = {
  reply_call_task: 'clients:settings.automations.rules.reply_call_task',
  bounce_notify: 'clients:settings.automations.rules.bounce_notify',
  no_next_step: 'clients:settings.automations.rules.no_next_step',
  meeting_stage: 'clients:settings.automations.rules.meeting_stage',
  won_cleanup: 'clients:settings.automations.rules.won_cleanup',
  import_list: 'clients:settings.automations.rules.import_list',
}

function Params({ rule, draft, onChange, disabled }: { rule: RuleKey; draft: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; disabled: boolean }) {
  const statuses = useStatuses()
  const lists = useProspectLists(rule === 'import_list')
  const set = (key: string, value: unknown) => onChange({ ...draft, [key]: value })
  const num = (key: string) => String(draft[key] ?? '')

  if (rule === 'reply_call_task')
    return (
      <label className="flex items-center gap-2 text-sm">
        {t('clients:settings.automations.hour')}
        <Input className="w-20" inputMode="numeric" value={num('hour')} disabled={disabled} onChange={(e) => set('hour', Number(digits(e.target.value)))} />
      </label>
    )
  if (rule === 'no_next_step')
    return (
      <label className="flex items-center gap-2 text-sm">
        {t('clients:settings.automations.days')}
        <Input className="w-20" inputMode="numeric" value={num('days')} disabled={disabled} onChange={(e) => set('days', Number(digits(e.target.value)))} />
      </label>
    )
  if (rule === 'meeting_stage')
    return (
      <label className="flex flex-wrap items-center gap-2 text-sm">
        {t('clients:settings.automations.stage')}
        <Select
          className="w-48"
          value={String(draft.status ?? '')}
          disabled={disabled}
          onValueChange={(value) => set('status', value || null)}
          options={[{ value: '', label: t('clients:settings.automations.noStage') }, ...(statuses.data ?? []).map((s) => ({ value: s.key, label: s.label }))]}
        />
      </label>
    )
  if (rule === 'import_list')
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t('clients:settings.automations.list')}
          <Select
            className="w-48"
            value={String(draft.listId ?? '')}
            disabled={disabled}
            onValueChange={(value) => set('listId', value || null)}
            options={[{ value: '', label: t('clients:settings.automations.noList') }, ...(lists.data ?? []).map((list) => ({ value: list.id, label: list.name }))]}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t('clients:settings.automations.minScore')}
          <Input className="w-20" inputMode="numeric" value={num('minScore')} disabled={disabled} onChange={(e) => set('minScore', Number(digits(e.target.value)))} />
        </label>
      </div>
    )
  return null
}

function RuleRow({ rule, canEdit }: { rule: AutomationRule; canEdit: boolean }) {
  const save = useSaveAutomation()
  const [draft, setDraft] = useState(rule.params)
  useEffect(() => setDraft(rule.params), [rule.params])
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule.params)
  const hasParams = Object.keys(rule.params).length > 0

  const submit = (enabled: boolean) =>
    save.mutate({ ruleKey: rule.ruleKey, enabled, params: draft }, { onSuccess: () => toast.success(t('common:states.saved')), onError: (err) => toast.error(err.message) })

  return (
    <li className="space-y-2 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">{t(SENTENCES[rule.ruleKey])}</p>
        <Switch checked={rule.enabled} onCheckedChange={submit} disabled={!canEdit || save.isPending || dirty} label={t(SENTENCES[rule.ruleKey])} />
      </div>
      {hasParams ? (
        <div className="flex flex-wrap items-center gap-3">
          <Params rule={rule.ruleKey} draft={draft} onChange={setDraft} disabled={!canEdit} />
          {canEdit && dirty ? (
            <Button type="button" size="sm" disabled={save.isPending} onClick={() => submit(rule.enabled)}>
              {t('common:actions.save')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {rule.lastRunAt ? t('clients:settings.automations.lastRun', { when: formatRelativeTime(rule.lastRunAt), count: formatNumber(rule.lastRunCount ?? 0) }) : t('clients:settings.automations.neverRun')}
      </p>
    </li>
  )
}

export function AutomationsSection({ canEdit }: { canEdit: boolean }) {
  const rules = useAutomations()
  if (rules.isPending) return <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
  if (rules.isError) return <p className="text-sm text-destructive-text">{t('common:states.loadFailed')}</p>
  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted-foreground">{t('clients:settings.automations.hint')}</p>
      <ul className="divide-y">
        {rules.data.map((rule) => (
          <RuleRow key={rule.ruleKey} rule={rule} canEdit={canEdit} />
        ))}
      </ul>
    </div>
  )
}
