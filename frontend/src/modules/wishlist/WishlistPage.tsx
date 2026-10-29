import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { formatNumber, intlTag } from '@/shared/lib/format'
import type { WishlistCategory, WishlistItem, WishlistResponse, WishlistScope } from '@/shared/lib/types'
import { WishlistItemFormDialog } from './WishlistItemFormDialog'
import { t } from '@/shared/lib/i18n'
import { approx, MoneyNote } from '@/shared/components/MoneyNote'
import { useMoneyQuery } from '@/shared/hooks/use-money-query'
import { BASE_CURRENCY } from '@/shared/lib/locale'

const TABS = [
  { key: 'all', label: t('common:labels.all') },
  { key: 'necesitate', label: t('wishlist:category.needs') },
  { key: 'placere', label: t('wishlist:category.wants') },
] as const

const SCOPES = [
  { key: 'all', label: t('common:labels.all') },
  { key: 'personal', label: t('common:labels.personal') },
  { key: 'firma', label: t('common:labels.company') },
] as const

function scopeLabel(scope: WishlistScope): string {
  return scope === 'personal' ? t('common:labels.personal') : t('common:labels.company')
}

/** Totalul unei singure combinații categorie×scope — niciodată combinat, ca să rămână separat personal/firmă (cerință explicită Stefan, 2026-07-24). */
function scopeTotal(totals: WishlistResponse['totals'], category: WishlistCategory, scope: WishlistScope): number {
  return totals.find((entry) => entry.category === category && entry.scope === scope)?.total ?? 0
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
      toast.success(t('wishlist:markedBought'))
      onOpenChange(false)
      setAddExpense(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wishlist:markBoughtTitle', { title: item?.title })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={addExpense}
              onChange={(e) => setAddExpense(e.target.checked)}
            />
            {t('wishlist:addAsExpense', { amount: `${item?.estimatedPrice ?? '—'} ${item?.currency ?? ''}`.trim() })}
          </label>
          <Button className="w-full" disabled={purchase.isPending} onClick={() => purchase.mutate()}>
            {purchase.isPending ? t('common:states.saving') : t('common:actions.confirm')}
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
  const wishlist = useMoneyQuery<WishlistResponse>(['wishlist', tab, scopeTab], `/api/wishlist${query ? `?${query}` : ''}`)
  const total = (category: WishlistCategory, scope: WishlistScope) =>
    approx(formatNumber(scopeTotal(totals, category, scope), wishlist.money?.currency ?? BASE_CURRENCY), wishlist.money)

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
        title={t('common:nav.wishlist')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> {t('wishlist:item.new')}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('wishlist:leftToBuyNeeds')}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-6">
            <div>
              <div className="text-xs text-muted-foreground">{t('common:labels.personal')}</div>
              <div className="text-xl font-bold">{total('necesitate', 'personal')}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('common:labels.company')}</div>
              <div className="text-xl font-bold">{total('necesitate', 'firma')}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('wishlist:leftToBuyWants')}</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-6">
            <div>
              <div className="text-xs text-muted-foreground">{t('common:labels.personal')}</div>
              <div className="text-xl font-bold">{total('placere', 'personal')}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('common:labels.company')}</div>
              <div className="text-xl font-bold">{total('placere', 'firma')}</div>
            </div>
          </CardContent>
        </Card>
      </div>
      <MoneyNote money={wishlist.money} />

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
          {TABS.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="pt-6">
          {wishlist.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !wishlist.data?.items.length ? (
            <p className="text-sm text-muted-foreground">{t('wishlist:empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.title')}</TableHead>
                  {scopeTab === 'all' ? <TableHead>{t('wishlist:labels.personalOrCompanyShort')}</TableHead> : null}
                  <TableHead>{t('common:labels.category')}</TableHead>
                  <TableHead>{t('common:labels.priority')}</TableHead>
                  <TableHead className="text-right">{t('wishlist:labels.estimatedPrice')}</TableHead>
                  <TableHead>{t('common:labels.status')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wishlist.data.items.map((item) => (
                  <TableRow
                    key={item.id}
                    className={cn('animate-in fade-in-0 duration-200 ease-out', item.purchased ? 'opacity-60' : '')}
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
                      {item.estimatedPrice ? `${Number(item.estimatedPrice).toLocaleString(intlTag())} ${item.currency}` : '—'}
                    </TableCell>
                    <TableCell>
                      {item.purchased ? <Badge variant="success">{t('wishlist:status.bought')}</Badge> : <Badge variant="outline">{t('wishlist:status.inList')}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {!item.purchased ? (
                          <Button variant="outline" onClick={() => setPurchasingItem(item)}>
                            {t('wishlist:markBought')}
                          </Button>
                        ) : null}
                        <Button variant="outline" onClick={() => openEdit(item)}>
                          {t('common:actions.edit')}
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
  return category === 'necesitate' ? t('wishlist:category.need') : t('wishlist:category.want')
}

function priorityLabel(priority: WishlistItem['priority']): string {
  return { low: t('wishlist:priority.low'), medium: t('wishlist:priority.medium'), high: t('wishlist:priority.high') }[priority]
}
