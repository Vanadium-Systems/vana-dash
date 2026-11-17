import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'
import type { EmojiEntry } from './data'

export const EMOJI_LISTBOX_ID = 'emoji-autocomplete'
export const emojiOptionId = (index: number) => `${EMOJI_LISTBOX_ID}-${index}`

/** The `:text` suggestions above the field. Keys are handled by the Composer, which owns the textarea. */
export function EmojiAutocomplete({
  entries,
  query,
  activeIndex,
  onPick,
}: {
  entries: EmojiEntry[]
  query: string
  activeIndex: number
  onPick: (entry: EmojiEntry) => void
}) {
  return (
    <ul
      id={EMOJI_LISTBOX_ID}
      role="listbox"
      aria-label={t('messages:emoji.suggestions')}
      className="absolute inset-x-3 bottom-full mb-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md md:right-auto md:w-72"
    >
      {entries.map((entry, index) => (
        <li
          key={entry.emoji}
          id={emojiOptionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          // The textarea keeps focus: a mousedown here would blur it before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(entry)}
          className={cn('flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm', index === activeIndex && 'bg-accent')}
        >
          <span className="text-xl leading-none" aria-hidden="true">
            {entry.emoji}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">:{entry.codes.find((c) => c.includes(query.toLowerCase())) ?? entry.codes[0]}:</span>
        </li>
      ))}
    </ul>
  )
}
