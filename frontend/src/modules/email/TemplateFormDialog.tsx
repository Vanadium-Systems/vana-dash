import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { RichTextEditor } from '@/shared/components/RichTextEditor'
import { api } from '@/shared/lib/api'
import type { EmailTemplate } from '@/shared/lib/types'

interface TemplateFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create */
  template: EmailTemplate | null
}

export function TemplateFormDialog({ open, onOpenChange, template }: TemplateFormDialogProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ name: '', subject: '', body: '' })

  useEffect(() => {
    if (open) {
      setForm({ name: template?.name ?? '', subject: template?.subject ?? '', body: template?.body ?? '' })
    }
  }, [open, template])

  const save = useMutation({
    mutationFn: () =>
      template
        ? api.patch<EmailTemplate>(`/api/email/templates/${template.id}`, form)
        : api.post<EmailTemplate>('/api/email/templates', form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'templates'] })
      toast.success(template ? 'Template actualizat' : 'Template creat')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? 'Editează template-ul' : 'Template nou'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="t-name">Nume</Label>
            <Input
              id="t-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-subject">Subiect</Label>
            <Input
              id="t-subject"
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-body">
              Conținut <span className="text-muted-foreground">(placeholder disponibil: {'{{nume}}'})</span>
            </Label>
            <RichTextEditor
              id="t-body"
              value={form.body}
              onChange={(html) => setForm((f) => ({ ...f, body: html }))}
              placeholder="Scrie conținutul template-ului…"
            />
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending ? 'Se salvează…' : 'Salvează'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
