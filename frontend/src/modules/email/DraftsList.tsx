import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import type { EmailDraft } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

export function DraftsList({ onOpen }: { onOpen: (draft: EmailDraft) => void }) {
  const queryClient = useQueryClient()

  const drafts = useQuery({
    queryKey: ['email', 'drafts'],
    queryFn: () => api.get<EmailDraft[]>('/api/email/drafts'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/email/drafts/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'drafts'] })
      toast.success(t('email:drafts.deleted'))
    },
  })

  return (
    <Card>
      <CardContent className="pt-6">
        {drafts.isPending ? (
          <ListSkeleton rows={4} />
        ) : drafts.isError ? (
          <p className="text-sm text-destructive">{t('email:drafts.loadFailed')}</p>
        ) : !drafts.data?.length ? (
          <p className="text-sm text-muted-foreground">{t('email:drafts.empty')}</p>
        ) : (
          <div className="space-y-1">
            {drafts.data.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md p-2 text-sm hover:bg-muted">
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(d)}>
                  <p className="truncate font-medium">{d.subject || t('email:labels.noSubject')}</p>
                  <p className="truncate text-xs text-muted-foreground">{d.to || t('email:drafts.noRecipient')}</p>
                </button>
                <Button variant="outline" onClick={() => remove.mutate(d.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
