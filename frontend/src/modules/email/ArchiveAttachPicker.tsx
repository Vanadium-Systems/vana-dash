import { useQuery } from '@tanstack/react-query'
import { Eye, File as FileIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { api } from '@/shared/lib/api'
import { fileFromUrl, type PendingAttachment } from '@/shared/lib/attachments'
import type { ArchiveDownloadUrl, ArchiveSearchResult } from '@/shared/lib/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface ArchiveAttachPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (attachment: PendingAttachment) => void
}

export function ArchiveAttachPicker({ open, onOpenChange, onSelect }: ArchiveAttachPickerProps) {
  const [q, setQ] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const debouncedQ = useDebounced(q, 300)

  const results = useQuery({
    queryKey: ['archive', 'search', debouncedQ],
    queryFn: () => api.get<ArchiveSearchResult[]>(`/api/archive/search?q=${encodeURIComponent(debouncedQ)}`),
    enabled: open && debouncedQ.trim().length > 0,
  })

  const pick = async (file: ArchiveSearchResult) => {
    setDownloadingId(file.id)
    try {
      // Same-origin (backend-ul nostru streamuiește din R2), NU URL-ul presemnat direct — R2 nu
      // aplică CORS pe endpoint-ul S3 folosit de presigning, fetch()-ul din browser era blocat.
      const attachment = await fileFromUrl(`/api/archive/files/${file.id}/download`, file.name)
      onSelect(attachment)
      onOpenChange(false)
      setQ('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Atașare din arhivă eșuată')
    } finally {
      setDownloadingId(null)
    }
  }

  // Thumbnail-ul din listă e mic (149.3 KB) — nu suficient ca Stefan să verifice complet
  // documentul înainte de atașare (feedback direct). Deschide fișierul REAL într-un tab nou
  // (URL presemnat, același endpoint ca la atașare, doar că aici nu descărcăm/atașăm nimic).
  const preview = async (file: ArchiveSearchResult) => {
    setPreviewingId(file.id)
    try {
      const { url } = await api.get<ArchiveDownloadUrl>(`/api/archive/files/${file.id}/download-url`)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Previzualizare eșuată')
    } finally {
      setPreviewingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Atașează din Arhivă</DialogTitle>
        </DialogHeader>
        {/* min-w-0 obligatoriu aici — DialogContent e display:grid, iar un grid item ia
            implicit min-width:auto (mărimea min-content a textului nowrap din interior), care
            împinge tot dialogul mai lat decât max-w-lg în loc să lase `truncate` să taie textul
            (bug Stefan — titluri/path-uri lungi ieșeau la dreapta din popup). */}
        <div className="min-w-0 space-y-3">
          <Input autoFocus placeholder="Caută un document…" value={q} onChange={(e) => setQ(e.target.value)} />
          {!debouncedQ.trim() ? (
            <p className="text-sm text-muted-foreground">Scrie ca să cauți în Arhivă.</p>
          ) : results.isPending ? (
            <p className="text-sm text-muted-foreground">Se caută…</p>
          ) : results.isError ? (
            <p className="text-sm text-destructive">Căutare eșuată.</p>
          ) : !results.data?.length ? (
            <p className="text-sm text-muted-foreground">Niciun rezultat.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {results.data.map((file) => (
                <li key={file.id} className="flex items-center gap-1 rounded-md border hover:bg-muted">
                  <button
                    type="button"
                    disabled={downloadingId !== null}
                    onClick={() => void pick(file)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-50"
                  >
                    {file.previewUrl ? (
                      <img src={file.previewUrl} alt="" className="h-9 w-9 shrink-0 rounded border object-cover" />
                    ) : (
                      <FileIcon className="h-9 w-9 shrink-0 rounded border p-1.5 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{file.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {file.folderPath.map((f) => f.name).join(' / ') || 'Rădăcină'} · {formatBytes(file.sizeBytes)}
                      </span>
                    </span>
                    {downloadingId === file.id ? <span className="shrink-0 text-xs text-muted-foreground">Se adaugă…</span> : null}
                  </button>
                  <button
                    type="button"
                    title="Deschide documentul complet într-un tab nou"
                    disabled={previewingId !== null}
                    onClick={() => void preview(file)}
                    className="mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-background disabled:opacity-50"
                  >
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
