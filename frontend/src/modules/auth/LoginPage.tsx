import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/shared/components/AuthLayout'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { useAuth, useLogin } from '@/shared/hooks/use-auth'
import { PasswordInput } from './PasswordInput'

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
    <AuthLayout title="VanaDash, de la Vanadium Systems" subline="Finanțe, clienți și email într-un singur loc.">
      <h1 className="text-xl font-semibold">Intră în cont</h1>
      {params.get('reset') ? (
        <p className="mt-1 text-sm text-success-text">Parola e schimbată. Intră cu parola nouă.</p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Emailul și parola de la VanaDash.</p>
      )}

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          login.mutate({ email, password }, { onSuccess: () => navigate('/', { replace: true }) })
        }}
      >
        <Field label="Email">
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
        <Field label="Parolă" error={login.isError ? login.error.message : null}>
          <PasswordInput
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Ai uitat parola?
          </Link>
        </div>
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Se conectează…' : 'Intră'}
        </Button>
      </form>
    </AuthLayout>
  )
}
