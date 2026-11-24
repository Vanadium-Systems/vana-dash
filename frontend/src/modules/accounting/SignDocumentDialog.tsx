import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { api } from '@/shared/lib/api'
import type { ContractDocument } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'
import { toastError } from '@/shared/lib/errors'

interface SignDocumentDialogProps {
  doc: ContractDocument | null
  onOpenChange: (open: boolean) => void
}

// Signing with the certSIGN token runs on the signer's own machine, not on the server: the dash only
// takes the signed PDF back as a new version of the document.
export function SignDocumentDialog({ doc, onOpenChange }: SignDocumentDialogProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadSigned = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.upload<ContractDocument>(`/api/contracts/documents/${doc!.id}/signed`, fd)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contract-documents'] })
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      toast.success(t('accounting:sign.uploaded'))
      onOpenChange(false)
    },
    onError: (err) => toastError(err),
  })

  if (!doc) return null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('accounting:sign.title')}</DialogTitle>
          <DialogDescription>{t('accounting:sign.hint')}</DialogDescription>
        </DialogHeader>
        <div>
          <Button type="button" disabled={uploadSigned.isPending} onClick={() => fileInputRef.current?.click()}>
            {uploadSigned.isPending ? t('common:states.uploading') : t('accounting:sign.uploadSigned')}
          </Button>
          {/* native: hidden file picker */}
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
      </DialogContent>
    </Dialog>
  )
}
