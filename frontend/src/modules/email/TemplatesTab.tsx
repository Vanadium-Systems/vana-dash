import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { EmailTemplate } from '@/shared/lib/types'
import { TemplateFormDialog } from './TemplateFormDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { t } from '@/shared/lib/i18n'

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
      toast.success(t('email:templates.deleted'))
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
          <Plus className="h-4 w-4" /> {t('email:templates.new')}
        </Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {templates.isPending ? (
            <ListSkeleton rows={4} />
          ) : templates.isError ? (
            <p className="text-sm text-destructive">{t('email:templates.loadFailed')}</p>
          ) : !templates.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('email:templates.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.name')}</TableHead>
                  <TableHead priority="md">{t('common:labels.subject')}</TableHead>
                  <TableHead priority="lg">{t('common:labels.content')}</TableHead>
                  <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.data.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium tbl-fill">
                      <div className="truncate">{template.name}</div>
                      <TableDetails items={[template.subject]} />
                    </TableCell>
                    <TableCell priority="md" className="max-w-xs truncate">{template.subject}</TableCell>
                    <TableCell priority="lg" className="max-w-sm truncate text-muted-foreground">{template.body}</TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        actions={[
                          {
                            key: 'edit',
                            icon: Pencil,
                            label: t('common:actions.edit'),
                            onClick: () => {
                              setEditing(template)
                              setDialogOpen(true)
                            },
                          },
                          {
                            key: 'delete',
                            icon: Trash2,
                            label: t('common:actions.delete'),
                            destructive: true,
                            onClick: () => {
                              void confirm({ title: t('email:templates.deleteTitle', { name: template.name }), consequence: t('email:templates.deleteBody'), confirmLabel: t('email:templates.deleteConfirm'), destructive: true }).then((ok) => ok && remove.mutate(template.id))
                            },
                          },
                        ]}
                      />
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
