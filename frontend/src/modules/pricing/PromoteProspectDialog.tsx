import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { Prospect } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

interface PromoteProspectDialogProps {
  prospect: Prospect | null
  onOpenChange: (open: boolean) => void
}

// Adresa e cerută explicit aici (billing_clients.address e NOT NULL) — nu punem placeholder fals.
export function PromoteProspectDialog({ prospect, onOpenChange }: PromoteProspectDialogProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { can } = useMe()
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [county, setCounty] = useState('')
  const [cif, setCif] = useState('')

  useEffect(() => {
    if (prospect) {
      setAddress('')
      setCity('')
      setCounty('')
      setCif('')
    }
  }, [prospect])

  const promote = useMutation({
    mutationFn: () =>
      api.post(`/api/prospects/${prospect!.id}/promote`, {
        address,
        city: city || undefined,
        county: county || undefined,
        cif: prospect!.cif ? undefined : cif,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      void queryClient.invalidateQueries({ queryKey: ['billing-clients'] })
      // The new client lives on another page; without `facturi.clienti` that page would be a 403.
      toast.success(t('pricing:promote.done'), {
        action: can('facturi.clienti')
          ? { label: t('common:actions.view'), onClick: () => navigate('/accounting?tab=clienti') }
          : undefined,
      })
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  if (!prospect) return null

  return (
    <Dialog open={Boolean(prospect)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pricing:promote.title', { name: prospect.name })}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            promote.mutate()
          }}
        >
          {!prospect.cif && (
            <div className="space-y-2">
              <Label htmlFor="promote-cif">{t('pricing:promote.cifMissing')}</Label>
              <Input id="promote-cif" value={cif} onChange={(e) => setCif(e.target.value)} required minLength={2} maxLength={13} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="promote-address">{t('common:labels.address')}</Label>
            <Input id="promote-address" value={address} onChange={(e) => setAddress(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="promote-city">{t('common:labels.city')}</Label>
              <Input id="promote-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promote-county">{t('common:labels.county')}</Label>
              <Input id="promote-county" value={county} onChange={(e) => setCounty(e.target.value)} />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={promote.isPending}>
            {promote.isPending ? t('pricing:promote.promoting') : t('pricing:promote.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
