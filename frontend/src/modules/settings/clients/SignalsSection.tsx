import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { ClauseEditor } from './ClauseEditor'
import { SIGNAL_GROUPS, type Signal, type SignalGroup, type SignalInput } from './types'
import { useClauseFields } from './use-clause-fields'
import { useSignalActions, useSignals } from './use-clients-settings'

const GROUP_TEXTS: Record<SignalGroup, TKey> = {
  company: 'clients:settings.signals.groups.company',
  activity: 'clients:settings.signals.groups.activity',
  contact: 'clients:settings.signals.groups.contact',
}

const EMPTY: SignalInput = { name: '', groupKey: 'company', description: null, talkingTip: null, filters: [], enabled: true }

function SignalDialog({ signal, open, onOpenChange }: { signal: Signal | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const actions = useSignalActions()
  const fields = useClauseFields()
  const [form, setForm] = useState<SignalInput>(EMPTY)
  const [seed, setSeed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Each opening starts from the signal being edited (or an empty one), not from the last draft.
  const seedKey = open ? (signal?.id ?? 'new') : null
  if (seedKey !== seed) {
    setSeed(seedKey)
    setError(null)
    if (seedKey) setForm(signal ? { name: signal.name, groupKey: signal.groupKey, description: signal.description, talkingTip: signal.talkingTip, filters: signal.filters, enabled: signal.enabled } : EMPTY)
  }

  // A built-in signal keeps its filters (some are evaluated in code): only the texts and the switch change.
  const builtin = Boolean(signal?.builtinKey)
  const pending = actions.create.isPending || actions.update.isPending
  const set = <K extends keyof SignalInput>(key: K, value: SignalInput[K]) => setForm((current) => ({ ...current, [key]: value }))

  const submit = () => {
    if (!form.name.trim()) return setError(t('clients:settings.signals.nameRequired'))
    if (!builtin && form.filters.length === 0) return setError(t('clients:settings.signals.filtersRequired'))
    const body = { ...form, name: form.name.trim(), description: form.description?.trim() || null, talkingTip: form.talkingTip?.trim() || null }
    const done = { onSuccess: () => onOpenChange(false), onError: (err: Error) => toast.error(err.message) }
    if (signal) {
      const { filters, groupKey, ...texts } = body
      actions.update.mutate({ id: signal.id, ...(builtin ? texts : { ...texts, filters, groupKey }) }, done)
    } else actions.create.mutate(body, done)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <DialogTitle>{signal ? t('clients:settings.signals.editTitle') : t('clients:settings.signals.newTitle')}</DialogTitle>
          <DialogDescription>{t('clients:settings.signals.dialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t('clients:settings.signals.name')} error={error && !form.name.trim() ? error : null}>
            <Input value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
          </Field>
          {builtin ? null : (
            <>
              <Field label={t('clients:settings.signals.group')}>
                <Select value={form.groupKey} onValueChange={(value) => set('groupKey', value as SignalGroup)} options={SIGNAL_GROUPS.map((group) => ({ value: group, label: t(GROUP_TEXTS[group]) }))} />
              </Field>
              <Field label={t('clients:settings.signals.filters')} error={error && form.name.trim() ? error : null} hint={t('clients:settings.signals.filtersHint')}>
                <div>
                  <ClauseEditor fields={fields} value={form.filters} onChange={(filters) => set('filters', filters)} />
                </div>
              </Field>
            </>
          )}
          <Field label={t('clients:settings.signals.description')} optional>
            <Textarea rows={2} maxLength={500} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label={t('clients:settings.signals.tip')} optional hint={t('clients:settings.signals.tipHint', { vars: '{{firma}}, {{caen}}, {{crestere_ca}}' })}>
            <Textarea rows={3} maxLength={1000} value={form.talkingTip ?? ''} onChange={(e) => set('talkingTip', e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function usedIn(signal: Signal): string {
  const parts = [signal.usedIn.score ? t('clients:settings.signals.usedScore') : null, signal.usedIn.views > 0 ? t('clients:settings.signals.usedViews', { count: signal.usedIn.views }) : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : t('clients:settings.signals.usedNowhere')
}

export function SignalsSection({ canEdit }: { canEdit: boolean }) {
  const signals = useSignals()
  const actions = useSignalActions()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<{ signal: Signal | null } | null>(null)

  if (signals.isPending) return <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
  if (signals.isError) return <p className="text-sm text-destructive-text">{t('common:states.loadFailed')}</p>

  const remove = (signal: Signal) =>
    void confirm({ title: t('clients:settings.signals.deleteTitle', { name: signal.name }), consequence: t('clients:settings.signals.deleteBody'), confirmLabel: t('common:actions.delete'), destructive: true }).then(
      (ok) => ok && actions.remove.mutate(signal.id, { onError: (err) => toast.error(err.message) }),
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-muted-foreground">{t('clients:settings.signals.hint')}</p>
        {canEdit ? (
          <Button type="button" onClick={() => setDialog({ signal: null })}>
            <Plus aria-hidden="true" /> {t('clients:settings.signals.add')}
          </Button>
        ) : null}
      </div>
      {signals.data.map((group) =>
        group.signals.length === 0 ? null : (
          <section key={group.groupKey} className="space-y-1">
            <h3 className="text-sm font-semibold">{t(GROUP_TEXTS[group.groupKey])}</h3>
            <ul className="divide-y">
              {group.signals.map((signal) => (
                <li key={signal.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {signal.name}
                      {signal.builtinKey ? <Badge variant="secondary">{t('clients:settings.signals.builtin')}</Badge> : null}
                    </p>
                    {signal.description ? <p className="text-sm text-muted-foreground">{signal.description}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {t('clients:settings.signals.hits', { n: formatNumber(signal.hitCount) })} · {usedIn(signal)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={signal.enabled}
                      disabled={!canEdit || actions.update.isPending}
                      label={signal.name}
                      onCheckedChange={(enabled) => actions.update.mutate({ id: signal.id, enabled }, { onError: (err) => toast.error(err.message) })}
                    />
                    {canEdit ? (
                      <>
                        <Button type="button" variant="ghost" size="icon" aria-label={t('common:actions.edit')} onClick={() => setDialog({ signal })}>
                          <Pencil aria-hidden="true" />
                        </Button>
                        {signal.builtinKey ? null : (
                          <Button type="button" variant="ghost" size="icon" aria-label={t('common:actions.delete')} onClick={() => remove(signal)}>
                            <Trash2 aria-hidden="true" />
                          </Button>
                        )}
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      <SignalDialog signal={dialog?.signal ?? null} open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)} />
    </div>
  )
}
