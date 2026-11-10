import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import { t } from '@/shared/lib/i18n'
import { useReleaseSettings, useSaveReleaseSettings } from './use-clients-settings'

const digits = (value: string) => value.replace(/\D/g, '')

export function ReleaseSection({ canEdit }: { canEdit: boolean }) {
  const settings = useReleaseSettings()
  const save = useSaveReleaseSettings()
  const [enabled, setEnabled] = useState(false)
  const [idleDays, setIdleDays] = useState('')
  const [warnDays, setWarnDays] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings.data) return
    setEnabled(settings.data.enabled)
    setIdleDays(String(settings.data.idleDays))
    setWarnDays(String(settings.data.warnDays))
  }, [settings.data])

  const submit = () => {
    const idle = Number(idleDays)
    const warn = Number(warnDays)
    if (!Number.isInteger(idle) || idle < 1 || idle > 365) return setError(t('clients:settings.release.idleInvalid'))
    if (!Number.isInteger(warn) || warn < 0 || warn >= idle) return setError(t('clients:settings.release.warnInvalid'))
    setError(null)
    save.mutate({ enabled, idleDays: idle, warnDays: warn }, { onSuccess: () => toast.success(t('common:states.saved')), onError: (err) => toast.error(err.message) })
  }

  if (settings.isPending) return <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
  if (settings.isError) return <p className="text-sm text-destructive-text">{t('common:states.loadFailed')}</p>

  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <p className="text-sm text-muted-foreground">{t('clients:settings.release.hint')}</p>
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        {t('clients:settings.release.enabled')}
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} label={t('clients:settings.release.enabled')} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('clients:settings.release.idleDays')} error={error && !idleDays ? error : null}>
          <Input inputMode="numeric" value={idleDays} disabled={!canEdit || !enabled} onChange={(e) => setIdleDays(digits(e.target.value))} />
        </Field>
        <Field label={t('clients:settings.release.warnDays')} hint={t('clients:settings.release.warnHint')} error={error}>
          <Input inputMode="numeric" value={warnDays} disabled={!canEdit || !enabled} onChange={(e) => setWarnDays(digits(e.target.value))} />
        </Field>
      </div>
      {canEdit ? (
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('common:states.saving') : t('common:actions.save')}
        </Button>
      ) : null}
    </form>
  )
}
