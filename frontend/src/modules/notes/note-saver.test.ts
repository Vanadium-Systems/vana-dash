import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/lib/api'
import type { Note } from '@/shared/lib/types'
import { createNoteSaver, type NoteDraft, type SaveStatus } from './note-saver'
import { plainToDoc } from './note-doc'

const note = (updatedAt: string): Note => ({
  id: 'n1',
  title: 't',
  body: '',
  bodyFormat: 'rich',
  bodyJson: null,
  pinned: false,
  color: null,
  labels: [],
  archivedAt: null,
  deletedAt: null,
  createdAt: updatedAt,
  updatedAt,
})
const draft = (title: string): NoteDraft => ({ title, doc: plainToDoc('') })

function setup(send: (d: NoteDraft, expected: string | undefined) => Promise<Note | null>) {
  const statuses: SaveStatus[] = []
  const conflicts: Note[] = []
  const saved: Note[] = []
  const saver = createNoteSaver({ send, onSaved: (n) => saved.push(n), onStatus: (s) => statuses.push(s), onConflict: (n) => conflicts.push(n) })
  return { saver, statuses, conflicts, saved }
}

describe('createNoteSaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends once, 800 ms after the last change, with the latest text', async () => {
    const send = vi.fn(async (_d: NoteDraft, _e: string | undefined) => note('2026-01-01T10:00:01.000Z'))
    const { saver } = setup(send)
    saver.change(draft('a'))
    await vi.advanceTimersByTimeAsync(500)
    saver.change(draft('ab'))
    await vi.advanceTimersByTimeAsync(799)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0].title).toBe('ab')
  })

  it('checks each save against the updatedAt the previous one returned', async () => {
    const send = vi.fn(async (_d: NoteDraft, _e: string | undefined) => note(`2026-01-01T10:00:0${send.mock.calls.length}.000Z`))
    const { saver } = setup(send)
    saver.setBase('2026-01-01T10:00:00.000Z')
    saver.change(draft('a'))
    await vi.advanceTimersByTimeAsync(800)
    saver.change(draft('b'))
    await vi.advanceTimersByTimeAsync(800)
    expect(send.mock.calls.map((call) => call[1])).toEqual(['2026-01-01T10:00:00.000Z', '2026-01-01T10:00:01.000Z'])
  })

  it('flush sends at once what is pending', async () => {
    const send = vi.fn(async (_d: NoteDraft, _e: string | undefined) => note('2026-01-01T10:00:01.000Z'))
    const { saver, statuses } = setup(send)
    saver.change(draft('a'))
    await saver.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(statuses.at(-1)).toBe('saved')
  })

  it('stops on a 409, hands over the other tab\'s note and keeps the draft', async () => {
    const current = note('2026-01-01T10:05:00.000Z')
    const send = vi.fn(async (_d: NoteDraft, _e: string | undefined): Promise<Note | null> => {
      throw new ApiError(409, 'changed', 'NOTE_CHANGED', { data: current })
    })
    const { saver, statuses, conflicts } = setup(send)
    saver.change(draft('mine'))
    await vi.advanceTimersByTimeAsync(800)
    expect(statuses.at(-1)).toBe('conflict')
    expect(conflicts).toEqual([current])
    // No retry loop against a conflict, and further typing waits for a choice.
    saver.change(draft('mine 2'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('"keep mine" sends the draft against the other version', async () => {
    const current = note('2026-01-01T10:05:00.000Z')
    let calls = 0
    const send = vi.fn(async (_d: NoteDraft, expected: string | undefined): Promise<Note | null> => {
      calls += 1
      if (calls === 1) throw new ApiError(409, 'changed', 'NOTE_CHANGED', { data: current })
      expect(expected).toBe(current.updatedAt)
      return note('2026-01-01T10:06:00.000Z')
    })
    const { saver, statuses } = setup(send)
    saver.change(draft('mine'))
    await vi.advanceTimersByTimeAsync(800)
    saver.keepMine(current.updatedAt)
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe('saved')
  })

  it('"reload" drops the draft and saves nothing', async () => {
    const current = note('2026-01-01T10:05:00.000Z')
    const send = vi.fn(async (): Promise<Note | null> => {
      throw new ApiError(409, 'changed', 'NOTE_CHANGED', { data: current })
    })
    const { saver } = setup(send)
    saver.change(draft('mine'))
    await vi.advanceTimersByTimeAsync(800)
    saver.discard(current.updatedAt)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(saver.pending).toBe(false)
  })

  it('retries a failed save by itself after 5 s, with the text still in memory', async () => {
    let calls = 0
    const send = vi.fn(async (_d: NoteDraft, _e: string | undefined): Promise<Note | null> => {
      calls += 1
      if (calls === 1) throw new ApiError(0, 'offline')
      return note('2026-01-01T10:00:09.000Z')
    })
    const { saver, statuses } = setup(send)
    saver.change(draft('text'))
    await vi.advanceTimersByTimeAsync(800)
    expect(statuses.at(-1)).toBe('error')
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![0].title).toBe('text')
    expect(statuses.at(-1)).toBe('saved')
  })

  it('does not report a saved note when send has nothing to do (empty new note)', async () => {
    const send = vi.fn(async (): Promise<Note | null> => null)
    const { saver, saved } = setup(send)
    saver.change(draft(''))
    await vi.advanceTimersByTimeAsync(800)
    expect(saved).toEqual([])
  })
})
