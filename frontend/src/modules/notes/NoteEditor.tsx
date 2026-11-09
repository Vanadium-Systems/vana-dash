import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, CheckSquare, Heading2, Italic, Link2, List, Redo2, Underline, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { FINE_POINTER, useMediaQuery } from '@/shared/hooks/use-media-query'
import { t } from '@/shared/lib/i18n'
import type { NoteDoc } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import './note-editor.css'
import { normalizeHref, noteExtensions } from './note-extensions'
import type { SlashState } from './slash-command'

interface NoteEditorProps {
  /** Read on mount only: the editor is uncontrolled, remount (key) to load another document. */
  doc: NoteDoc
  onChange: (doc: NoteDoc) => void
  editable?: boolean
  /** Cursor goes to the end on mount; off for an existing note, which the person opens to read first. */
  autoFocus?: boolean
  /** Ctrl+Enter. */
  onSubmit?: () => void
  className?: string
}

export function NoteEditor({ doc, onChange, editable = true, autoFocus = false, onSubmit, className }: NoteEditorProps) {
  const fine = useMediaQuery(FINE_POINTER)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  const editor = useEditor({
    editable,
    extensions: noteExtensions({ placeholder: t('notes:editor.placeholder'), onSlashState: setSlash, onSubmit: () => submitRef.current?.() }),
    content: doc,
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { class: 'min-h-24 focus:outline-none', 'aria-label': t('notes:editor.label') } },
    onUpdate: ({ editor: e }) => changeRef.current(e.getJSON() as NoteDoc),
  })

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  if (!editor) return null
  return (
    <div className={cn('note-prose', className)}>
      <EditorContent editor={editor} />
      {editable && fine ? <SelectionToolbar editor={editor} /> : null}
      {editable && !fine ? <KeyboardToolbar editor={editor} /> : null}
      {slash ? <SlashMenu state={slash} /> : null}
    </div>
  )
}

function useActive(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      link: e.isActive('link'),
      heading: e.isActive('heading'),
      bullet: e.isActive('bulletList'),
      task: e.isActive('taskList'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keeps the selection in the editor when the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(active && 'bg-accent text-accent-foreground')}
    >
      {children}
    </Button>
  )
}

function FormatButtons({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const active = useActive(editor)
  return (
    <>
      <ToolButton label={t('notes:editor.bold')} active={active.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label={t('notes:editor.italic')} active={active.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label={t('notes:editor.underline')} active={active.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline />
      </ToolButton>
      <ToolButton label={t('notes:editor.link')} active={active.link} onClick={onLink}>
        <Link2 />
      </ToolButton>
      <ToolButton label={t('notes:editor.heading')} active={active.heading} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 />
      </ToolButton>
      <ToolButton label={t('notes:editor.bulletList')} active={active.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List />
      </ToolButton>
      <ToolButton label={t('notes:editor.taskList')} active={active.task} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <CheckSquare />
      </ToolButton>
    </>
  )
}

function LinkField({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [value, setValue] = useState(() => (editor.getAttributes('link').href as string | undefined) ?? '')
  const apply = () => {
    const href = normalizeHref(value)
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
    onDone()
  }
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          apply()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onDone()
        }
      }}
      data-esc-local=""
      placeholder={t('notes:editor.linkPlaceholder')}
      aria-label={t('notes:editor.link')}
      className="h-control-sm w-56 rounded-sm bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
    />
  )
}

// On a mouse: the bar that floats over a selection (Keep and Notion).
function SelectionToolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false)
  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ state }) => !state.selection.empty && !editor.isActive('codeBlock')}
      className="glass z-30 flex items-center gap-0.5 rounded-md border p-0.5 shadow-lg"
    >
      {linking ? <LinkField editor={editor} onDone={() => setLinking(false)} /> : <FormatButtons editor={editor} onLink={() => setLinking(true)} />}
    </BubbleMenu>
  )
}

// Where the fingers are: a bar stuck to the top of the soft keyboard (N25). `visualViewport`
// shrinks when the keyboard opens, and the distance to the layout viewport's bottom is its height.
function KeyboardToolbar({ editor }: { editor: Editor }) {
  const [focused, setFocused] = useState(editor.isFocused)
  const [inset, setInset] = useState(0)
  const [linking, setLinking] = useState(false)
  const active = useActive(editor)

  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    editor.on('focus', on)
    editor.on('blur', off)
    return () => {
      editor.off('focus', on)
      editor.off('blur', off)
    }
  }, [editor])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop))
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  if (!focused && !linking) return null
  return (
    <div
      role="toolbar"
      aria-label={t('notes:editor.toolbar')}
      style={{ bottom: inset }}
      className="glass fixed inset-x-0 z-[60] flex items-center gap-0.5 overflow-hidden border-t px-1 py-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))]"
    >
      {linking ? (
        <LinkField editor={editor} onDone={() => setLinking(false)} />
      ) : (
        <>
          <ToolButton label={t('notes:editor.undo')} disabled={!active.canUndo} onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 />
          </ToolButton>
          <ToolButton label={t('notes:editor.redo')} disabled={!active.canRedo} onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 />
          </ToolButton>
          <FormatButtons editor={editor} onLink={() => setLinking(true)} />
        </>
      )}
    </div>
  )
}

function SlashMenu({ state }: { state: SlashState }) {
  const { rect } = state
  if (!rect) return null
  // Under the "/", kept inside the viewport on a narrow screen.
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 232))
  const flipUp = rect.bottom + 280 > window.innerHeight
  return (
    <div
      role="listbox"
      data-note-slash=""
      aria-label={t('notes:slash.label')}
      style={{ left, ...(flipUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) }}
      className="glass fixed z-[70] max-h-72 w-56 overflow-y-auto rounded-md border p-1 shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {state.items.length === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('notes:slash.none')}</p> : null}
      {state.items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={i === state.index}
          onClick={() => state.select(item)}
          className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm', i === state.index ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60')}
        >
          <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t(item.label)}
        </button>
      ))}
    </div>
  )
}
