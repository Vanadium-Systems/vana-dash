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
import type { EmailIdentity, EmailSettings } from '@/shared/lib/types'
import { PasswordInput } from './PasswordInput'

// „Profilul meu" (fișa din PLAN.md): trei secțiuni pe o pagină, fără tab-uri — profil,
// parolă, notificări. Setările rămân ale firmei; aici stau doar ale omului. Cutiile lui de
// email sunt read-only: le dă adminul, nu și le schimbă singur (PLAN.md C2).

const CHAT_OPTIONS = [
  { value: 'all', label: 'Toate' },
  { value: 'dm', label: 'Doar directe' },
  { value: 'none', label: 'Niciunul' },
]

export function ProfilePage() {
  const { session, can } = useMe()
  const queryClient = useQueryClient()

  const [displayName, setDisplayName] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const identities = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
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
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Numele nu s-a salvat.'),
  })

  const changePassword = useMutation({
    mutationFn: () => api.post('/api/auth/me/password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      toast.success('Parola e schimbată. Celelalte dispozitive au fost delogate.')
    },
    onError: (error) => setPasswordError(error instanceof Error ? error.message : 'Parola nu s-a schimbat.'),
  })

  const savePrefs = useMutation({
    mutationFn: (patch: { chat?: 'all' | 'dm' | 'none'; emailNew?: boolean; alerts?: boolean }) => api.patch('/api/auth/me', { notificationPrefs: patch }),
    onSuccess: (data) => queryClient.setQueryData(['auth', 'me'], data),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Setarea nu s-a salvat.'),
  })

  const prefs = session?.notificationPrefs
  const myBoxes = (identities.data?.identities ?? [])
    .filter((identity) => session?.mailboxes === null || session?.mailboxes.includes(identity.key))
    .map((identity: EmailIdentity) => extractEmailAddress(identity.fromAddress))
    .filter(Boolean)

  return (
    <div className="space-y-6" data-density="comfortable">
      <PageHeader title="Profilul meu" description="Contul tău: nume, parolă, notificări." />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CardTitle className="text-base">Profil</CardTitle>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              saveProfile.mutate()
            }}
          >
            <Field label="Nume afișat" hint="Cum te vede restul echipei.">
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} />
            </Field>
            <Field label="Email" hint="Emailul îl schimbă adminul firmei.">
              <Input value={session?.user.email ?? ''} readOnly disabled />
            </Field>
            <p className="text-sm text-muted-foreground">
              Rol: {session?.user.role?.name ?? '—'}
              {session?.user.role?.kind !== 'admin' ? ' — îl schimbă adminul' : ''}
            </p>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saveProfile.isPending || displayName === (session?.user.displayName ?? '')}>
                {saveProfile.isPending ? 'Se salvează…' : 'Salvează'}
              </Button>
              {profileSaved ? <span className="text-sm text-muted-foreground">Salvat</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CardTitle className="text-base">Parolă</CardTitle>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setPasswordError(null)
              changePassword.mutate()
            }}
          >
            <Field label="Parola de acum">
              <PasswordInput autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            </Field>
            <Field label="Parolă nouă" hint="Minim 12 caractere. Te delogăm de pe celelalte dispozitive." error={passwordError}>
              <PasswordInput autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            </Field>
            <Button type="submit" disabled={changePassword.isPending || newPassword.length < 12}>
              Schimbă parola
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <CardTitle className="text-base">Notificări</CardTitle>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm">Mesaje</p>
              <p className="text-xs text-muted-foreground">Câte îți anunțăm, în Mesaje.</p>
            </div>
            <div className="w-44 shrink-0">
              <Select
                aria-label="Notificări pentru mesaje"
                value={prefs?.chat ?? 'all'}
                onValueChange={(value) => savePrefs.mutate({ chat: value as 'all' | 'dm' | 'none' })}
                options={CHAT_OPTIONS}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm">Email nou pe cutiile mele</p>
              <p className="text-xs text-muted-foreground">
                {myBoxes.length > 0 ? `Cutii: ${myBoxes.join(', ')}` : 'Nu ai cutii atribuite încă.'}
              </p>
            </div>
            <Switch
              checked={prefs?.emailNew ?? true}
              label="Email nou pe cutiile mele"
              onCheckedChange={(checked) => savePrefs.mutate({ emailNew: checked })}
            />
          </div>

          {can('alerte.view') ? (
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm">Alerte</p>
                <p className="text-xs text-muted-foreground">Când se declanșează o regulă pe care o urmărești.</p>
              </div>
              <Switch
                checked={prefs?.alerts ?? true}
                label="Notificări de alertă"
                onCheckedChange={(checked) => savePrefs.mutate({ alerts: checked })}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isPushSupported() ? <PushSubscriptionCard /> : null}
      {isPushSupported() ? <PushPreferencesCard /> : null}

      {/* Nav-ul e al omului, nu al firmei: îl aranjai de pe contul tău, nu din Setări. */}
      <NavSettingsCard />
    </div>
  )
}
