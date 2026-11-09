import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { LINK_OPTIONS, placeholderExtension } from '@/shared/components/tiptap-base'
import { SlashCommand, type SlashState } from './slash-command'

interface NoteExtensionOptions {
  placeholder: string
  onSlashState?: (state: SlashState | null) => void
  /** Ctrl+Enter. */
  onSubmit?: () => void
}

// Markdown on typing (`# `, `- `, `1. `, `[] `, `> `, ``` ``` ```, `**x**`, `_x_`) comes from the
// StarterKit and TaskItem input rules; nothing here re-implements it.
export function noteExtensions({ placeholder, onSlashState, onSubmit }: NoteExtensionOptions) {
  return [
    StarterKit.configure({ link: { ...LINK_OPTIONS, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    placeholderExtension(placeholder),
    SlashCommand.configure({ onState: onSlashState ?? (() => {}) }),
    Extension.create({
      name: 'submitShortcut',
      addKeyboardShortcuts: () => ({
        'Mod-Enter': () => {
          if (!onSubmit) return false
          onSubmit()
          return true
        },
      }),
    }),
  ]
}

/** A link target the person typed: http(s) and mailto only, a bare domain gets https. */
export function normalizeHref(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^(https?:|mailto:)/i.test(value)) return value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  return `https://${value}`
}
