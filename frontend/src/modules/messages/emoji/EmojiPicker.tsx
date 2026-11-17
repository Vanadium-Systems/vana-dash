import { useEffect, useMemo, useRef, useState } from 'react'
import { createLucideIcon, type IconNode } from '@/shared/components/icons/create-icon'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { t } from '@/shared/lib/i18n'
import { loadEmoji, searchEmoji, type EmojiEntry } from './data'

// The vendored icon set (shared/components/icons) has no smiley; same geometry as lucide's `smile`.
const Smile = createLucideIcon('Smile', [
  ['circle', { cx: '12', cy: '12', r: '10', key: 'face' }],
  ['path', { d: 'M8 14s1.5 2 4 2 4-2 4-2', key: 'mouth' }],
  ['line', { x1: '9', x2: '9.01', y1: '9', y2: '9', key: 'eye-l' }],
  ['line', { x1: '15', x2: '15.01', y1: '9', y2: '9', key: 'eye-r' }],
] as IconNode)

// Group ids of emojibase (2 = components, not shown).
const GROUPS = [0, 1, 3, 4, 5, 6, 7, 8, 9] as const

/** Button + panel with search and the grid by category; picking inserts and closes. */
export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<EmojiEntry[]>([])
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void loadEmoji().then((loaded) => {
      if (!cancelled) setEntries(loaded)
    })
    searchRef.current?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    // preventDefault: otherwise the same Esc would also leave the conversation (MessagesPage).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const found = useMemo(() => searchEmoji(entries, query), [entries, query])

  const pick = (emoji: string) => {
    setOpen(false)
    setQuery('')
    onPick(emoji)
  }

  return (
    <div ref={rootRef} className="contents">
      {open ? (
        <div
          role="dialog"
          aria-label={t('messages:emoji.picker')}
          className="absolute inset-x-0 bottom-full z-10 flex max-h-[min(24rem,60dvh)] flex-col gap-2 border-t bg-popover p-3 md:inset-x-auto md:right-3 md:mb-2 md:w-80 md:rounded-md md:border md:shadow-md"
        >
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('messages:emoji.search')}
            aria-label={t('messages:emoji.search')}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {entries.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('messages:emoji.loading')}</p>
            ) : found.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('messages:emoji.none')}</p>
            ) : (
              GROUPS.map((group) => {
                const inGroup = found.filter((e) => e.group === group)
                if (inGroup.length === 0) return null
                return (
                  <section key={group} className="mb-2">
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">{t(`messages:emoji.groups.${group}`)}</h3>
                    <div className="grid grid-cols-8 gap-0.5">
                      {inGroup.map((entry) => (
                        // native: emoji grid cell, 1900 of them
                        <button
                          key={entry.emoji}
                          type="button"
                          title={entry.label}
                          aria-label={entry.label}
                          onClick={() => pick(entry.emoji)}
                          className="flex aspect-square items-center justify-center rounded-sm text-xl hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {entry.emoji}
                        </button>
                      ))}
                    </div>
                  </section>
                )
              })
            )}
          </div>
        </div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('messages:emoji.open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
      >
        <Smile className="h-4 w-4" />
      </Button>
    </div>
  )
}
