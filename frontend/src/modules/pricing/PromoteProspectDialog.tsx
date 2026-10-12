import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { Prospect } from '@/shared/lib/types'

interface PromoteProspectDialogProps {
  prospect: Prospect | null
  onOpenChange: (open: boolean) => void
}

// Adresa e cerută explicit aici (billing_clients.address e NOT NULL) — nu punem placeholder fals.
export function PromoteProspectDialog({ prospect, onOpenChange }: PromoteProspectDialogProps) {
  const queryClient = useQueryClient()
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
      toast.success('Prospect promovat la client')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  if (!prospect) return null

  return (
    <Dialog open={Boolean(prospect)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promovează „{prospect.name}" la client</DialogTitle>
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
              <Label htmlFor="promote-cif">CIF (prospectul nu are unul completat)</Label>
              <Input id="promote-cif" value={cif} onChange={(e) => setCif(e.target.value)} required minLength={2} maxLength={13} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="promote-address">Adresă</Label>
            <Input id="promote-address" value={address} onChange={(e) => setAddress(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="promote-city">Oraș</Label>
              <Input id="promote-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promote-county">Județ</Label>
              <Input id="promote-county" value={county} onChange={(e) => setCounty(e.target.value)} />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={promote.isPending}>
            {promote.isPending ? 'Se promovează…' : 'Promovează la client'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
