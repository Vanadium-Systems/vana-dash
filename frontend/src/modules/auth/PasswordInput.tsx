import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'

// Câmp de parolă cu „Arată parola" — în trei pași de autentificare. Butonul e în câmp, nu
// lângă el, ca să nu împingă eticheta de pe rând (§6.4).

export function PasswordInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className={cn('relative', className)}>
      <Input {...props} type={visible ? 'text' : 'password'} className="pr-10" />
      <button
        type="button"
        onClick={() => setVisible((on) => !on)}
        className="absolute right-1 top-1/2 flex h-control-sm w-control-sm -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={visible ? t('auth:password.hide') : t('auth:password.show')}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
