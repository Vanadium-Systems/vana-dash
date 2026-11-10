import { Download, Loader2 } from 'lucide-react'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { ROW_ERROR_TEXTS, labelOf } from './use-import'
import type { ImportResult } from './types'

/** Rows the server turned down, as a CSV the person can fix and upload again. */
function downloadErrors(errors: ImportResult['errors']) {
  const lines = [`${t('clients:import.preview.line')},${t('clients:import.result.reason')}`, ...errors.map((e) => `${e.line},${labelOf(ROW_ERROR_TEXTS, e.code)}`)]
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'import-errors.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** The commit runs in batches of 500 on the server and answers once, so the wait has no percentage. */
export function RunningStep({ total }: { total: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium" aria-live="polite">
          {t('clients:import.running.title', { count: total })}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('clients:import.running.hint')}</p>
      </CardContent>
    </Card>
  )
}

export function ResultStep({ result, failure, onList, onAnother }: { result: ImportResult | null; failure: string | null; onList: () => void; onAnother: () => void }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {failure ? (
          // Batches already written stay written; re-uploading the file shows them as "complete existing".
          <Alert tone="critical" title={t('clients:import.result.failedTitle')}>
            {failure} {t('clients:import.result.failedHint')}
          </Alert>
        ) : null}
        {result ? (
          <>
            <p className="text-sm font-medium tabular-nums">
              {t('clients:import.result.summary', { created: formatNumber(result.created), updated: formatNumber(result.updated) })}
            </p>
            {result.skipped > 0 ? <p className="text-sm text-muted-foreground">{t('clients:import.preview.skipped', { count: result.skipped })}</p> : null}
            {result.errors.length > 0 ? (
              <Alert tone="warning" title={t('clients:import.result.errors', { count: result.errors.length })} action={
                <Button type="button" variant="outline" size="sm" onClick={() => downloadErrors(result.errors)}>
                  <Download aria-hidden="true" /> {t('clients:import.result.downloadErrors')}
                </Button>
              }>
                {t('clients:import.result.errorsHint')}
              </Alert>
            ) : null}
          </>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onAnother}>
            {t('clients:import.result.another')}
          </Button>
          <Button type="button" onClick={onList}>
            {t('clients:import.result.openList')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
