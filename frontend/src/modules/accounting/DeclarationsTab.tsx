import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { DeclarationPreview } from '@/shared/lib/types'
import { formatDate, formatMoney } from './badges'
import { t } from '@/shared/lib/i18n'

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.data.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{l.counterpartyName || '—'}</TableCell>
                    <TableCell>{l.counterpartyCountry ?? '—'}</TableCell>
                    <TableCell>{l.documentNumber}</TableCell>
                    <TableCell>{formatDate(l.issuedAt)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(l.amountForeign, l.currency)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(l.baseRon, 'RON')}</TableCell>
                    {showVat ? (
                      <TableCell className="text-right font-mono text-sm">{formatMoney(l.vatRon, 'RON')}</TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-6 border-t pt-3 text-sm font-medium">
              <span>{t('accounting:declarations.totalBase', { baseRon: formatMoney(preview.data.totals.baseRon, 'RON') })}</span>
              {showVat ? <span>{t('accounting:declarations.totalVat', { vatRon: formatMoney(preview.data.totals.vatRon, 'RON') })}</span> : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// D301 (decont special TVA) + D390 (recapitulativă VIES) — Sprint D, Track A. XML-ul generat e
// gata de semnat electronic — depunerea în SPV rămâne manuală (semnătură calificată), fără API
// de upload direct confirmat la research.
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
