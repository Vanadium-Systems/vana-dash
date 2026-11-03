import { t } from '@/shared/lib/i18n'

/** Before the first message from someone else since the reader was last here (#27). */
export function NewMessagesLine({ count }: { count: number }) {
  return (
    <div className="my-2 flex items-center gap-2" role="separator" aria-label={t('messages:thread.newCount', { count })}>
      <span className="h-px flex-1 bg-primary/40" />
      <span className="text-xs font-medium text-primary">{t('messages:thread.newCount', { count })}</span>
      <span className="h-px flex-1 bg-primary/40" />
    </div>
  )
}
