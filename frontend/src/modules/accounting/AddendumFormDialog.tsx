import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import type { ContractAddendum } from '@/shared/lib/types'

interface AddendumFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: string
}

// Formular „Adaugă act adițional" — numerotarea (per client) e calculată server-side
// (modules/contracts/service.ts createAddendum), nu se cere aici.
export function AddendumFormDialog({ open, onOpenChange, clientId }: AddendumFormDialogProps) {
  const queryClient = useQueryClient()
  const [issuedAt, setIssuedAt] = useState('')
  const [oldPriceNote, setOldPriceNote] = useState('')
  const [newPriceNote, setNewPriceNote] = useState('')
  const [reason, setReason] = useState('')
  const [effectiveDateNote, setEffectiveDateNote] = useState('')
  const [temporary, setTemporary] = useState(false)
  const [reversionNote, setReversionNote] = useState('')

  useEffect(() => {
    if (open) {
      setIssuedAt(new Date().toISOString().slice(0, 10))
      setOldPriceNote('')
      setNewPriceNote('')
      setReason('')
      setEffectiveDateNote('data semnării prezentului Act Adițional')
      setTemporary(false)
      setReversionNote('')
    }
  }, [open])

  const save = useMutation({
    mutationFn: () =>
      api.post<ContractAddendum>(`/api/contracts/clients/${clientId}/addenda`, {
        issuedAt,
        oldPriceNote,
        newPriceNote,
        reason,
        effectiveDateNote,
        temporary,
        reversionNote: temporary && reversionNote ? reversionNote : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contract-addenda', clientId] })
      toast.success('Act adițional creat — generează PDF-ul din listă')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adaugă act adițional</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="aa-issued-at">Data</Label>
            <Input id="aa-issued-at" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="aa-old-price">Tarif anterior</Label>
              <Input id="aa-old-price" value={oldPriceNote} onChange={(e) => setOldPriceNote(e.target.value)} placeholder="ex: 100 RON/lună (fără TVA)" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="aa-new-price">Tarif nou</Label>
              <Input id="aa-new-price" value={newPriceNote} onChange={(e) => setNewPriceNote(e.target.value)} placeholder="ex: 40 EUR/lună (fără TVA)" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="aa-reason">Motivul modificării</Label>
            <Textarea id="aa-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aa-effective">Data intrării în vigoare</Label>
            <Input
              id="aa-effective"
              value={effectiveDateNote}
              onChange={(e) => setEffectiveDateNote(e.target.value)}
              placeholder="ex: data semnării prezentului Act Adițional"
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
            Caracter temporar (revenire automată la tariful vechi)
          </label>
          {temporary && (
            <div className="space-y-2">
              <Label htmlFor="aa-reversion">Condiția de revenire</Label>
              <Textarea
                id="aa-reversion"
                value={reversionNote}
                onChange={(e) => setReversionNote(e.target.value)}
                placeholder="ex: Revine la tariful anterior după 3 luni de la data intrării în vigoare."
              />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending ? 'Se salvează…' : 'Salvează act adițional'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
