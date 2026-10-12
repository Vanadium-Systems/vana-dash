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
    return <ExpiredLink to="/forgot-password" cta="Am deja parolă" />
  }

  return (
    <AuthLayout title="VanaDash, de la Vanadium Systems" subline="Finanțe, clienți și email într-un singur loc.">
      <h1 className="text-xl font-semibold">Acceptă invitația</h1>
      <p className="mt-1 text-sm text-muted-foreground">Alege-ți parola și ești în cont. Minim 12 caractere.</p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          setError(password !== repeat ? 'Cele două parole nu sunt la fel.' : null)
          if (password !== repeat) return
          accept.mutate()
        }}
      >
        <Field label="Parolă">
          <PasswordInput autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus />
        </Field>
        <Field label="Parolă, din nou" error={error}>
          <PasswordInput autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" disabled={accept.isPending || password.length < 12}>
          {accept.isPending ? 'Se conectează…' : 'Acceptă și intră'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Am acceptat deja, vreau să intru
        </Link>
      </p>
    </AuthLayout>
  )
}

// Cel mai des: omul și-a pus parola, apoi a redeschis linkul din email ca să intre. Găsit
// live 2026-10-02 — fără ieșire spre login, a retrimis formularul de patru ori.
function InviteUsed() {
  return (
    <AuthLayout title="VanaDash, de la Vanadium Systems" subline="Finanțe, clienți și email într-un singur loc.">
      <h1 className="text-xl font-semibold">Invitația a fost deja acceptată</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Linkul din email merge o singură dată. Intră cu emailul și parola pe care ți le-ai ales.
      </p>
      <Button asChild className="mt-6 w-full">
        <Link to="/login">Intră în cont</Link>
      </Button>
      <p className="mt-6 text-center text-sm">
        <Link to="/forgot-password" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Nu mai știu parola
        </Link>
      </p>
    </AuthLayout>
  )
}
