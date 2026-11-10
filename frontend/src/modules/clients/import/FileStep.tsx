import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { api } from '@/shared/lib/api'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { IMPORT_EXTENSIONS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from './types'

const hasAllowedExtension = (name: string) => IMPORT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))

export function FileStep({ pending, error, onFile }: { pending: boolean; error: string | null; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const pick = (file: File | undefined) => {
    if (!file) return
    if (!hasAllowedExtension(file.name)) return setLocalError(t('clients:import.file.badType'))
    if (file.size > IMPORT_MAX_BYTES) return setLocalError(t('clients:import.file.tooBig'))
    setLocalError(null)
    onFile(file)
  }

  const shownError = localError ?? error

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm text-muted-foreground">{t('clients:import.file.rules', { rows: formatNumber(IMPORT_MAX_ROWS) })}</p>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            pick(e.dataTransfer.files[0])
          }}
          className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center', over && 'bg-accent')}
        >
          {pending ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" /> : <FileSpreadsheet className="h-6 w-6 text-muted-foreground" aria-hidden="true" />}
          <p className="text-sm" aria-live="polite">
            {pending ? t('clients:import.file.reading') : t('clients:import.file.drop')}
          </p>
          <input ref={input} type="file" accept={IMPORT_EXTENSIONS.join(',')} className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
          <Button type="button" disabled={pending} onClick={() => input.current?.click()}>
            {t('clients:import.file.choose')}
          </Button>
        </div>
        {shownError ? <Alert tone="critical">{shownError}</Alert> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <p className="text-sm text-muted-foreground">{t('clients:import.file.templateHint')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void api.download('/api/prospects/import/template.xlsx', 'prospects-template.xlsx').catch((err: Error) => toast.error(err.message))}
          >
            <Download aria-hidden="true" /> {t('clients:import.file.template')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
