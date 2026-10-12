import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/shared/components/AuthLayout'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'

// „Ai uitat parola?". Răspunsul e același pentru orice adresă, existentă sau nu: altfel
// pagina asta ar fi un mod de a afla cine are cont.

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  const send = useMutation({
    mutationFn: () => api.post<void>('/api/auth/forgot-password', { email }),
    onSuccess: () => setSent(true),
  })

  return (
    <AuthLayout title={t('auth:brand.title')} subline={t('auth:brand.subline')}>
      <h1 className="text-xl font-semibold">{t('common:labels.newPassword')}</h1>

      {sent ? (
        <>
          <p className="mt-2 text-sm">
            {t('auth:forgot.sent')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth:forgot.linkValidity')}</p>
          <Button variant="outline" asChild className="mt-6 w-full">
            <Link to="/login">{t('auth:backToLogin')}</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth:forgot.hint')}</p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              send.mutate()
            }}
          >
            <Field label={t('common:labels.email')} error={send.isError ? send.error.message : null}>
              <Input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
            </Field>
            <Button type="submit" className="w-full" disabled={send.isPending}>
              {send.isPending ? t('common:states.sending') : t('auth:forgot.submit')}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm">
            <Link to="/login" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
              {t('auth:backToLogin')}
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  )
}
