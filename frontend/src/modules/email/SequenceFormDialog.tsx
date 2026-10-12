import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { EmailSequence, EmailSettings, EmailTemplate } from '@/shared/lib/types'
import { IdentityField, useIdentityKey } from './IdentityField'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'

interface StepDraft {
  templateId: string
  delayDays: number
}

interface SequenceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sequence: EmailSequence | null
}

export function SequenceFormDialog({ open, onOpenChange, sequence }: SequenceFormDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<StepDraft[]>([{ templateId: '', delayDays: 0 }])

  const templates = useQuery({
    queryKey: ['email', 'templates'],
    queryFn: () => api.get<EmailTemplate[]>('/api/email/templates'),
    enabled: open,
  })

  const settings = useQuery({
    queryKey: ['email', 'settings'],
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
    enabled: open,
  })
  const [fromIdentity, setFromIdentity] = useIdentityKey('outreach', settings.data?.identities)

  useEffect(() => {
    if (!open) return
    if (sequence) {
      setName(sequence.name)
      setFromIdentity(sequence.fromIdentity)
      setSteps(
        sequence.steps.length
          ? sequence.steps.map((s) => ({ templateId: s.templateId, delayDays: s.delayDays }))
          : [{ templateId: '', delayDays: 0 }],
      )
    } else {
      setName('')
      setFromIdentity('outreach')
      setSteps([{ templateId: '', delayDays: 0 }])
    }
  }, [open, sequence])

  const save = useMutation({
    mutationFn: () => {
      const body = { name, fromIdentity, steps }
      return sequence ? api.patch(`/api/email/sequences/${sequence.id}`, body) : api.post('/api/email/sequences', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences'] })
      toast.success(sequence ? 'Secvență actualizată' : 'Secvență creată')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const canSave = name.trim().length > 0 && steps.length > 0 && steps.every((s) => s.templateId)

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }
  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }
  const removeStep = (index: number) => setSteps((prev) => prev.filter((_, i) => i !== index))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{sequence ? `Editează „${sequence.name}"` : 'Secvență nouă'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="seq-name">Nume</Label>
            <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <IdentityField id="seq-from" value={fromIdentity} onChange={setFromIdentity} identities={settings.data?.identities} />

          <div className="space-y-2">
            <Label>Pași</Label>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="flex flex-col">
                    <Button size="sm" type="button" variant="ghost" disabled={i === 0} onClick={() => moveStep(i, -1)}>
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      disabled={i === steps.length - 1}
                      onClick={() => moveStep(i, 1)}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                  <Select
                    className="flex-1"
                    value={step.templateId}
                    onChange={(e) => updateStep(i, { templateId: e.target.value })}
                    required
                  >
                    <option value="">— alege un template —</option>
                    {templates.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                    <Input
                      inputMode="numeric"
                      className="w-16"
                      value={step.delayDays}
                      onChange={(e) => updateStep(i, { delayDays: Math.max(0, parseRoDecimal(e.target.value) || 0) })}
                    />
                    zile
                  </div>
                  <Button type="button" variant="ghost" disabled={steps.length === 1} onClick={() => removeStep(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={() => setSteps((prev) => [...prev, { templateId: '', delayDays: 3 }])}>
              <Plus className="h-4 w-4" /> Adaugă pas
            </Button>
            <p className="text-xs text-muted-foreground">
              Zile = de la enrollment (pasul 1) sau de la pasul anterior (restul). 0 = trimis la prima rulare a cron-ului (dimineața, 08:00).
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={!canSave || save.isPending}>
            {save.isPending ? 'Se salvează…' : sequence ? 'Salvează' : 'Creează secvența'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
