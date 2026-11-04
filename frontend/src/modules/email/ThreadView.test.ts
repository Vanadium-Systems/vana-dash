// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { EmailMessage } from '@/shared/lib/types'

vi.mock('./compose/ComposeForm', () => ({ ComposeForm: () => null }))
vi.mock('./compose/ComposeWindows', () => ({ usePhoneLayout: () => false, useSendFlowHandlers: () => ({}) }))

const { buildThreadItems, splitQuotedReply } = await import('./ThreadView')

function message(id: string, overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    threadId: 't1',
    direction: 'out',
    isRead: true,
    ...overrides,
  } as EmailMessage
}

const none = new Set<string>()
const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`)
const read = (list: string[]) => list.map((id) => message(id))

describe('buildThreadItems', () => {
  // Messages come newest first: m1 is the latest.
  it('expands the newest message and collapses read ones', () => {
    const items = buildThreadItems(read(ids(3)), none, none)
    expect(items.map((i) => i.kind === 'message' && i.expanded)).toEqual([true, false, false])
  })

  it('expands unread inbound messages but not unread outbound ones', () => {
    const messages = [
      message('m1'),
      message('m2', { direction: 'out', isRead: false }),
      message('m3', { direction: 'in', isRead: false }),
    ]
    const items = buildThreadItems(messages, none, none)
    expect(items.map((i) => i.kind === 'message' && i.expanded)).toEqual([true, false, true])
  })

  it('expands a message the person opened', () => {
    const items = buildThreadItems(read(ids(3)), new Set(['m3']), none)
    expect(items.map((i) => i.kind === 'message' && i.expanded)).toEqual([true, false, true])
  })

  it('folds a run of 6 collapsed messages into first, a "more" line, last', () => {
    // m1 is the open newest message, so m2..m7 form the collapsed run
    const items = buildThreadItems(read(ids(7)), none, none)
    expect(items).toHaveLength(4)
    expect(items[0]).toMatchObject({ kind: 'message', expanded: true })
    expect((items[1] as { message: EmailMessage }).message.id).toBe('m2')
    expect(items[2]).toEqual({ kind: 'more', count: 4, ids: ['m3', 'm4', 'm5', 'm6'] })
    expect((items[3] as { message: EmailMessage }).message.id).toBe('m7')
  })

  it('does not fold a run of 4 collapsed messages', () => {
    const items = buildThreadItems(read(ids(5)), none, none)
    expect(items.every((i) => i.kind === 'message')).toBe(true)
  })

  it('shows every message once any id of the run is revealed', () => {
    const items = buildThreadItems(read(ids(7)), none, new Set(['m4']))
    expect(items).toHaveLength(7)
    expect(items.every((i) => i.kind === 'message')).toBe(true)
  })
})

describe('splitQuotedReply', () => {
  it('returns the text untouched when nothing is quoted', () => {
    expect(splitQuotedReply('Thanks, see you Monday.')).toEqual({ main: 'Thanks, see you Monday.', quoted: null })
  })

  it('splits at the English "wrote:" line', () => {
    const text = 'Sounds good.\n\nOn Mon, 2 Nov 2026, Ana <ana@example.com> wrote:\n> Can we meet?'
    const { main, quoted } = splitQuotedReply(text)
    expect(main).toBe('Sounds good.')
    expect(quoted).toBe('On Mon, 2 Nov 2026, Ana <ana@example.com> wrote:\n> Can we meet?')
  })

  it('splits at the Romanian "a scris:" line', () => {
    const { main, quoted } = splitQuotedReply('Ok.\nAna a scris:\n> Ne vedem?')
    expect(main).toBe('Ok.')
    expect(quoted).toBe('Ana a scris:\n> Ne vedem?')
  })

  it('does not split on "wrote" in the middle of a line', () => {
    expect(splitQuotedReply('She wrote: a lot of things here').quoted).toBeNull()
  })
})
