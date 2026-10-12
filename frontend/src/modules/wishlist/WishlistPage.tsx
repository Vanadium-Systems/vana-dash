import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { cn } from '@/shared/lib/utils'
import { api } from '@/shared/lib/api'
import { formatNumber } from '@/shared/lib/utils'
import type { WishlistCategory, WishlistItem, WishlistResponse, WishlistScope } from '@/shared/lib/types'
import { WishlistItemFormDialog } from './WishlistItemFormDialog'

const TABS = [
  { key: 'all', label: 'Toate' },
  { key: 'necesitate', label: 'Necesități' },
  { key: 'placere', label: 'Plăceri' },
] as const

const SCOPES = [
  { key: 'all', label: 'Toate' },
  { key: 'personal', label: 'Personal' },
  { key: 'firma', label: 'Firmă' },
] as const

function scopeLabel(scope: WishlistScope): string {
  return scope === 'personal' ? 'Personal' : 'Firmă'
}

/** Totalul unei singure combinații categorie×scope — niciodată combinat, ca să rămână separat personal/firmă (cerință explicită Stefan, 2026-07-24). */
function scopeTotal(totals: WishlistResponse['totals'], category: WishlistCategory, scope: WishlistScope): number {
  return totals.find((t) => t.category === category && t.scope === scope)?.total ?? 0
}

const PRIORITY_STYLES: Record<WishlistItem['priority'], string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-warning text-warning-foreground dark:border-warning/40 dark:bg-transparent dark:text-warning',
  high: 'bg-destructive text-destructive-foreground',
}

function PurchaseDialog({
  item,
  onOpenChange,
}: {
  item: WishlistItem | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [addExpense, setAddExpense] = useState(false)

  const purchase = useMutation({
    mutationFn: () => api.post<WishlistItem>(`/api/wishlist/${item?.id}/purchase`, { addExpense }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] })
      toast.success('Marcat ca cumpărat')
      onOpenChange(false)
      setAddExpense(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marchează „{item?.title}" ca cumpărat</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={addExpense}
              onChange={(e) => setAddExpense(e.target.checked)}
            />
            Adaugă și ca cheltuială în Facturi ({item?.estimatedPrice ?? '—'} {item?.currency})
          </label>
          <Button className="w-full" disabled={purchase.isPending} onClick={() => purchase.mutate()}>
            {purchase.isPending ? 'Se salvează…' : 'Confirmă'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function WishlistPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = (searchParams.get('tip') as (typeof TABS)[number]['key']) ?? 'all'
  const scopeTab = (searchParams.get('scope') as (typeof SCOPES)[number]['key']) ?? 'all'
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<WishlistItem | null>(null)
  const [purchasingItem, setPurchasingItem] = useState<WishlistItem | null>(null)

  const params = new URLSearchParams()
  if (tab !== 'all') params.set('category', tab)
  if (scopeTab !== 'all') params.set('scope', scopeTab)
  const query = params.toString()
  const wishlist = useQuery({
    queryKey: ['wishlist', tab, scopeTab],
    queryFn: () => api.get<WishlistResponse>(`/api/wishlist${query ? `?${query}` : ''}`),
  })

  const openCreate = () => {
    setEditingItem(null)
    setDialogOpen(true)
  }
  const openEdit = (item: WishlistItem) => {
    setEditingItem(item)
    setDialogOpen(true)
  }

  const setTab = (key: (typeof TABS)[number]['key']) => {
    const next = new URLSearchParams(searchParams)
    // `tip`, nu `tab`: pagina stă sub Notițe, unde `?tab=` alege Notițe / Plan / Wishlist.
    if (key === 'all') next.delete('tip')
    else next.set('tip', key)
    setSearchParams(next)
  }
  const setScopeTab = (key: (typeof SCOPES)[number]['key']) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'all') next.delete('scope')
    else next.set('scope', key)
    setSearchParams(next)
  }

  const totals = wishlist.data?.totals ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wishlist"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Item nou
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cât mai ai de cumpărat — necesități</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-6">
            <div>
              <div className="text-xs text-muted-foreground">Personal</div>
              <div className="text-xl font-bold">{formatNumber(scopeTotal(totals, 'necesitate', 'personal'), 'RON')}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Firmă</div>
              <div className="text-xl font-bold">{formatNumber(scopeTotal(totals, 'necesitate', 'firma'), 'RON')}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cât mai ai de cumpărat — plăceri</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-6">
            <div>
              <div className="text-xs text-muted-foreground">Personal</div>
              <div className="text-xl font-bold">{formatNumber(scopeTotal(totals, 'placere', 'personal'), 'RON')}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Firmă</div>
              <div className="text-xl font-bold">{formatNumber(scopeTotal(totals, 'placere', 'firma'), 'RON')}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Medii separate — Personal/Firmă e independent de Necesități/Plăceri (cerință
          explicită Stefan, 2026-07-22): două rânduri de tab-uri, nu unul combinat, ca să poți
          filtra pe oricare din cele 2 axe fără să pierzi cealaltă. */}
      <Tabs value={scopeTab} onValueChange={(v) => setScopeTab(v as (typeof SCOPES)[number]['key'])}>
        <TabsList>
          {SCOPES.map((s) => (
            <TabsTrigger key={s.key} value={s.key}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number]['key'])}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-6">
          {wishlist.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !wishlist.data?.items.length ? (
            <p className="text-sm text-muted-foreground">Niciun item în listă.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Titlu</TableHead>
                  {scopeTab === 'all' ? <TableHead>Personal/Firmă</TableHead> : null}
                  <TableHead>Categorie</TableHead>
                  <TableHead>Prioritate</TableHead>
                  <TableHead className="text-right">Preț estimat</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wishlist.data.items.map((item, i) => (
                  <TableRow
                    key={item.id}
                    className={cn('animate-in fade-in-0 duration-200 ease-out', item.purchased ? 'opacity-60' : '')}
                    style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {item.title}
                        {item.link ? (
                          <a href={item.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </a>
                        ) : null}
                      </div>
                    </TableCell>
                    {scopeTab === 'all' ? (
                      <TableCell>
                        <Badge variant="outline">{scopeLabel(item.scope)}</Badge>
                      </TableCell>
                    ) : null}
                    <TableCell className="capitalize">{categoryLabel(item.category)}</TableCell>
                    <TableCell>
                      <Badge className={PRIORITY_STYLES[item.priority]}>{priorityLabel(item.priority)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {item.estimatedPrice ? `${Number(item.estimatedPrice).toLocaleString('ro-RO')} ${item.currency}` : '—'}
                    </TableCell>
                    <TableCell>
                      {item.purchased ? <Badge variant="success">Cumpărat</Badge> : <Badge variant="outline">În listă</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {!item.purchased ? (
                          <Button variant="outline" onClick={() => setPurchasingItem(item)}>
                            Marchează cumpărat
                          </Button>
                        ) : null}
                        <Button variant="outline" onClick={() => openEdit(item)}>
                          Editează
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

      <WishlistItemFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editingItem}
        defaultScope={scopeTab === 'all' ? undefined : scopeTab}
      />
      <PurchaseDialog item={purchasingItem} onOpenChange={(open) => !open && setPurchasingItem(null)} />
    </div>
  )
}

function categoryLabel(category: WishlistCategory): string {
  return category === 'necesitate' ? 'Necesitate' : 'Plăcere'
}

function priorityLabel(priority: WishlistItem['priority']): string {
  return { low: 'Scăzută', medium: 'Medie', high: 'Ridicată' }[priority]
}
