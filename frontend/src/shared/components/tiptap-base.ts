import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'

// The part of the tiptap setup that the email editor and the notes editor share. Each editor adds
// its own extensions between `baseExtensions()` and the placeholder; the order matters for how
// marks nest when a document is serialized, so the email editor keeps the order it always had.

export const baseExtensions = () => [StarterKit, Underline]

export const LINK_OPTIONS = { openOnClick: false } as const

export const placeholderExtension = (text: string) => Placeholder.configure({ placeholder: text })
