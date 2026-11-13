import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton, Skeleton } from '@/shared/components/ui/skeleton'
import { t } from '@/shared/lib/i18n'

export function LoadFailed({ missing, onRetry }: { missing: boolean; onRetry: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/accounting?tab=emise')}>
        <ArrowLeft aria-hidden="true" /> {t('accounting:editor.backToList')}
      </Button>
      {missing ? (
        <EmptyState kind="new" title={t('accounting:editor.missingDraft')} description={t('accounting:editor.missingDraftHint')} />
      ) : (
        <Alert
          tone="critical"
          title={t('accounting:editor.loadFailed')}
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {t('accounting:records.loadFailedHint')}
        </Alert>
      )}
    </div>
  )
}

export function EditorSkeleton() {
  return (
    <div className="mx-auto max-w-[96rem] space-y-6" aria-hidden="true">
      <Skeleton className="h-control-md w-24" />
      <Skeleton className="h-7 w-56" />
      <div className="grid gap-8 xl:grid-cols-2">
        <div className="space-y-4">
          <Skeleton className="h-control-md w-full" />
          <Skeleton className="h-control-md w-full" />
          <ListSkeleton rows={3} />
        </div>
        <Skeleton className="hidden h-[32rem] w-full xl:block" />
      </div>
    </div>
  )
}
