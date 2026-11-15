import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { PasswordInput } from '@/modules/auth/PasswordInput'
import { api, ApiError, onPasswordConfirmRequired } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'

interface Pending {
  promise: Promise<void>
  resolve: () => void
  reject: (reason: Error) => void
}

// Global "type your password again" dialog. api.ts calls it on PASSWORD_CONFIRM_REQUIRED and
// awaits the promise; concurrent requests share the one dialog.
export function PasswordConfirmProvider() {
  const pending = useRef<Pending | null>(null)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    onPasswordConfirmRequired(() => {
      if (pending.current) return pending.current.promise
      let resolve!: () => void
      let reject!: (reason: Error) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      pending.current = { promise, resolve, reject }
      setPassword('')
      setError(null)
      setOpen(true)
      return promise
    })
  }, [])

  const finish = (outcome: 'confirmed' | 'cancelled') => {
    const current = pending.current
    pending.current = null
    setOpen(false)
    setPassword('')
    if (outcome === 'confirmed') current?.resolve()
    else current?.reject(new Error('PASSWORD_CONFIRM_CANCELLED'))
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/confirm-password', { password })
      finish('confirmed')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth:confirmPassword.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish('cancelled')}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{t('auth:confirmPassword.title')}</DialogTitle>
          <DialogDescription>{t('auth:confirmPassword.body')}</DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field label={t('auth:confirmPassword.field')} error={error}>
            <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish('cancelled')}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={busy || password.length === 0}>
              {t('common:actions.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
