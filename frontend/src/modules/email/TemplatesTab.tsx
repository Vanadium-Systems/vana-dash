import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { EmailTemplate } from '@/shared/lib/types'
import { TemplateFormDialog } from './TemplateFormDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'

export function TemplatesTab() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<EmailTemplate | null>(null)

  const templates = useQuery({
    queryKey: ['email', 'templates'],
    queryFn: () => api.get<EmailTemplate[]>('/api/email/templates'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/email/templates/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'templates'] })
      toast.success('Template șters')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="h-4 w-4" /> Template nou
        </Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {templates.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : templates.isError ? (
            <p className="text-sm text-destructive">Nu am putut încărca template-urile.</p>
          ) : !templates.data?.length ? (
            <p className="text-sm text-muted-foreground">Niciun template încă. Creează primul cu butonul de sus.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nume</TableHead>
                  <TableHead>Subiect</TableHead>
                  <TableHead>Conținut</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="max-w-xs truncate">{t.subject}</TableCell>
                    <TableCell className="max-w-sm truncate text-muted-foreground">{t.body}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditing(t)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            void confirm({ title: `Șterge șablonul „${t.name}”`, consequence: 'Emailurile trimise deja cu el nu se schimbă.', confirmLabel: 'Șterge șablonul', destructive: true }).then((ok) => ok && remove.mutate(t.id))
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <TemplateFormDialog open={dialogOpen} onOpenChange={setDialogOpen} template={editing} />
    </div>
  )
}
