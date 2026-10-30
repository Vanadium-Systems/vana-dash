import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Link2Off, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { PlatformStatusBadge } from '@/shared/components/PlatformStatusBadge'
import { api } from '@/shared/lib/api'
import type { BankAccount, BankTransactionRow } from '@/shared/lib/types'
import { formatDate, formatMoney } from '../accounting/badges'
import { BankAccountFormDialog } from './BankAccountFormDialog'
import { useMe } from '@/shared/hooks/use-me'
import { MatchDialog } from './MatchDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

export function ConturiTab() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null)
  const { can } = useMe()
  const canMatch = can('reconciliere.potrivire')
  const [unmatchedOnly, setUnmatchedOnly] = useState(true)
  const [matching, setMatching] = useState<BankTransactionRow | null>(null)

  const accounts = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => api.get<BankAccount[]>('/api/reconciliation/accounts'),
  })

  const transactions = useQuery({
    queryKey: ['reconciliation', 'transactions', unmatchedOnly],
    queryFn: () =>
      api.get<BankTransactionRow[]>(`/api/reconciliation/transactions?unmatchedOnly=${unmatchedOnly}`),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
    void queryClient.invalidateQueries({ queryKey: ['reconciliation'] })
  }

  const syncNow = useMutation({
    mutationFn: (id: string) => api.post(`/api/reconciliation/accounts/${id}/sync`),
    onSuccess: () => {
      invalidate()
      toast.success(t('reconciliation:accounts.syncDone'))
    },
    onError: (err) => toast.error(err.message),
  })

  const removeAccount = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/reconciliation/accounts/${id}`),
    onSuccess: () => {
      invalidate()
      toast.success(t('reconciliation:accounts.deleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  const unmatch = useMutation({
    mutationFn: (txnId: string) => api.delete<void>(`/api/reconciliation/transactions/${txnId}/match`),
    onSuccess: () => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success(t('reconciliation:transactions.matchCancelled'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button
          onClick={() => {
            setEditingAccount(null)
            setAccountDialogOpen(true)
          }}
        >
          <Plus className="h-4 w-4" /> {t('reconciliation:account.add')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('reconciliation:accounts.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : !accounts.data?.length ? (
            <p className="text-sm text-muted-foreground">
              {t('reconciliation:accounts.empty')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.name')}</TableHead>
                  <TableHead priority="md">{t('reconciliation:labels.provider')}</TableHead>
                  <TableHead priority="lg">{t('common:labels.currency')}</TableHead>
                  <TableHead>{t('common:labels.status')}</TableHead>
                  <TableHead priority="md">{t('reconciliation:accounts.lastSync')}</TableHead>
                  <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.data.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium tbl-fill">
                      <div className="truncate">{account.name}</div>
                      <TableDetails items={[account.provider, account.currency]} />
                    </TableCell>
                    <TableCell priority="md">{account.provider}</TableCell>
                    <TableCell priority="lg">{account.currency}</TableCell>
                    <TableCell>
                      <PlatformStatusBadge status={account.healthStatus} />
                    </TableCell>
                    <TableCell priority="md" className="whitespace-nowrap">
                      {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString(intlTag()) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        actions={[
                          { key: 'sync', icon: RefreshCw, label: t('reconciliation:accounts.syncNow'), disabled: syncNow.isPending, spinning: syncNow.isPending, onClick: () => syncNow.mutate(account.id) },
                          {
                            key: 'edit',
                            icon: Pencil,
                            label: t('common:actions.edit'),
                            onClick: () => {
                              setEditingAccount(account)
                              setAccountDialogOpen(true)
                            },
                          },
                          {
                            key: 'delete',
                            icon: Trash2,
                            label: t('common:actions.delete'),
                            destructive: true,
                            onClick: () => {
                              void confirm({ title: t('reconciliation:accounts.deleteTitle', { name: account.name }), consequence: t('reconciliation:accounts.deleteBody'), confirmLabel: t('reconciliation:accounts.deleteConfirm'), destructive: true }).then((ok) => ok && removeAccount.mutate(account.id))
                            },
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('reconciliation:transactions.title')}</CardTitle>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={unmatchedOnly}
                onChange={(e) => setUnmatchedOnly(e.target.checked)}
              />
              {t('reconciliation:transactions.onlyUnmatched')}
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {transactions.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !transactions.data?.length ? (
            unmatchedOnly ? (
              <EmptyState kind="filtered" title={t('reconciliation:transactions.allMatchedTitle')} description={t('reconciliation:transactions.allMatchedHint')} onReset={() => setUnmatchedOnly(false)} />
            ) : (
              <EmptyState kind="new" title={t('reconciliation:transactions.emptyTitle')} description={t('reconciliation:transactions.emptyHint')} />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead priority="md">{t('common:labels.date')}</TableHead>
                  <TableHead>{t('reconciliation:transactions.counterparty')}</TableHead>
                  <TableHead priority="lg">{t('reconciliation:transactions.reference')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.amount')}</TableHead>
                  <TableHead priority="md">{t('reconciliation:transactions.match')}</TableHead>
                  <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.data.map((txn) => (
                  <TableRow
                    key={txn.id}
                    className="animate-in fade-in-0 duration-200 ease-out"
                  >
                    <TableCell priority="md" className="whitespace-nowrap">{formatDate(txn.valueDate)}</TableCell>
                    <TableCell className="font-medium tbl-fill">
                      <div className="truncate">{txn.counterpartyName ?? '—'}</div>
                      <TableDetails items={[formatDate(txn.valueDate), txn.match?.id ? (txn.match.documentNumber ?? txn.match.financialRecordId) : null]} />
                    </TableCell>
                    <TableCell priority="lg" className="max-w-xs truncate text-xs text-muted-foreground" title={txn.reference ?? ''}>
                      {txn.reference ?? '—'}
                    </TableCell>
                    <TableCell
                      className={
                        txn.direction === 'in'
                          ? 'whitespace-nowrap text-right font-mono text-sm tnum text-success'
                          : 'whitespace-nowrap text-right font-mono text-sm tnum text-muted-foreground'
                      }
                    >
                      {txn.direction === 'in' ? '+' : '−'}
                      {formatMoney(txn.amount, txn.currency)}
                    </TableCell>
                    <TableCell priority="md">
                      {txn.match?.id ? (
                        <span className="text-xs">
                          {txn.match.documentNumber ?? txn.match.financialRecordId}
                          <span className="ml-1 text-muted-foreground">
                            (
                            {txn.match.matchType === 'auto' ? (
                              <>
                                <span className="mr-1 inline-block h-1 w-10 translate-y-[-3px] overflow-hidden rounded-full bg-muted align-middle">
                                  <span
                                    className="block h-full bg-success"
                                    style={{ width: `${Math.round(Number(txn.match.confidence) * 100)}%` }}
                                  />
                                </span>
                                {t('reconciliation:transactions.auto')} {Number(txn.match.confidence).toFixed(2)}
                              </>
                            ) : (
                              t('reconciliation:transactions.manual')
                            )}
                            )
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {/* Potrivirea manuală e cu tot alta funcționalitate decât citirea
                            tranzacțiilor: cine vede bankul nu o poate face automat. */}
                        {canMatch && txn.match?.id ? (
                          <Button
                            variant="outline"
                            title={t('reconciliation:transactions.cancelMatch')}
                            disabled={unmatch.isPending}
                            onClick={() => unmatch.mutate(txn.id)}
                          >
                            <Link2Off className="h-4 w-4" />
                          </Button>
                        ) : canMatch && txn.direction === 'in' ? (
                          <Button variant="outline" title={t('reconciliation:match.manual')} onClick={() => setMatching(txn)}>
                            <Link2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <BankAccountFormDialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen} account={editingAccount} />
      <MatchDialog open={Boolean(matching)} onOpenChange={(open) => !open && setMatching(null)} transaction={matching} />
    </div>
  )
}
