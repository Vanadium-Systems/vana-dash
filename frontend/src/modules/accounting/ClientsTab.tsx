import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { BillingClient } from '@/shared/lib/types'
import { ClientFormDialog } from './ClientFormDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { t } from '@/shared/lib/i18n'

const PENDING_DELETION_PURGE_DAYS = 30

/** Zile rămase până la purjarea locală automată (jobs/vanagreen-tenant-sync.ts,
 *  purgePendingDeletionClients) — sincron cu fereastra de 30 zile din vanagreen. */
function daysUntilPurge(pendingDeletionAt: string): number {
  const elapsedMs = Date.now() - new Date(pendingDeletionAt).getTime()
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000))
  return Math.max(0, PENDING_DELETION_PURGE_DAYS - elapsedDays)
}

interface ClientsTableProps {
  clients: BillingClient[]
  showDemoEndsAt?: boolean
  showPendingDeletion?: boolean
  onEdit: (c: BillingClient) => void
  onDelete: (c: BillingClient) => void
}

function ClientsTable({ clients, showDemoEndsAt, showPendingDeletion, onEdit, onDelete }: ClientsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('accounting:clientForm.name')}</TableHead>
          <TableHead>{t('common:labels.cif')}</TableHead>
          <TableHead>{t('common:labels.address')}</TableHead>
          <TableHead>IBAN</TableHead>
          <TableHead>{t('common:labels.email')}</TableHead>
          <TableHead>Vanagreen</TableHead>
          {showDemoEndsAt && <TableHead>{t('accounting:clients.demoUntil')}</TableHead>}
          {showPendingDeletion && <TableHead>{t('accounting:clients.deletedIn')}</TableHead>}
          <TableHead className="text-right">{t('common:labels.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">
              {c.name}
              {c.needsBillingInfo && <StatePill tone="warning" className="ml-2">{t('accounting:clients.incomplete')}</StatePill>}
            </TableCell>
            <TableCell className="font-mono text-xs">{c.cif}</TableCell>
            <TableCell className="max-w-xs truncate">{c.address}</TableCell>
            <TableCell className="font-mono text-xs">{c.iban ?? '—'}</TableCell>
            <TableCell>{c.email ?? '—'}</TableCell>
            <TableCell>
              {c.vanagreenTenantId ? (
                <StatePill tone="success">{t('accounting:clients.mapped')}{c.autoInvoiceEnabled ? t('accounting:clients.plusAuto') : ''}</StatePill>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
            {showDemoEndsAt && (
              <TableCell className="text-xs text-muted-foreground">{c.demoEndsAt ?? '—'}</TableCell>
            )}
            {showPendingDeletion && (
              <TableCell>
                {c.pendingDeletionAt ? (
                  <StatePill tone="critical">{t('common:count.days', { count: daysUntilPurge(c.pendingDeletionAt) })}</StatePill>
                ) : (
                  '—'
                )}
              </TableCell>
            )}
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onEdit(c)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => onDelete(c)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function ClientsTab() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BillingClient | null>(null)

  const clients = useQuery({
    queryKey: ['billing-clients'],
    queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients'),
  })

  // 2026-08-03 — tenanți demo vanagreen (jobs/vanagreen-tenant-sync.ts), afișați separat de
  // clienții reali până se convertesc (fie din vanagreen, fie printr-o plată confirmată de-aici
  // — vezi VANAGREEN.md). Rândul e un billing_client normal (isDemo:true), reutilizează exact
  // același dialog de editare/ștergere ca tabelul de mai sus.
  const demoClients = useQuery({
    queryKey: ['billing-clients', 'demo'],
    queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients/demo'),
  })

  // 2026-08-11 — tenanți reziliați în vanagreen, în fereastra de 30 zile înainte de purjare
  // locală automată (jobs/vanagreen-tenant-sync.ts). Separat de tabelul principal ca Stefan să
  // prindă din timp o facturare neregularizată înainte ca rândul să dispară singur.
  const pendingDeletionClients = useQuery({
    queryKey: ['billing-clients', 'pending-deletion'],
    queryFn: () => api.get<BillingClient[]>('/api/invoicing/clients/pending-deletion'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/invoicing/clients/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing-clients'] })
      toast.success(t('accounting:clients.deleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  // Rulare manuală a jobs/vanagreen-tenant-sync.ts (cronul zilnic la 06:30) — nu mai aștepți
  // până a doua zi ca un client nou/modificat în vanagreen să apară aici.
  const syncVanagreen = useMutation({
    mutationFn: () => api.post('/api/invoicing/clients/sync-vanagreen'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing-clients'] })
      toast.success(t('accounting:clients.syncedWithVanagreen'))
    },
    onError: (err) => toast.error(err.message),
  })

  const needingBillingInfo = clients.data?.filter((c) => c.needsBillingInfo) ?? []

  const openEdit = (c: BillingClient) => {
    setEditing(c)
    setDialogOpen(true)
  }
  const askDelete = (c: BillingClient) => {
    void confirm({ title: t('accounting:clients.deleteTitle', { name: c.name }), consequence: t('accounting:clients.deleteBody'), confirmLabel: t('accounting:clients.deleteConfirm'), destructive: true }).then((ok) => ok && remove.mutate(c.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={syncVanagreen.isPending} onClick={() => syncVanagreen.mutate()}>
          <RefreshCw className={syncVanagreen.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          {t('accounting:clients.syncWithVanagreen')}
        </Button>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="h-4 w-4" /> {t('accounting:clients.add')}
        </Button>
      </div>
      {needingBillingInfo.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning dark:bg-transparent">
          {t('accounting:clients.needBillingInfo', { count: needingBillingInfo.length, names: needingBillingInfo.map((c) => c.name).join(', ') })}
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          {clients.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !clients.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('accounting:clients.empty')}</p>
          ) : (
            <ClientsTable clients={clients.data} onEdit={openEdit} onDelete={askDelete} />
          )}
        </CardContent>
      </Card>

      {(demoClients.isPending || (demoClients.data?.length ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {t('accounting:clients.demoTitle')}
              <StatePill tone="neutral">{t('accounting:clients.fromVanagreen')}</StatePill>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-3 text-sm text-muted-foreground">
              {t('accounting:clients.demoHint')}
            </p>
            {demoClients.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ClientsTable clients={demoClients.data ?? []} showDemoEndsAt onEdit={openEdit} onDelete={askDelete} />
            )}
          </CardContent>
        </Card>
      )}

      {(pendingDeletionClients.isPending || (pendingDeletionClients.data?.length ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {t('accounting:clients.pendingDeletionTitle')}
              <StatePill tone="critical">{t('accounting:clients.terminatedInVanagreen')}</StatePill>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-3 text-sm text-muted-foreground">
              {t('accounting:clients.pendingDeletionHint')}
            </p>
            {pendingDeletionClients.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ClientsTable clients={pendingDeletionClients.data ?? []} showPendingDeletion onEdit={openEdit} onDelete={askDelete} />
            )}
          </CardContent>
        </Card>
      )}

      <ClientFormDialog open={dialogOpen} onOpenChange={setDialogOpen} client={editing} />
    </div>
  )
}
