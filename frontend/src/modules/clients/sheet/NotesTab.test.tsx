// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '@/shared/components/ui/confirm-dialog'
import { mixNotes, NotesTab } from './NotesTab'
import type { SheetNote, VoiceNote } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const data = vi.hoisted(() => ({ notes: [] as unknown[], voices: [] as unknown[] }))
vi.mock('@/shared/lib/api', () => ({
  api: { get: async (url: string) => (url.endsWith('/voice-notes') ? data.voices : data.notes) },
}))
vi.mock('@/shared/hooks/use-me', () => ({ useMe: () => ({ session: { user: { id: 'u1' } } }) }))
vi.mock('@/shared/hooks/use-team', () => ({ useTeamMembers: () => ({ data: [] }), memberName: () => '' }))
vi.mock('../tasks/SnippetTextarea', () => ({ SnippetTextarea: () => <textarea /> }))

const note = (id: string, createdAt: string, pinned = false): SheetNote => ({ id, authorUserId: 'u1', authorName: 'Ana', body: `text-${id}`, mentions: [], pinned, createdAt })
const voice = (id: string, createdAt: string, canManage: boolean): VoiceNote => ({
  id,
  taskId: null,
  mime: 'audio/webm',
  sizeBytes: 1000,
  durationSeconds: 75,
  caption: `voce-${id}`,
  createdAt,
  authorUserId: 'u2',
  authorName: 'Dan',
  authorEmail: 'dan@example.com',
  canManage,
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  data.notes = [note('pin', '2026-11-01T10:00:00Z', true), note('nou', '2026-11-09T10:00:00Z'), note('vechi', '2026-11-02T10:00:00Z')]
  data.voices = [voice('a', '2026-11-09T11:00:00Z', false), voice('b', '2026-11-05T09:00:00Z', true)]
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const mount = async () => {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ConfirmProvider>
          <NotesTab prospectId="p1" />
        </ConfirmProvider>
      </QueryClientProvider>,
    ),
  )
  // The two lists load in separate queries: wait until the skeleton is gone.
  for (let attempt = 0; attempt < 20 && container.querySelector('[data-testid="voice-note"]') === null; attempt++) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 10))))
  }
}

describe('mixNotes', () => {
  it('keeps pinned text notes on top and puts the rest, text and voice, newest first', () => {
    const order = mixNotes(data.notes as SheetNote[], data.voices as VoiceNote[]).map((entry) => (entry.kind === 'note' ? entry.note.id : `v-${entry.voice.id}`))
    expect(order).toEqual(['pin', 'v-a', 'nou', 'v-b', 'vechi'])
  })
})

describe('NotesTab', () => {
  it('lists text and voice notes in one chronological list', async () => {
    await mount()
    const items = [...container.querySelectorAll('ul > li')].map((li) => li.textContent ?? '')
    const marker = (token: string) => items.findIndex((item) => item.includes(token))
    expect([marker('text-pin'), marker('voce-a'), marker('text-nou'), marker('voce-b'), marker('text-vechi')]).toEqual([0, 1, 2, 3, 4])
    expect(items[1]).toContain('1:15')
    expect(items[1]).toContain('Dan')
  })

  it('plays the note from the audio route with the cookie, loading nothing until pressed', async () => {
    await mount()
    const audio = container.querySelector('audio')!
    expect(audio.getAttribute('src')).toBe('/api/prospects/p1/voice-notes/a/audio')
    expect(audio.getAttribute('preload')).toBe('none')
  })

  it('shows the menu only on the voice notes the person can manage', async () => {
    await mount()
    const rows = [...container.querySelectorAll('[data-testid="voice-note"]')]
    const menuOf = (row: Element) => row.querySelector('button[aria-haspopup="menu"]')
    expect(menuOf(rows[0]!)).toBeNull()
    expect(menuOf(rows[1]!)).not.toBeNull()
  })

  it('offers the recorder and the multi-file upload', async () => {
    await mount()
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).toContain('Notă vocală')
    expect(labels).toContain('Încarcă fișiere')
  })
})
