import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '@/shared/components/AuthLayout'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import { api, ApiError } from '@/shared/lib/api'
import type { SessionPayload } from '@/shared/lib/types'
import { PasswordInput } from './PasswordInput'
import { ExpiredLink } from './ResetPasswordPage'
import { t } from '@/shared/lib/i18n'

// Acceptarea invitației: omul a primit un link, pune o parolă și intră direct în cont —
// sesiunea se setează pe loc, deci nu mai scrie parola a doua oară.

export function AcceptInvitePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)

  const accept = useMutation({
    mutationFn: () => api.post<SessionPayload>('/api/auth/accept-invite', { token, password }),
    onSuccess: (session) => {
      queryClient.setQueryData(ME_QUERY_KEY, session)
      navigate('/', { replace: true })
    },
    onError: (err) => setError(err.message),
  })

  const errorCode = accept.isError && accept.error instanceof ApiError ? accept.error.code : undefined
  if (errorCode === 'INVITE_USED') return <InviteUsed />
  if (token.length < 20 || errorCode === 'INVITE_EXPIRED') {
    // Fără sesiune nu putem afla numele adminului, deci ieșirea e către resetare — un om cu
    // parolă veche își face cont propriu, un om nou cere altă invitație.
    return <ExpiredLink to="/forgot-password" cta={t('auth:invite.haveAccount')} />
  }

  return (
    <AuthLayout title={t('auth:brand.title')} subline={t('auth:brand.subline')}>
      <h1 className="text-xl font-semibold">{t('auth:invite.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('auth:invite.hint')}</p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          setError(password !== repeat ? t('auth:password.mismatch') : null)
          if (password !== repeat) return
          accept.mutate()
        }}
      >
        <Field label={t('common:labels.password')}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
        </Field>
        <Field label={t('auth:password.again')} error={error}>
          <PasswordInput autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" disabled={accept.isPending || password.length < 12}>
          {accept.isPending ? t('common:states.connecting') : t('auth:invite.submit')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {t('auth:invite.alreadyAccepted')}
        </Link>
      </p>
    </AuthLayout>
  )
}

// Cel mai des: omul și-a pus parola, apoi a redeschis linkul din email ca să intre. Găsit
// live 2026-10-02 — fără ieșire spre login, a retrimis formularul de patru ori.
function InviteUsed() {
  return (
    <AuthLayout title={t('auth:brand.title')} subline={t('auth:brand.subline')}>
      <h1 className="text-xl font-semibold">{t('auth:invite.usedTitle')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('auth:invite.usedBody')}
      </p>
      <Button asChild className="mt-6 w-full">
        <Link to="/login">{t('auth:login.title')}</Link>
      </Button>
      <p className="mt-6 text-center text-sm">
        <Link to="/forgot-password" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {t('auth:login.forgotShort')}
        </Link>
      </p>
    </AuthLayout>
  )
}
