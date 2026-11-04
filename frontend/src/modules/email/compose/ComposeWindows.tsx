import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { EmailDraft } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { closeCompose, openCompose, setComposeMinimized, setComposeTitle, useComposeWindows, type ComposeWindow } from './compose-store'
import { ComposeForm } from './ComposeForm'
import type { SendFlowHandlers } from './send-flow'

const phoneQuery = window.matchMedia?.('(max-width: 767px)')

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      phoneQuery?.addEventListener('change', onChange)
      return () => phoneQuery?.removeEventListener('change', onChange)
    },
    () => phoneQuery?.matches ?? false,
  )
}

/** Opens a saved draft in a compose window (after Undo, from the failure toast, from Drafts). */
export async function openDraftById(draftId: string): Promise<void> {
  try {
    openCompose({ kind: 'draft', draft: await api.get<EmailDraft>(`/api/email/drafts/${draftId}`) })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('email:compose.draftMissing'))
  }
}

export function useSendFlowHandlers(): SendFlowHandlers {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return useMemo(
    () => ({
      onUndone: (draftId: string) => void openDraftById(draftId),
      onOpenDraft: (draftId: string) => void openDraftById(draftId),
      onView: (threadId: string) => navigate(`/email?thread=${threadId}`),
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: ['email', 'threads'] })
        void queryClient.invalidateQueries({ queryKey: ['email', 'drafts'] })
        void queryClient.invalidateQueries({ queryKey: ['email', 'sends'] })
      },
    }),
    [navigate, queryClient],
  )
}

// E15: on a desktop, windows float at the bottom right and the list stays usable under them;
// a window minimizes to its title bar. On a phone the open one takes the whole screen (E34).
export function ComposeWindows() {
  const windows = useComposeWindows()
  const phone = usePhoneLayout()
  const handlers = useSendFlowHandlers()
  if (windows.length === 0) return null

  const expandedOnPhone = phone ? [...windows].reverse().find((w) => !w.minimized) : undefined
  // Portalled to <body>: the page wrapper has a view-transition name, which makes its own stacking
  // context, and inside it no z-index gets above the phone's bottom nav.
  return createPortal(
    <>
      {expandedOnPhone ? <ComposeFrame key={expandedOnPhone.id} window={expandedOnPhone} phone handlers={handlers} /> : null}
      <div
        className={cn(
          'pointer-events-none fixed z-40 flex items-end gap-2',
          phone ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-2 right-2 flex-wrap justify-end' : 'bottom-0 right-4 flex-row-reverse',
        )}
      >
        {windows
          .filter((w) => w !== expandedOnPhone && (!phone || w.minimized))
          .map((w) => (
            <ComposeFrame key={w.id} window={w} phone={false} handlers={handlers} compactBar={phone} />
          ))}
      </div>
    </>,
    document.body,
  )
}

function ComposeFrame({
  window: w,
  phone,
  handlers,
  compactBar,
}: {
  window: ComposeWindow
  phone: boolean
  handlers: SendFlowHandlers
  compactBar?: boolean
}) {
  const closeRef = useRef<(() => Promise<void>) | null>(null)
  const onTitle = useCallback((title: string) => setComposeTitle(w.id, title), [w.id])
  const onDone = useCallback(() => closeCompose(w.id), [w.id])
  const close = () => void (closeRef.current ? closeRef.current() : Promise.resolve(onDone()))
  const title = w.title || t('email:compose.newMessage')

  const titleBar = (
    <div className="flex h-10 shrink-0 items-center gap-1 rounded-t-lg bg-muted pl-3 pr-1">
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-sm font-medium"
        onClick={() => setComposeMinimized(w.id, !w.minimized)}
        aria-expanded={!w.minimized}
      >
        {title}
      </button>
      {phone ? null : (
        <button
          type="button"
          className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label={w.minimized ? t('email:compose.expand') : t('email:compose.minimize')}
          title={w.minimized ? t('email:compose.expand') : t('email:compose.minimize')}
          onClick={() => setComposeMinimized(w.id, !w.minimized)}
        >
          {w.minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        className="rounded p-1.5 text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label={t('common:actions.close')}
        title={t('common:actions.close')}
        onClick={close}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )

  if (phone) {
    return (
      <div role="dialog" aria-label={title} className="float-in fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top,0px)]">
        {titleBar}
        <div className="min-h-0 flex-1">
          <ComposeForm init={w.init} variant="sheet" handlers={handlers} onDone={onDone} onTitle={onTitle} closeRef={closeRef} />
        </div>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-label={title}
      className={cn(
        'float-in pointer-events-auto flex flex-col rounded-t-lg border border-b-0 bg-popover shadow-xl transition-[height] duration-200 ease-[var(--ease-in-out)]',
        w.minimized || compactBar ? 'h-10 w-64' : 'h-[min(616px,calc(100dvh-2rem))] w-[min(600px,calc(100vw-2rem))]',
      )}
    >
      {titleBar}
      {/* Kept mounted while minimized, so typing state and the autosave timer survive. */}
      <div className={cn('min-h-0 flex-1', (w.minimized || compactBar) && 'hidden')}>
        <ComposeForm init={w.init} variant="window" handlers={handlers} onDone={onDone} onTitle={onTitle} closeRef={closeRef} />
      </div>
    </div>
  )
}
