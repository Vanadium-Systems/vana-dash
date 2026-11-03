import { ChevronDown } from 'lucide-react'
import { t } from '@/shared/lib/i18n'

/** Round button centred over the thread's bottom edge, with the messages that came in meanwhile (#13). */
export function JumpToBottom({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count > 0 ? t('messages:thread.jumpToLatestCount', { count }) : t('messages:thread.jumpToLatest')}
      className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 h-10 w-10 items-center justify-center rounded-full border bg-popover text-foreground shadow-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronDown className="h-5 w-5" aria-hidden="true" />
      {count > 0 ? (
        <span className="absolute -top-1.5 -right-1 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] font-medium leading-5 text-primary-foreground tnum">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  )
}
