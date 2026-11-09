import { ApiError } from '@/shared/lib/api'
import type { Note, NoteDoc } from '@/shared/lib/types'

export interface NoteDraft {
  title: string
  doc: NoteDoc
}

export type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict'

interface NoteSaverOptions {
  /** Sends the draft; `expectedUpdatedAt` is the last `updatedAt` this editor received. Null = nothing to send. */
  send: (draft: NoteDraft, expectedUpdatedAt: string | undefined) => Promise<Note | null>
  onSaved: (note: Note) => void
  onStatus: (status: SaveStatus) => void
  onConflict: (current: Note) => void
  delayMs?: number
  retryMs?: number
}

/**
 * Continuous save (N4): changes are sent 800 ms after the last keystroke, one request at a time.
 * A failed save keeps the draft in memory and tries again by itself; a 409 stops the saver until
 * the person picks a side (reload theirs, or keep mine over the other tab's version).
 */
export function createNoteSaver({ send, onSaved, onStatus, onConflict, delayMs = 800, retryMs = 5000 }: NoteSaverOptions) {
  let draft: NoteDraft | null = null
  let expected: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | null = null
  let conflicted = false

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  const run = (): Promise<void> => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      while (draft && !conflicted) {
        const sending = draft
        draft = null
        onStatus('saving')
        try {
          const saved = await send(sending, expected)
          if (saved) {
            expected = saved.updatedAt
            onSaved(saved)
          }
          if (!draft) onStatus('saved')
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            conflicted = true
            onStatus('conflict')
            const current = (err.body as { data?: Note } | undefined)?.data
            if (current) onConflict(current)
            // The text stays in the editor; keeping it is a choice the banner offers.
            draft = sending
          } else {
            draft = draft ?? sending
            onStatus('error')
            timer = setTimeout(() => void run(), retryMs)
          }
          break
        }
      }
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    /** The editor's content changed. */
    change(next: NoteDraft) {
      draft = next
      if (conflicted) return
      clear()
      timer = setTimeout(() => void run(), delayMs)
    },
    /** Sends what is pending now (closing the note, switching tab). */
    async flush() {
      clear()
      if (draft && !conflicted) await run()
      else await inFlight
    },
    /** The `updatedAt` the next save is checked against; set from the server's note on open and on reload. */
    setBase(updatedAt: string) {
      expected = updatedAt
    },
    /** "Keep my version": saves the pending draft over the other tab's note. */
    keepMine(currentUpdatedAt: string) {
      expected = currentUpdatedAt
      conflicted = false
      void this.flush()
    },
    /** "Reload": drops the pending draft; the caller loads the other version. */
    discard(currentUpdatedAt: string) {
      clear()
      draft = null
      expected = currentUpdatedAt
      conflicted = false
      onStatus('saved')
    },
    get pending() {
      return draft !== null
    },
    dispose: clear,
  }
}

export type NoteSaver = ReturnType<typeof createNoteSaver>
