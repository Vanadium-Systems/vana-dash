import { Download, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import type { ChatAttachment } from '@/shared/lib/types'

// Poza sau videoul deschis peste fir, ca la WhatsApp: pe tot ecranul, încadrat întreg, cu
// descărcare. Înainte, linkul deschidea fișierul în altă pagină, iar în APK poza apărea la
// mărimea reală, tăiată din colțul stânga sus.
//
// Butonul înapoi al telefonului închide vizualizarea, nu conversația: la deschidere punem o
// intrare în istoric, iar închiderea (X, Esc) se face tot prin `history.back()`.
export function MediaViewer({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  const href = `/api/chat/attachments/${attachment.id}`
  const isVideo = attachment.contentType.startsWith('video/')
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    window.history.pushState({ ...window.history.state, mediaViewer: true }, '')
    const onPopState = () => onCloseRef.current()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      window.history.back()
    }
    window.addEventListener('popstate', onPopState)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={attachment.filename} className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div className="safe-top flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded-sm p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Închide"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm">{attachment.filename}</span>
        <button
          type="button"
          onClick={() => void api.download(`${href}?download=1`, attachment.filename).catch((err: Error) => toast.error(err.message))}
          className="rounded-sm p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Descarcă"
        >
          <Download className="h-5 w-5" />
        </button>
      </div>
      <div className="safe-bottom flex min-h-0 flex-1 items-center justify-center">
        {isVideo ? (
          <video src={href} controls autoPlay playsInline className="max-h-full max-w-full" />
        ) : (
          <img src={href} alt={attachment.filename} className="max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>,
    document.body,
  )
}
