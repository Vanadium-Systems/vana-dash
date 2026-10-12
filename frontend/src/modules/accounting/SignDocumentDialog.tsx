import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { ContractDocument, SignatureRect } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'

interface SignDocumentDialogProps {
  doc: ContractDocument | null
  onOpenChange: (open: boolean) => void
}

// Constrângere reală: tokenul virtual certSIGN al lui Stefan e legat de Windows — semnarea
// efectivă NU poate rula pe backend-ul din Docker de pe VPS. Fluxul de aici doar (a) memorează
// dreptunghiul ales, (b) generează un pachet local (JSignPdf) pe care Stefan îl rulează pe
// Windows, (c) primește PDF-ul semnat înapoi ca document nou. Vezi PLAN.md pt. detalii.
//
// Dreptunghiul se desenează pe o cutie proporție A4 goală (nu peste PDF-ul randat live — ar
// cere pdf.js, dependență nouă doar pt. asta) — Stefan deschide PDF-ul într-un tab separat ca
// referință vizuală și potrivește dreptunghiul după ochi. Suficient pt. un tool personal.
export function SignDocumentDialog({ doc, onOpenChange }: SignDocumentDialogProps) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [rect, setRect] = useState<SignatureRect | null>(null)
  const [rectSaved, setRectSaved] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (doc) {
      setRect(doc.signatureRect)
      setRectSaved(Boolean(doc.signatureRect))
      setPage(doc.signatureRect?.page ?? 1)
    }
  }, [doc])

  const saveRect = useMutation({
    mutationFn: (r: SignatureRect) => api.patch<ContractDocument>(`/api/contracts/documents/${doc!.id}/signature-rect`, r),
    onSuccess: () => {
      setRectSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['contract-documents'] })
      toast.success(t('accounting:sign.rectSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const uploadSigned = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.upload<ContractDocument>(`/api/contracts/documents/${doc!.id}/signed`, fd)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contract-documents'] })
      toast.success(t('accounting:sign.uploaded'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  if (!doc) return null

  function pointFromEvent(e: MouseEvent) {
    const bounds = boxRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (e.clientY - bounds.top) / bounds.height)),
    }
  }

  function handleMouseDown(e: MouseEvent) {
    const p = pointFromEvent(e)
    setDragStart(p)
    setRectSaved(false)
    setRect({ page, x: p.x, y: p.y, width: 0, height: 0 })
  }
  function handleMouseMove(e: MouseEvent) {
    if (!dragStart) return
    const p = pointFromEvent(e)
    setRect({
      page,
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      width: Math.abs(p.x - dragStart.x),
      height: Math.abs(p.y - dragStart.y),
    })
  }
  function handleMouseUp() {
    setDragStart(null)
  }

  async function downloadPackage() {
    setDownloading(true)
    try {
      await api.download(`/api/contracts/documents/${doc!.id}/sign-package`, `semnare_${doc!.id.slice(0, 8)}.zip`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  const hasRect = Boolean(rect && rect.width > 0.01 && rect.height > 0.01)

  return (
    <Dialog open={Boolean(doc)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('accounting:sign.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('accounting:sign.hint')}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => window.open(`/api/contracts/documents/${doc.id}/pdf`, '_blank')}>
              {t('accounting:sign.openPdf')}
            </Button>
            <Label htmlFor="sign-page" className="text-xs text-muted-foreground">
              {t('accounting:sign.page')}
            </Label>
            <Input
              id="sign-page"
              inputMode="numeric"
              className="w-16"
              value={page}
              onChange={(e) => {
                const next = Math.max(1, parseRoDecimal(e.target.value) || 0)
                setPage(next)
                setRect((r) => (r ? { ...r, page: next } : r))
                setRectSaved(false)
              }}
            />
          </div>
          <div
            ref={boxRef}
            className="relative mx-auto aspect-[595/842] w-full max-w-[280px] cursor-crosshair select-none rounded border bg-muted"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {rect ? (
              <div
                className="absolute rounded border-2 border-primary bg-primary/20"
                style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!hasRect || saveRect.isPending} onClick={() => rect && saveRect.mutate(rect)}>
              {t('accounting:sign.saveRect')}
            </Button>
            <Button type="button" variant="outline" disabled={!rectSaved || downloading} onClick={downloadPackage}>
              {downloading ? t('accounting:sign.downloading') : t('accounting:sign.downloadPackage')}
            </Button>
          </div>
          <div className="space-y-1.5 border-t pt-3">
            <Button type="button" variant="outline" disabled={uploadSigned.isPending} onClick={() => fileInputRef.current?.click()}>
              {uploadSigned.isPending ? t('common:states.uploading') : t('accounting:sign.uploadSigned')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t('accounting:sign.fallbackHint')}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadSigned.mutate(file)
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
