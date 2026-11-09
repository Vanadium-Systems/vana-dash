import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'

// Every calendar write answers with a revert token (server-side undo, modules/calendar/revert.ts).
// The toast says exactly what happened and offers "Undo"; Ctrl+Z does the same while the toast is
// on screen (C11), so the last token is kept here until the toast goes.

const UNDO_WINDOW_MS = 8000

let last: { token: string; toastId: string | number; until: number } | null = null

async function revert(token: string, queryClient: QueryClient) {
  if (last?.token === token) {
    toast.dismiss(last.toastId)
    last = null
  }
  try {
    await api.post(`/api/calendar/events/revert/${token}`)
    toast(t('common:undo.done'))
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('common:undo.failed'))
  } finally {
    void queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
}

export function revertableToast(message: string, token: string, queryClient: QueryClient) {
  const toastId = toast.success(message, {
    duration: UNDO_WINDOW_MS,
    action: { label: t('common:undo.action'), onClick: () => void revert(token, queryClient) },
  })
  last = { token, toastId, until: Date.now() + UNDO_WINDOW_MS }
}

/** Ctrl+Z on the Calendar page: false when there is nothing left to undo. */
export function undoLast(queryClient: QueryClient): boolean {
  if (!last || last.until < Date.now()) return false
  void revert(last.token, queryClient)
  return true
}
