import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Link2Off, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { PlatformStatusBadge } from '@/shared/components/PlatformStatusBadge'
import { api } from '@/shared/lib/api'
import type { BankAccount, BankTransactionRow } from '@/shared/lib/types'
import { formatDate, formatMoney } from '../accounting/badges'
import { BankAccountFormDialog } from './BankAccountFormDialog'
import { useMe } from '@/shared/hooks/use-me'
import { MatchDialog } from './MatchDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'

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
      toast.success('Sync bancar rulat')
    },
    onError: (err) => toast.error(err.message),
  })

  const removeAccount = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/reconciliation/accounts/${id}`),
    onSuccess: () => {
      invalidate()
      toast.success('Cont șters')
    },
    onError: (err) => toast.error(err.message),
  })

  const unmatch = useMutation({
    mutationFn: (txnId: string) => api.delete<void>(`/api/reconciliation/transactions/${txnId}/match`),
    onSuccess: () => {
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['accounting'] })
      toast.success('Match anulat — factura readusă la neplătită')
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
          <Plus className="h-4 w-4" /> Adaugă cont bancar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conturi bancare</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : !accounts.data?.length ? (
            <p className="text-sm text-muted-foreground">
              Niciun cont conectat. Adaugă contul Revolut Business — cheia OAuth se configurează separat, în tab-ul
              Setări.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nume</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Monedă</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ultimul sync</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.data.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">{account.name}</TableCell>
                    <TableCell>{account.provider}</TableCell>
                    <TableCell>{account.currency}</TableCell>
                    <TableCell>
                      <PlatformStatusBadge status={account.healthStatus} />
                    </TableCell>
                    <TableCell>
                      {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString('ro-RO') : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          title="Sync now"
                          disabled={syncNow.isPending}
                          onClick={() => syncNow.mutate(account.id)}
                        >
                          <RefreshCw className={syncNow.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                        </Button>
                        <Button
                          variant="outline"
                          title="Editează"
                          onClick={() => {
                            setEditingAccount(account)
                            setAccountDialogOpen(true)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          title="Șterge"
                          onClick={() => {
                            void confirm({ title: `Șterge contul „${account.name}”`, consequence: 'Sincronizarea se oprește. Tranzacțiile importate și potrivirile făcute rămân.', confirmLabel: 'Șterge contul', destructive: true }).then((ok) => ok && removeAccount.mutate(account.id))
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
            <CardTitle>Tranzacții</CardTitle>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={unmatchedOnly}
                onChange={(e) => setUnmatchedOnly(e.target.checked)}
              />
              Doar nematchuite
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {transactions.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !transactions.data?.length ? (
            unmatchedOnly ? (
              <EmptyState kind="filtered" title="Toate tranzacțiile sunt potrivite cu facturi" description="Filtrul arată doar ce e nepotrivit." onReset={() => setUnmatchedOnly(false)} />
            ) : (
              <EmptyState kind="new" title="Nicio tranzacție importată încă" description="Apar după primul sync al contului bancar." />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Contrapartidă</TableHead>
                  <TableHead>Referință</TableHead>
                  <TableHead className="text-right">Sumă</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.data.map((txn, i) => (
                  <TableRow
                    key={txn.id}
                    className="animate-in fade-in-0 duration-200 ease-out"
                    style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                  >
                    <TableCell>{formatDate(txn.valueDate)}</TableCell>
                    <TableCell className="font-medium">{txn.counterpartyName ?? '—'}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={txn.reference ?? ''}>
                      {txn.reference ?? '—'}
                    </TableCell>
                    <TableCell
                      className={
                        txn.direction === 'in'
                          ? 'text-right font-mono text-sm tnum text-success'
                          : 'text-right font-mono text-sm tnum text-muted-foreground'
                      }
                    >
                      {txn.direction === 'in' ? '+' : '−'}
                      {formatMoney(txn.amount, txn.currency)}
                    </TableCell>
                    <TableCell>
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
                                auto {Number(txn.match.confidence).toFixed(2)}
                              </>
                            ) : (
                              'manual'
                            )}
                            )
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {/* Potrivirea manuală e cu tot alta funcționalitate decât citirea
                            tranzacțiilor: cine vede bankul nu o poate face automat. */}
                        {canMatch && txn.match?.id ? (
                          <Button
                            variant="outline"
                            title="Anulează match-ul"
                            disabled={unmatch.isPending}
                            onClick={() => unmatch.mutate(txn.id)}
                          >
                            <Link2Off className="h-4 w-4" />
                          </Button>
                        ) : canMatch && txn.direction === 'in' ? (
                          <Button variant="outline" title="Match manual" onClick={() => setMatching(txn)}>
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
