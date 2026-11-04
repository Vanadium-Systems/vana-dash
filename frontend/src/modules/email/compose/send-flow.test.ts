import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/shared/lib/i18n'
import type { EmailSendOutcome } from '@/shared/lib/types'

const toastMock = vi.hoisted(() => {
  const fn = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return fn
})
vi.mock('sonner', () => ({ toast: toastMock }))

const apiMock = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn() }))
vi.mock('@/shared/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/api')>()
  return { ...actual, api: apiMock }
})

const { ApiError } = await import('@/shared/lib/api')
const { trackScheduledSend } = await import('./send-flow')

const handlers = () => ({ onUndone: vi.fn(), onView: vi.fn(), onOpenDraft: vi.fn(), onSettled: vi.fn() })
const outcome = (o: Partial<EmailSendOutcome>): EmailSendOutcome => ({ status: 'sent', error: null, threadId: null, draftId: null, ...o })

function start(h = handlers()) {
  // The undo window is 10 s from "now".
  trackScheduledSend({ sendId: 's1', sendAfter: new Date(Date.now() + 10_000).toISOString() }, h)
  return h
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'))
  toastMock.mockClear()
  toastMock.error.mockClear()
  toastMock.success.mockClear()
  apiMock.get.mockReset()
  apiMock.delete.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('trackScheduledSend', () => {
  it('shows the sending toast with the seconds left and an Undo action', () => {
    start()
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringMatching(/\d/),
      expect.objectContaining({ id: 'send-s1', action: expect.objectContaining({ label: t('common:undo.action') }) }),
    )
  })

  it('undo calls DELETE on the scheduled send, then onUndone with the draft id', async () => {
    apiMock.delete.mockResolvedValue({ draftId: 'd1' })
    apiMock.get.mockResolvedValue(outcome({ status: 'cancelled' }))
    const h = start()
    const action = toastMock.mock.calls[0]?.[1].action as { onClick: () => void }
    action.onClick()
    await vi.advanceTimersByTimeAsync(0)
    expect(apiMock.delete).toHaveBeenCalledWith('/api/email/sends/s1/scheduled')
    expect(h.onUndone).toHaveBeenCalledWith('d1')
    expect(h.onSettled).toHaveBeenCalled()
    // The poll that follows the window must not report a send after an undo.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('says it is too late when the send already went out (409 SEND_ALREADY_DISPATCHED)', async () => {
    apiMock.delete.mockRejectedValue(new ApiError(409, 'x', 'SEND_ALREADY_DISPATCHED'))
    apiMock.get.mockResolvedValue(outcome({ status: 'sending' }))
    const h = start()
    const action = toastMock.mock.calls[0]?.[1].action as { onClick: () => void }
    action.onClick()
    await vi.advanceTimersByTimeAsync(0)
    expect(toastMock).toHaveBeenCalledWith(t('email:send.tooLate'), { id: 'send-s1' })
    expect(h.onUndone).not.toHaveBeenCalled()
  })

  it('shows a success toast with a View action once the status is sent', async () => {
    apiMock.get.mockResolvedValue(outcome({ status: 'sent', threadId: 'th1' }))
    const h = start()
    await vi.advanceTimersByTimeAsync(10_600)
    expect(apiMock.get).toHaveBeenCalledWith('/api/email/sends/s1/status')
    expect(toastMock.success).toHaveBeenCalledWith(
      t('email:send.sent'),
      expect.objectContaining({ id: 'send-s1', action: expect.objectContaining({ label: t('email:send.view') }) }),
    )
    const action = toastMock.success.mock.calls[0]?.[1].action as { onClick: () => void }
    action.onClick()
    expect(h.onView).toHaveBeenCalledWith('th1')
    expect(h.onSettled).toHaveBeenCalled()
  })

  it('keeps polling while the status is still scheduled or sending', async () => {
    apiMock.get
      .mockResolvedValueOnce(outcome({ status: 'sending' }))
      .mockResolvedValueOnce(outcome({ status: 'sent', threadId: 'th1' }))
    const h = start()
    await vi.advanceTimersByTimeAsync(10_600)
    expect(h.onSettled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_100)
    expect(h.onSettled).toHaveBeenCalledTimes(1)
  })

  it('shows a persistent error toast with an Open draft action on failure', async () => {
    apiMock.get.mockResolvedValue(outcome({ status: 'failed', error: 'Mailbox full', draftId: 'd9' }))
    const h = start()
    await vi.advanceTimersByTimeAsync(10_600)
    expect(toastMock.error).toHaveBeenCalledWith(
      t('email:send.failed', { reason: 'Mailbox full' }),
      expect.objectContaining({ id: 'send-s1', closeButton: true, action: expect.objectContaining({ label: t('email:send.openDraft') }) }),
    )
    const action = toastMock.error.mock.calls[0]?.[1].action as { onClick: () => void }
    action.onClick()
    expect(h.onOpenDraft).toHaveBeenCalledWith('d9')
    expect(h.onSettled).toHaveBeenCalled()
  })
})
