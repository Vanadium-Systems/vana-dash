import { useQuery } from '@tanstack/react-query'
import { Download, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { DeclarationLine, DeclarationPreview } from '@/shared/lib/types'
import { DeclarationFilingRow } from './DeclarationFilingRow'
import { DeclarationLineDialog } from './DeclarationLineDialog'
import { formatDate, formatMoney } from './badges'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function DeclarationCard({
  title,
  helpText,
  endpoint,
  month,
  showVat,
}: {
  title: string
  helpText: string
  endpoint: 'd301' | 'd390'
  month: string
  showVat: boolean
}) {
  const [editing, setEditing] = useState<DeclarationLine | null>(null)
  const preview = useQuery({
    queryKey: ['accounting', endpoint, month],
    queryFn: () => api.get<DeclarationPreview>(`/api/accounting/${endpoint}?month=${month}`),
  })

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">{helpText}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              disabled={!preview.data?.lines.length}
              onClick={() => window.open(`/api/accounting/${endpoint}/export?month=${month}&format=pdf`, '_blank')}
            >
              <Download className="h-4 w-4" /> PDF
            </Button>
            <Button
              variant="outline"
              disabled={!preview.data?.lines.length}
              onClick={() => window.open(`/api/accounting/${endpoint}/export?month=${month}&format=xml`, '_blank')}
            >
              <Download className="h-4 w-4" /> XML
            </Button>
            <Button
              variant="outline"
              disabled={!preview.data?.lines.length}
              onClick={() => window.open(`/api/accounting/${endpoint}/export?month=${month}&format=csv`, '_blank')}
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        </div>

        {preview.data && (preview.data.lines.length > 0 || preview.data.filing) ? (
          <DeclarationFilingRow endpoint={endpoint} month={month} filing={preview.data.filing} />
        ) : null}

        {preview.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : preview.isError ? (
          <p className="text-sm text-destructive">{t('accounting:declarations.loadFailed', { month })}</p>
        ) : !preview.data.lines.length ? (
          <p className="text-sm text-muted-foreground">{t('accounting:declarations.none', { month })}</p>
        ) : (
          <>
            {preview.data.warnings.length > 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning dark:bg-transparent">
                {preview.data.warnings.map((w, i) => (
                  <p key={i}>⚠ {w}</p>
                ))}
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('accounting:labels.supplier')}</TableHead>
                  <TableHead>{t('common:labels.country')}</TableHead>
                  <TableHead>{t('common:labels.document')}</TableHead>
                  <TableHead>{t('common:labels.date')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.amount')}</TableHead>
                  <TableHead className="text-right">{t('accounting:declarations.baseRon')}</TableHead>
                  {showVat ? <TableHead className="text-right">{t('accounting:declarations.vatRon')}</TableHead> : null}
                  <TableHead className="w-10"><span className="sr-only">{t('common:labels.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.data.lines.map((l, i) => (
                  <TableRow key={i} className={l.confirmed ? 'group' : 'group text-muted-foreground'}>
                    <TableCell className="font-medium">{l.counterpartyName || '—'}</TableCell>
                    <TableCell>{l.counterpartyCountry ?? '—'}</TableCell>
                    <TableCell>
                      {l.confirmed ? (
                        l.documentNumber || '—'
                      ) : (
                        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">{t('accounting:declarations.unconfirmed')}</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(l.issuedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">{formatMoney(l.amountForeign, l.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">{formatMoney(l.baseRon, BASE_CURRENCY)}</TableCell>
                    {showVat ? (
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">{formatMoney(l.vatRon, BASE_CURRENCY)}</TableCell>
                    ) : null}
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('accounting:declarations.edit.open')}
                        className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                        onClick={() => setEditing(l)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-6 border-t pt-3 text-sm font-medium">
              <span>{t('accounting:declarations.totalBase', { baseRon: formatMoney(preview.data.totals.baseRon, BASE_CURRENCY) })}</span>
              {showVat ? <span>{t('accounting:declarations.totalVat', { vatRon: formatMoney(preview.data.totals.vatRon, BASE_CURRENCY) })}</span> : null}
            </div>
          </>
        )}
      </CardContent>
      <DeclarationLineDialog line={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </Card>
  )
}

// D301 (special VAT return) and D390 (VIES recapitulative). The PDF is the ANAF form prefilled,
// signed by hand in Adobe Reader before it goes to SPV.
export function DeclarationsTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const month = searchParams.get('month') ?? currentMonth()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Label htmlFor="decl-month">{t('common:labels.month')}</Label>
        <input
          id="decl-month"
          type="month"
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          value={month}
          onChange={(e) => setSearchParams({ tab: 'declaratii', month: e.target.value })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t('accounting:declarations.signatureNote')}
      </p>
      <DeclarationCard
        title={t('accounting:declarations.d301Title')}
        helpText={t('accounting:declarations.d301Help')}
        endpoint="d301"
        month={month}
        showVat
      />
      <DeclarationCard
        title={t('accounting:declarations.d390Title')}
        helpText={t('accounting:declarations.d390Help')}
        endpoint="d390"
        month={month}
        showVat={false}
      />
    </div>
  )
}
