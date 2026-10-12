import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '@/shared/components/AuthLayout'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { api, ApiError } from '@/shared/lib/api'
import { PasswordInput } from './PasswordInput'
import { t } from '@/shared/lib/i18n'

// Alegerea parolei noi din linkul primit pe email. Linkul expirat nu e o 404: spune ce s-a
// întâmplat și pune butonul pentru alt link chiar acolo (decizie de design, PLAN.md C2).

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)

  const expired = token.length < 20

  const save = useMutation({
    mutationFn: () => api.post<void>('/api/auth/reset-password', { token, password }),
    onSuccess: () => navigate('/login?reset=1', { replace: true }),
    onError: (err) => setError(err.message),
  })

  // Token invalid și token expirat primesc același cod, ca pagina să poată cere altul.
  const usedUp = save.isError && save.error instanceof ApiError && save.error.code === 'RESET_TOKEN_EXPIRED'
  if (expired || usedUp) {
    return <ExpiredLink to="/forgot-password" cta={t('auth:reset.requestAnother')} />
  }

  return (
    <AuthLayout title={t('auth:brand.title')} subline={t('auth:brand.subline')}>
      <h1 className="text-xl font-semibold">{t('auth:reset.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('auth:reset.hint')}</p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          setError(password !== repeat ? t('auth:password.mismatch') : null)
          if (password !== repeat) return
          save.mutate()
        }}
      >
        <Field label={t('common:labels.newPassword')}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
        </Field>
        <Field label={t('auth:password.newAgain')} error={error}>
          <PasswordInput autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" disabled={save.isPending || password.length < 12}>
          {save.isPending ? t('common:states.saving') : t('auth:reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}

/** Linkul a expirat sau a fost deja folosit: aceeași pagină, cu ieșirea directă. */
export function ExpiredLink({ to, cta }: { to: string; cta: string }) {
  return (
    <AuthLayout title={t('auth:brand.title')} subline={t('auth:brand.subline')}>
      <h1 className="text-xl font-semibold">{t('auth:reset.expiredTitle')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('auth:reset.expiredBody')}
      </p>
      <Button variant="outline" asChild className="mt-6 w-full">
        <Link to={to}>{cta}</Link>
      </Button>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {t('auth:backToLogin')}
        </Link>
      </p>
    </AuthLayout>
  )
}
