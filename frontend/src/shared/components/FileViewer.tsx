import { ChevronLeft, ChevronRight, Download, FileText, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/shared/lib/i18n'

export interface ViewerFile {
  id: string
  name: string
  url: string
  mimeType: string
}

const buttonClass = 'rounded-sm p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'

// Full-screen over the page, contained, not a new tab: in the APK a plain link showed the photo at
// real size, cropped. Back in the APK sends Escape while a [role=dialog] is open (native-back.ts),
// so it closes the viewer and not the page behind it. `onDownload` is for callers whose files need
// the authenticated fetch (the WebView has no download manager for a bare `<a download>`).
export function FileViewer({
  files,
  index,
  onIndexChange,
  onClose,
  onDownload,
}: {
  files: ViewerFile[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  onDownload?: (file: ViewerFile) => void
}) {
  const file = files[index]
  const overlayRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ index, count: files.length, onIndexChange, onClose })
  latest.current = { index, count: files.length, onIndexChange, onClose }

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    overlayRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      const { index: current, count, onIndexChange: change, onClose: close } = latest.current
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowLeft' && current > 0) change(current - 1)
      else if (e.key === 'ArrowRight' && current < count - 1) change(current + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [])

  if (!file) return null

  const download = onDownload ? (
    <button type="button" onClick={() => onDownload(file)} className={buttonClass} aria-label={t('common:actions.download')}>
      <Download className="h-5 w-5" />
    </button>
  ) : (
    <a href={file.url} download={file.name} className={buttonClass} aria-label={t('common:actions.download')}>
      <Download className="h-5 w-5" />
    </a>
  )

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white focus:outline-none"
    >
      <div className="safe-top flex items-center gap-2 px-2 py-2">
        <button type="button" onClick={onClose} className={buttonClass} aria-label={t('common:actions.close')}>
          <X className="h-5 w-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
        {files.length > 1 ? (
          <span className="text-xs tnum text-white/70">
            {index + 1} / {files.length}
          </span>
        ) : null}
        {download}
      </div>
      <div className="safe-bottom relative flex min-h-0 flex-1 items-center justify-center">
        <Preview file={file} download={download} />
        {index > 0 ? (
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            className={`${buttonClass} absolute left-2 top-1/2 -translate-y-1/2 bg-black/50`}
            aria-label={t('common:viewer.previous')}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}
        {index < files.length - 1 ? (
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            className={`${buttonClass} absolute right-2 top-1/2 -translate-y-1/2 bg-black/50`}
            aria-label={t('common:viewer.next')}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

function Preview({ file, download }: { file: ViewerFile; download: ReactNode }) {
  if (file.mimeType.startsWith('image/')) return <img src={file.url} alt={file.name} className="max-h-full max-w-full object-contain" />
  if (file.mimeType.startsWith('video/')) return <video src={file.url} controls autoPlay playsInline className="max-h-full max-w-full" />
  if (file.mimeType === 'application/pdf') return <iframe src={file.url} title={file.name} className="h-full w-full border-0 bg-white" />
  return (
    <div className="flex max-w-full flex-col items-center gap-3 px-6 text-center">
      <FileText className="h-12 w-12 text-white/70" aria-hidden="true" />
      <span className="max-w-full break-words text-sm">{file.name}</span>
      <div className="rounded-md border border-white/30">{download}</div>
    </div>
  )
}
