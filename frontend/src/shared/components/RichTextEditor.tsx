import Color from '@tiptap/extension-color'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Redo,
  Underline as UnderlineIcon,
  Undo,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'

// 2026-08-11 — editor unic pt. Compose/Reply/Forward/Templates (nu mai există un mod separat
// "text simplu" vs "HTML": dacă nu atingi toolbar-ul, iese text simplu; dacă vrei, adaugi
// formatare din mers). HTML-ul devine sursa — backend-ul derivă text simplu din el
// (htmlToPlainText), nu invers ca înainte.

/** Vechile draft-uri/template-uri (dinainte de editor) au body text simplu, nu HTML — dacă le
 *  dăm direct la TipTap, liniile s-ar lipi (fără <br>/<p>, textul simplu nu are structură de
 *  bloc). Detectăm eurstic și convertim o singură dată, la încărcare. Verificăm strict un tag
 *  de BLOC la ÎNCEPUTUL string-ului (exact ce produce TipTap mereu, ex. `<p>...`) — un test
 *  generic "conține vreun `<...>`" ar prinde greșit text simplu legitim gen "Salut <nume aici>,"
 *  (placeholder scris de Stefan, nu HTML). */
function looksLikeHtml(value: string): boolean {
  return /^\s*<(p|div|ul|ol|h[1-6]|blockquote|pre|table)[\s>]/i.test(value)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function legacyBodyToHtml(value: string): string {
  if (!value) return ''
  if (looksLikeHtml(value)) return value
  return value
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || ''}</p>`)
    .join('')
}

// Link nu păstrează `style` din schema TipTap implicită (doar href/target/rel/class/title) —
// fără asta, un buton CTA (fundal + padding) lipit prin Importă HTML se degradează la link
// simplu la fiecare re-render. Extensia adaugă atributul ca să supraviețuiască roundtrip-ul.
const LinkWithStyle = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => element.getAttribute('style'),
        renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
      },
    }
  },
})

// Image de bază nu ține `style` — un logo de header inserat la mărimea naturală a fișierului
// (ex: sursa canonică 846×846) rămâne uriaș, fără nicio cale să-l micșorezi din editor (nu există
// resize la drag). Cu atributul păstrat: uploadImage() de mai jos inserează direct la o mărime
// de header rezonabilă, iar dacă Stefan vrea altceva, ajustează style-ul din Importă HTML.
const ImageWithStyle = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => element.getAttribute('style'),
        renderHTML: (attributes) => (attributes.style ? { style: attributes.style } : {}),
      },
    }
  },
})

const DEFAULT_UPLOADED_IMAGE_STYLE = 'max-height:56px;display:block;margin-bottom:16px'

const COLORS = ['#dc2626', '#ea580c', '#16a34a', '#2563eb', '#7c3aed', '#000000'] as const

interface ToolbarButtonProps {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}

function ToolbarButton({ active, disabled, onClick, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // păstrează selecția din editor la click pe buton
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-muted text-primary',
      )}
    >
      {children}
    </button>
  )
}

interface RichTextEditorProps {
  id?: string
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
}

export function RichTextEditor({ id, value, onChange, placeholder, className }: RichTextEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [htmlImportOpen, setHtmlImportOpen] = useState(false)
  const [htmlDraft, setHtmlDraft] = useState('')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      // 'heading' inclus explicit — fără el, un <h2 style="text-align:center"> lipit prin
      // Importă HTML își pierde centrarea la parse (bug real, găsit de Stefan: titlul unui
      // email centrat rămânea aliniat stânga după import, restul paragrafelor rămâneau centrate).
      TextAlign.configure({ types: ['paragraph', 'heading'] }),
      ImageWithStyle,
      LinkWithStyle.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: legacyBodyToHtml(value),
    editorProps: {
      attributes: {
        class: 'min-h-40 max-w-none px-3 py-2 text-sm focus:outline-none prose prose-sm',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  })

  // TipTap e necontrolat după montare — sincronizăm doar când `value` vine din AFARA editorului
  // (ex: alegere template, încărcare draft). Dacă am sincroniza mereu, fiecare tastă ar
  // re-seta conținutul și ar sări cursorul la început.
  useEffect(() => {
    if (!editor) return
    const normalized = legacyBodyToHtml(value)
    if (normalized !== editor.getHTML()) editor.commands.setContent(normalized)
  }, [value, editor])

  const uploadImage = async (file: File) => {
    if (!editor) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { url } = await api.upload<{ url: string }>('/api/email/images', fd)
      editor.chain().focus().insertContent(`<img src="${url}" style="${DEFAULT_UPLOADED_IMAGE_STYLE}">`).run()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common:editor.imageUploadFailed'))
    }
  }

  if (!editor) return null

  return (
    <div id={id} className={cn('rounded-md border border-input', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1 py-1">
        <ToolbarButton title={t('common:editor.undo')} disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title={t('common:editor.redo')} disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton title={t('common:editor.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title={t('common:editor.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title={t('common:editor.underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            title={t('common:editor.textColor', { color })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setColor(color).run()}
            className="h-4 w-4 shrink-0 rounded-full border"
            style={{ backgroundColor: color }}
          />
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          title={t('common:editor.alignLeft')}
          active={editor.isActive({ textAlign: 'left' })}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          <AlignLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title={t('common:editor.alignCenter')}
          active={editor.isActive({ textAlign: 'center' })}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          <AlignCenter className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title={t('common:editor.alignRight')}
          active={editor.isActive({ textAlign: 'right' })}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          <AlignRight className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton title={t('common:editor.bulletList')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          title={t('common:editor.numberedList')}
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton title={t('common:editor.insertImage')} onClick={() => imageInputRef.current?.click()}>
          <ImageIcon className="h-4 w-4" />
        </ToolbarButton>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void uploadImage(file)
            e.target.value = ''
          }}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          title={t('common:editor.importHtml')}
          active={htmlImportOpen}
          onClick={() => {
            setHtmlDraft(editor.getHTML())
            setHtmlImportOpen((o) => !o)
          }}
        >
          <Code2 className="h-4 w-4" />
        </ToolbarButton>
      </div>
      {htmlImportOpen ? (
        <div className="space-y-2 border-b bg-muted/30 p-2">
          <textarea
            className="h-32 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            value={htmlDraft}
            onChange={(e) => setHtmlDraft(e.target.value)}
            placeholder={t('common:editor.importHtmlPlaceholder')}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-muted" onClick={() => setHtmlImportOpen(false)}>
              {t('common:actions.cancel')}
            </button>
            <button
              type="button"
              className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
              onClick={() => {
                editor.commands.setContent(htmlDraft)
                onChange(editor.getHTML())
                setHtmlImportOpen(false)
              }}
            >
              {t('common:actions.apply')}
            </button>
          </div>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  )
}
