import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/shared/components/AuthLayout'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { useAuth, useLogin } from '@/shared/hooks/use-auth'
import { PasswordInput } from './PasswordInput'
import { t } from '@/shared/lib/i18n'

// Login (fișa „Login"). Eroarea stă sub formular și nu spune dacă emailul există —
// enumerarea de adrese ar fi o metodă de aflare a conturilor.

export function LoginPage() {
  const { isAuthenticated, isPending } = useAuth()
  const login = useLogin()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (!isPending && isAuthenticated) return <Navigate to="/" replace />

  return (
    <AuthLayout title={t('auth:brand.title')} subline={t('auth:brand.subline')}>
      <h1 className="text-xl font-semibold">{t('auth:login.title')}</h1>
      {params.get('reset') ? (
        <p className="mt-1 text-sm text-success-text">{t('auth:login.passwordChanged')}</p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{t('auth:login.hint')}</p>
      )}

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          login.mutate({ email, password }, { onSuccess: () => navigate('/', { replace: true }) })
        }}
      >
        <Field label={t('common:labels.email')}>
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={login.isError}
            required
            autoFocus
          />
        </Field>
        <Field label={t('common:labels.password')} error={login.isError ? login.error.message : null}>
          <PasswordInput
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {t('auth:login.forgot')}
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? t('common:states.connecting') : t('auth:login.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
