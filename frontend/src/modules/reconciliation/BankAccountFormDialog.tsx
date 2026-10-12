import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { BankAccount, BankProvider } from '@/shared/lib/types'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

interface BankAccountFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create */
  account: BankAccount | null
}

export function BankAccountFormDialog({ open, onOpenChange, account }: BankAccountFormDialogProps) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState('revolut')
  const [name, setName] = useState('')
  const [accountRef, setAccountRef] = useState('')
  const [currency, setCurrency] = useState('RON')
  const [apiKey, setApiKey] = useState('')

  const providers = useQuery({
    queryKey: ['bank-providers'],
    queryFn: () => api.get<BankProvider[]>('/api/reconciliation/providers'),
    enabled: open,
  })

  useEffect(() => {
    if (open) {
      setProvider(account?.provider ?? 'revolut')
      setName(account?.name ?? '')
      setAccountRef(account?.accountRef ?? '')
      setCurrency(account?.currency ?? 'RON')
      // API key-ul nu vine niciodată din backend — la edit rămâne gol dacă nu-l schimbi
      setApiKey('')
    }
  }, [open, account])

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = { provider, name, currency }
      if (accountRef) body.accountRef = accountRef
      if (apiKey) body.apiKey = apiKey
      return account
        ? api.patch<BankAccount>(`/api/reconciliation/accounts/${account.id}`, body)
        : api.post<BankAccount>('/api/reconciliation/accounts', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['reconciliation'] })
      toast.success(account ? t('reconciliation:account.updated') : t('reconciliation:account.added'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? t('reconciliation:account.editTitle') : t('reconciliation:account.add')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="b-provider">{t('reconciliation:labels.provider')}</Label>
            <Select
              id="b-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {(providers.data ?? [{ type: 'revolut', displayName: 'Revolut Business' }]).map((p) => (
                <option key={p.type} value={p.type}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-name">{t('reconciliation:account.displayName')}</Label>
            <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="b-ref">{t('reconciliation:account.providerAccountId')}</Label>
              <Input id="b-ref" value={accountRef} onChange={(e) => setAccountRef(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="b-currency">{t('common:labels.currency')}</Label>
              <Input id="b-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="b-key">{t('reconciliation:account.apiKey')}</Label>
            <Input
              id="b-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('reconciliation:account.apiKeyHint')}
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
