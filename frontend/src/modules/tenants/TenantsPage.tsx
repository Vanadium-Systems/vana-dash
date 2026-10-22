import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Switch } from '@/shared/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { setTenantOverride } from '@/shared/lib/tenant-override'
import type { TenantRow } from './types'

// The companies on this installation, for the platform admin only. Creating a second one is
// refused while RLS is off, so the table shows the platform company alone until isolation is on.
const TENANTS_QUERY_KEY = ['platform', 'tenants']

export function TenantsPage() {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [featuresTarget, setFeaturesTarget] = useState<TenantRow | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<TenantRow | null>(null)

  const query = useQuery({
    queryKey: TENANTS_QUERY_KEY,
    queryFn: () => api.get<TenantRow[]>('/api/platform/tenants'),
  })

  const setStatus = async (tenant: TenantRow, status: 'active' | 'suspended') => {
    try {
      await api.patch(`/api/platform/tenants/${tenant.id}`, { status })
      void queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6" data-density="comfortable">
      <PageHeader
        title={t('tenants:title')}
        description={t('tenants:description')}
        actions={
          <Button onClick={() => setCreating(true)}>
            {t('tenants:newTenant')}
          </Button>
        }
      />

      {query.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="space-y-2 py-6 text-sm">
          <p>{t('tenants:error')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('tenants:retry')}
          </Button>
        </div>
      ) : (
        <>
          <TenantTable rows={query.data ?? []} onFeatures={setFeaturesTarget} onSuspend={setSuspendTarget} onReactivate={(row) => void setStatus(row, 'active')} />
          {query.data?.length === 1 ? <p className="text-sm text-muted-foreground">{t('tenants:empty')}</p> : null}
        </>
      )}

      {creating ? <CreateTenantDialog onClose={() => setCreating(false)} /> : null}
      {featuresTarget ? <FeaturesDialog tenant={featuresTarget} onClose={() => setFeaturesTarget(null)} /> : null}
      <ConfirmDialog
        open={suspendTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSuspendTarget(null)
        }}
        title={t('tenants:suspendConfirm.title', { name: suspendTarget?.name ?? '' })}
        consequence={t('tenants:suspendConfirm.body', { count: suspendTarget?.userCount ?? 0 })}
        confirmLabel={t('tenants:suspendConfirm.action')}
        destructive
        onConfirm={() => {
          if (suspendTarget) void setStatus(suspendTarget, 'suspended')
        }}
      />
    </div>
  )
}

function TenantTable({
  rows,
  onFeatures,
  onSuspend,
  onReactivate,
}: {
  rows: TenantRow[]
  onFeatures: (row: TenantRow) => void
  onSuspend: (row: TenantRow) => void
  onReactivate: (row: TenantRow) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('tenants:columns.name')}</TableHead>
          <TableHead>{t('tenants:columns.cif')}</TableHead>
          <TableHead className="text-right">{t('tenants:columns.users')}</TableHead>
          <TableHead>{t('tenants:columns.features')}</TableHead>
          <TableHead>{t('tenants:columns.status')}</TableHead>
          <TableHead>{t('tenants:columns.created')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('common:labels.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="group">
            <TableCell className="min-w-[12rem]">
              <span className="block font-medium">{row.name}</span>
              {row.isPlatformOwner ? <span className="block text-xs text-muted-foreground">{t('tenants:owner')}</span> : null}
            </TableCell>
            <TableCell className="text-muted-foreground">{row.cif || '–'}</TableCell>
            <TableCell className="text-right tabular-nums">{row.userCount}</TableCell>
            <TableCell className="text-muted-foreground">
              {row.isPlatformOwner ? t('tenants:allFeatures') : t('tenants:featureCount', { count: row.features.length })}
            </TableCell>
            <TableCell>
              <StatePill tone={row.status === 'active' ? 'success' : 'warning'}>{t(`tenants:status.${row.status}`)}</StatePill>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
            <TableCell className="min-w-[10rem]">
              {row.isPlatformOwner ? null : (
                <div className="flex flex-wrap gap-1">
                  {/* `Deschide` stă tot timpul: mutarea în contul altei firme trebuie să se vadă
                      și pe ecran fără mouse. Restul apare la hover sau la focus, ca să nu
                      încrăcăm rândul. */}
                  <Button size="sm" variant="outline" onClick={() => setTenantOverride({ id: row.id, name: row.name })}>
                    {t('tenants:actions.open')}
                  </Button>
                  <div className="flex flex-wrap gap-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                    <Button size="sm" variant="outline" onClick={() => onFeatures(row)}>
                      {t('tenants:actions.features')}
                    </Button>
                    {row.status === 'active' ? (
                      <Button size="sm" variant="outline" onClick={() => onSuspend(row)}>
                        {t('tenants:actions.suspend')}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onReactivate(row)}>
                        {t('tenants:actions.reactivate')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function CreateTenantDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [cif, setCif] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const create = async () => {
    setSaving(true)
    setServerError(null)
    try {
      await api.post<TenantRow>('/api/platform/tenants', { name, cif: cif || undefined })
      void queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY })
      onClose()
    } catch (err) {
      // The server refuses with 409 while isolation is off; the typed values stay so the admin
      // can retry after enabling RLS.
      setServerError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">{t('tenants:dialog.title')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim()) {
              setNameError(t('tenants:dialog.nameRequired'))
              return
            }
            setNameError(null)
            void create()
          }}
        >
          <Field label={t('tenants:dialog.name')} error={nameError}>
            <Input value={name} onChange={(event) => setName(event.target.value.trim())} />
          </Field>
          <Field label={t('tenants:dialog.cif')} optional>
            <Input value={cif} onChange={(event) => setCif(event.target.value.trim())} />
          </Field>
          {serverError ? <p className="text-xs text-destructive-text">{serverError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('tenants:dialog.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('tenants:dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface CatalogFeature {
  key: string
  label: string
  ownerOnly: boolean
}

interface CatalogPage {
  page: string
  label: string
  features: CatalogFeature[]
}

function FeaturesDialog({ tenant, onClose }: { tenant: TenantRow; onClose: () => void }) {
  const queryClient = useQueryClient()
  const catalog = useQuery({
    queryKey: ['access', 'catalog'],
    queryFn: () => api.get<CatalogPage[]>('/api/access/catalog'),
  })
  const [features, setFeatures] = useState<string[]>(tenant.features)

  const toggle = async (key: string, enabled: boolean) => {
    try {
      const data = await api.put<{ features: string[] }>(`/api/platform/tenants/${tenant.id}/features/${key}`, { enabled })
      setFeatures(data.features)
      void queryClient.invalidateQueries({ queryKey: TENANTS_QUERY_KEY })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // Labels come from the access catalog. If that route is not there, we can only show the keys
  // already on the row, so a switch can turn a feature off but never name a new one.
  const items = catalog.data
    ? catalog.data.flatMap((page) => page.features).filter((feature) => !feature.ownerOnly)
    : tenant.features.map((key) => ({ key, label: key, ownerOnly: false }))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">{t('tenants:featuresDialog.title', { name: tenant.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('tenants:featuresDialog.hint')}</p>
        <ul className="divide-y">
          {items.map((feature) => (
            <li key={feature.key} className="flex min-h-10 items-center gap-3 py-2">
              <Switch
                checked={features.includes(feature.key)}
                onCheckedChange={(checked) => void toggle(feature.key, checked)}
                label={feature.label}
              />
              <span className="min-w-0 flex-1 text-sm">{feature.label}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>{t('tenants:featuresDialog.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
