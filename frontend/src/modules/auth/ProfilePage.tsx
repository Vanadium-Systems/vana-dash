import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { isPushSupported } from '@/shared/lib/push-client'
import { extractEmailAddress } from '@/modules/email/identity'
import { NavSettingsCard } from '@/modules/settings/NavSettingsCard'
import { PushPreferencesCard, PushSubscriptionCard } from '@/modules/settings/PushCards'
import type { EmailIdentity, EmailSenderOptions, SessionPayload } from '@/shared/lib/types'
import { ApiTokensCard } from './ApiTokensCard'
import { DevicesCard } from './DevicesCard'
import { PasswordInput } from './PasswordInput'
import { changeLocale, t } from '@/shared/lib/i18n'
import { applyMotionPref, type MotionPref } from '@/shared/lib/motion'
import { applyPalette, PALETTE_SWATCHES, THEME_PALETTES, type ThemePalette } from '@/shared/lib/palette'
import { cn } from '@/shared/lib/utils'
import { LOCALE_NAMES, type DisplayCurrency, type Locale } from '@/shared/lib/locale'

// „Profilul meu" (fișa din PLAN.md): trei secțiuni pe o pagină, fără tab-uri — profil,
// parolă, notificări. Setările rămân ale firmei; aici stau doar ale omului. Cutiile lui de
// email sunt read-only: le dă adminul, nu și le schimbă singur (PLAN.md C2).

const CHAT_OPTIONS = [
  { value: 'all', label: t('common:labels.all') },
  { value: 'dm', label: t('auth:profile.notifications.chatDirectOnly') },
  { value: 'none', label: t('common:states.none') },
]

const MOTION_PREFS: MotionPref[] = ['system', 'full', 'reduced', 'off']

export function ProfilePage() {
  const { session, can } = useMe()
  const queryClient = useQueryClient()

  const [displayName, setDisplayName] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // sender-options, not /api/email/settings: the latter needs `email.setari`, which a colleague
  // does not have, and it already returns only the person's own mailboxes.
  const identities = useQuery({
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
    enabled: can('email.view'),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    setDisplayName(session?.user.displayName ?? '')
  }, [session])

  const saveProfile = useMutation({
    mutationFn: () => api.patch('/api/auth/me', { displayName }),
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'me'], data)
      setProfileSaved(true)
      window.setTimeout(() => setProfileSaved(false), 2000)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('auth:profile.nameNotSaved')),
  })

  const changePassword = useMutation({
    mutationFn: () => api.post('/api/auth/me/password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      toast.success(t('auth:profile.passwordChanged'))
    },
    onError: (error) => setPasswordError(error instanceof Error ? error.message : t('auth:profile.passwordNotChanged')),
  })

  const savePrefs = useMutation({
    mutationFn: (patch: { chat?: 'all' | 'dm' | 'none'; emailNew?: boolean; alerts?: boolean }) => api.patch('/api/auth/me', { notificationPrefs: patch }),
    onSuccess: (data) => queryClient.setQueryData(['auth', 'me'], data),
    onError: (error) => toast.error(error instanceof Error ? error.message : t('auth:profile.settingNotSaved')),
  })

  const saveDisplayCurrency = useMutation({
    mutationFn: (displayCurrency: DisplayCurrency) => api.patch('/api/auth/me', { displayCurrency }),
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'me'], data)
      // Every total on screen was computed in the old currency.
      void queryClient.invalidateQueries()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('auth:profile.display.notSaved')),
  })

  const saveLocale = useMutation({
    mutationFn: (locale: Locale) => changeLocale(locale, () => api.patch('/api/auth/me', { locale })),
    onError: (error) => toast.error(error instanceof Error ? error.message : t('auth:profile.display.notSaved')),
  })

  const saveDisplayPrefs = useMutation({
    mutationFn: (patch: { motionPref?: MotionPref; themePalette?: ThemePalette; hideAmounts?: boolean; soundOn?: boolean }) =>
      api.patch<SessionPayload>('/api/auth/me', patch),
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'me'], data)
      applyMotionPref(data.motionPref ?? 'system')
      if (data.themePalette) applyPalette(data.themePalette)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('auth:profile.display.notSaved')),
  })

  const prefs = session?.notificationPrefs
  const myBoxes = (identities.data?.identities ?? [])
    .map((identity: EmailIdentity) => extractEmailAddress(identity.fromAddress))
    .filter(Boolean)

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title={t('common:nav.myProfile')} description={t('auth:profile.description')} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CardTitle className="text-base">{t('auth:profile.section')}</CardTitle>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              saveProfile.mutate()
            }}
          >
            <Field label={t('auth:profile.displayName')} hint={t('auth:profile.displayNameHint')}>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} />
            </Field>
            <Field label={t('common:labels.email')} hint={t('auth:profile.emailHint')}>
              <Input value={session?.user.email ?? ''} readOnly disabled />
            </Field>
            <p className="text-sm text-muted-foreground">
              {t('auth:profile.role')} {session?.user.role?.name ?? '—'}
              {session?.user.role?.kind !== 'admin' ? t('auth:profile.roleChangedByAdmin') : ''}
            </p>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saveProfile.isPending || displayName === (session?.user.displayName ?? '')}>
                {saveProfile.isPending ? t('common:states.saving') : t('common:actions.save')}
              </Button>
              {profileSaved ? <span className="text-sm text-muted-foreground">{t('common:states.saved')}</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CardTitle className="text-base">{t('auth:profile.display.title')}</CardTitle>
          {(session?.enabledLocales.length ?? 0) > 1 ? (
            <Field label={t('common:labels.language')} hint={t('auth:profile.display.languageHint')}>
              <Select
                value={session?.locale}
                disabled={saveLocale.isPending}
                onValueChange={(value) => saveLocale.mutate(value as Locale)}
                options={(session?.enabledLocales ?? []).map((locale) => ({ value: locale, label: LOCALE_NAMES[locale] }))}
              />
            </Field>
          ) : null}
          <Field label={t('common:labels.displayCurrency')} hint={t('auth:profile.display.currencyHint')}>
            <Select
              value={session?.displayCurrency}
              disabled={saveDisplayCurrency.isPending}
              onValueChange={(value) => saveDisplayCurrency.mutate(value as DisplayCurrency)}
              options={(session?.displayCurrencies ?? []).map((currency) => ({ value: currency, label: t(`common:currencies.${currency}`) }))}
            />
          </Field>
          <Field label={t('auth:profile.display.palette')} hint={t('auth:profile.display.paletteHint')}>
            <div role="radiogroup" aria-label={t('auth:profile.display.palette')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {THEME_PALETTES.map((palette) => {
                const selected = (session?.themePalette ?? 'vanadium') === palette
                const swatch = PALETTE_SWATCHES[palette]
                return (
                  <button
                    key={palette}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={saveDisplayPrefs.isPending}
                    onClick={() => saveDisplayPrefs.mutate({ themePalette: palette })}
                    className={cn(
                      'flex h-control-md items-center gap-2.5 rounded-md border px-3 text-left text-sm transition-colors duration-[var(--duration-fast)]',
                      selected
                        ? 'border-primary bg-accent font-medium text-foreground ring-1 ring-primary'
                        : 'border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground',
                    )}
                  >
                    <span className="flex shrink-0 items-center overflow-hidden rounded-sm border border-border-strong" aria-hidden="true">
                      <span className="h-4 w-3" style={{ backgroundColor: swatch.light.bg }} />
                      <span className="h-4 w-2.5" style={{ backgroundColor: swatch.light.primary }} />
                      <span className="h-4 w-2" style={{ backgroundColor: swatch.light.glow }} />
                    </span>
                    <span className="truncate">{t(`auth:profile.display.paletteOptions.${palette}`)}</span>
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label={t('auth:profile.display.motion')} hint={t('auth:profile.display.motionHint')}>
            <div role="radiogroup" aria-label={t('auth:profile.display.motion')} className="inline-flex flex-wrap gap-1 rounded-md bg-muted p-1">
              {MOTION_PREFS.map((pref) => (
                // native: segmented control
                <button
                  key={pref}
                  type="button"
                  role="radio"
                  aria-checked={(session?.motionPref ?? 'system') === pref}
                  disabled={saveDisplayPrefs.isPending}
                  onClick={() => saveDisplayPrefs.mutate({ motionPref: pref })}
                  className={cn(
                    'h-control-md rounded-sm px-3 text-sm transition-colors duration-[var(--duration-fast)]',
                    (session?.motionPref ?? 'system') === pref ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`auth:profile.display.motionOptions.${pref}`)}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm">{t('auth:profile.display.hideAmounts')}</p>
              <p className="text-xs text-muted-foreground">{t('auth:profile.display.hideAmountsHint')}</p>
            </div>
            <Switch
              checked={session?.hideAmounts ?? false}
              label={t('auth:profile.display.hideAmounts')}
              onCheckedChange={(checked) => saveDisplayPrefs.mutate({ hideAmounts: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm">{t('auth:profile.display.sound')}</p>
              <p className="text-xs text-muted-foreground">{t('auth:profile.display.soundHint')}</p>
            </div>
            <Switch
              checked={session?.soundOn ?? false}
              label={t('auth:profile.display.sound')}
              onCheckedChange={(checked) => saveDisplayPrefs.mutate({ soundOn: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CardTitle className="text-base">{t('common:labels.password')}</CardTitle>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setPasswordError(null)
              changePassword.mutate()
            }}
          >
            <Field label={t('auth:profile.currentPassword')}>
              <PasswordInput autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            </Field>
            <Field label={t('common:labels.newPassword')} hint={t('auth:profile.newPasswordHint')} error={passwordError}>
              <PasswordInput autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            </Field>
            <Button type="submit" disabled={changePassword.isPending || newPassword.length < 12}>
              {t('auth:profile.changePassword')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CardTitle className="text-base">{t('auth:profile.notifications.title')}</CardTitle>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm">{t('common:nav.messages')}</p>
              <p className="text-xs text-muted-foreground">{t('auth:profile.notifications.chatHint')}</p>
            </div>
            <div className="w-44 shrink-0">
              <Select
                aria-label={t('auth:profile.notifications.chatAria')}
                value={prefs?.chat ?? 'all'}
                onValueChange={(value) => savePrefs.mutate({ chat: value as 'all' | 'dm' | 'none' })}
                options={CHAT_OPTIONS}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm">{t('auth:profile.notifications.newEmail')}</p>
              <p className="text-xs text-muted-foreground">
                {myBoxes.length > 0 ? `Cutii: ${myBoxes.join(', ')}` : t('auth:profile.notifications.noMailboxes')}
              </p>
            </div>
            <Switch
              checked={prefs?.emailNew ?? true}
              label={t('auth:profile.notifications.newEmail')}
              onCheckedChange={(checked) => savePrefs.mutate({ emailNew: checked })}
            />
          </div>

          {can('alerte.view') ? (
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm">{t('common:nav.alerts')}</p>
                <p className="text-xs text-muted-foreground">{t('auth:profile.notifications.alertsHint')}</p>
              </div>
              <Switch
                checked={prefs?.alerts ?? true}
                label={t('auth:profile.notifications.alertsAria')}
                onCheckedChange={(checked) => savePrefs.mutate({ alerts: checked })}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <DevicesCard />

      {can('echipa.tokenuri') ? <ApiTokensCard /> : null}

      {isPushSupported() ? <PushSubscriptionCard /> : null}
      {isPushSupported() ? <PushPreferencesCard /> : null}

      {/* Nav-ul e al omului, nu al firmei: îl aranjai de pe contul tău, nu din Setări. */}
      <NavSettingsCard />
    </div>
  )
}
