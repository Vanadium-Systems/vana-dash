import { Extension, type Editor, type Range } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import type { LucideIcon } from 'lucide-react'
import { CheckSquare, Code2, Heading1, Heading2, Heading3, List, ListOrdered, Pilcrow, Quote } from 'lucide-react'
import { t, type TKey } from '@/shared/lib/i18n'

export interface SlashItem {
  key: string
  label: TKey
  icon: LucideIcon
  run: (editor: Editor, range: Range) => void
}

const block = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range)

export const SLASH_ITEMS: SlashItem[] = [
  { key: 'text', label: 'notes:slash.text', icon: Pilcrow, run: (e, r) => block(e, r).setParagraph().run() },
  { key: 'h1', label: 'notes:slash.h1', icon: Heading1, run: (e, r) => block(e, r).setNode('heading', { level: 1 }).run() },
  { key: 'h2', label: 'notes:slash.h2', icon: Heading2, run: (e, r) => block(e, r).setNode('heading', { level: 2 }).run() },
  { key: 'h3', label: 'notes:slash.h3', icon: Heading3, run: (e, r) => block(e, r).setNode('heading', { level: 3 }).run() },
  { key: 'bullet', label: 'notes:slash.bullet', icon: List, run: (e, r) => block(e, r).toggleBulletList().run() },
  { key: 'ordered', label: 'notes:slash.ordered', icon: ListOrdered, run: (e, r) => block(e, r).toggleOrderedList().run() },
  { key: 'task', label: 'notes:slash.task', icon: CheckSquare, run: (e, r) => block(e, r).toggleTaskList().run() },
  { key: 'quote', label: 'notes:slash.quote', icon: Quote, run: (e, r) => block(e, r).toggleBlockquote().run() },
  { key: 'code', label: 'notes:slash.code', icon: Code2, run: (e, r) => block(e, r).toggleCodeBlock().run() },
]

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filterSlashItems(query: string, items: SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const needle = fold(query.trim())
  if (!needle) return items
  return items.filter((item) => fold(t(item.label)).includes(needle))
}

export interface SlashState {
  items: SlashItem[]
  index: number
  select: (item: SlashItem) => void
  /** Where the "/" is, for placing the menu. */
  rect: DOMRect | null
}

interface SlashOptions {
  onState: (state: SlashState | null) => void
}

// The "/" menu (N3). The extension only reports state; NoteEditor draws the list, so it can use
// the app's own components and tokens.
export const SlashCommand = Extension.create<SlashOptions>({
  name: 'slashCommand',
  addOptions: () => ({ onState: () => {} }),
  addProseMirrorPlugins() {
    const { onState } = this.options
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let index = 0
          let latest: SuggestionProps<SlashItem, SlashItem> | null = null
          const publish = () => {
            if (!latest) return
            const current = latest
            onState({
              items: current.items,
              index,
              select: (item) => current.command(item),
              rect: current.clientRect?.() ?? null,
            })
          }
          return {
            onStart: (props) => {
              latest = props
              index = 0
              publish()
            },
            onUpdate: (props) => {
              latest = props
              index = Math.min(index, Math.max(0, props.items.length - 1))
              publish()
            },
            onKeyDown: ({ event }) => {
              const count = latest?.items.length ?? 0
              if (!count) return false
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                index = (index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
                publish()
                return true
              }
              if (event.key === 'Enter') {
                latest?.command(latest.items[index]!)
                return true
              }
              return false
            },
            onExit: () => {
              latest = null
              onState(null)
            },
          }
        },
      }),
    ]
  },
})
