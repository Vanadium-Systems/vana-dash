import { toast } from 'sonner'
import { t } from '@/shared/lib/i18n'

const UNDO_WINDOW_MS = 6000

/**
 * Runs `effect`, then says what happened with an "Anulează" that runs `undo` (E8). The message names
 * the action ("3 conversații arhivate"), never a generic "Actualizat". Both sides go to the server;
 * nothing is delayed, so closing the tab right after keeps the action.
 */
export async function undoToast(message: string, effect: () => Promise<unknown>, undo: () => Promise<unknown>): Promise<boolean> {
  try {
    await effect()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('common:states.changeNotSaved'))
    return false
  }
  toast.success(message, {
    duration: UNDO_WINDOW_MS,
    action: {
      label: t('common:undo.action'),
      onClick: () => {
        undo().then(
          () => toast(t('common:undo.done')),
          (err: unknown) => toast.error(err instanceof Error ? err.message : t('common:undo.failed')),
        )
      },
    },
  })
  return true
}
