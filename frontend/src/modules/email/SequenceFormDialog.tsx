import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { EmailSequence, EmailSenderOptions, EmailTemplate } from '@/shared/lib/types'
import { IdentityField, useIdentityKey } from './IdentityField'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

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
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
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
      toast.success(sequence ? t('email:sequences.updated') : t('email:sequences.created'))
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
          <DialogTitle>{sequence ? t('email:sequences.editTitle', { name: sequence.name }) : t('email:sequences.new')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="seq-name">{t('common:labels.name')}</Label>
            <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <IdentityField id="seq-from" value={fromIdentity} onChange={setFromIdentity} identities={settings.data?.identities} />

          <div className="space-y-2">
            <Label>{t('email:sequences.steps')}</Label>
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
                    <option value="">{t('email:bulk.pickTemplate')}</option>
                    {templates.data?.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
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
                    {t('email:sequences.days')}
                  </div>
                  <Button type="button" variant="ghost" disabled={steps.length === 1} onClick={() => removeStep(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={() => setSteps((prev) => [...prev, { templateId: '', delayDays: 3 }])}>
              <Plus className="h-4 w-4" /> {t('email:sequences.addStep')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t('email:sequences.daysHint')}
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={!canSave || save.isPending}>
            {save.isPending ? t('common:states.saving') : sequence ? t('common:actions.save') : t('email:sequences.create')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
