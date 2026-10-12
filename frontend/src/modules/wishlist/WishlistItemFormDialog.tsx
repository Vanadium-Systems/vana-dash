import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { WishlistCategory, WishlistItem, WishlistPriority, WishlistScope } from '@/shared/lib/types'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'


interface WishlistItemFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create. */
  item: WishlistItem | null
  /** Scope preselectat la creare (ex: tab-ul curent din WishlistPage) — ignorat la editare. */
  defaultScope?: WishlistScope
}

export function WishlistItemFormDialog({ open, onOpenChange, item, defaultScope }: WishlistItemFormDialogProps) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<WishlistCategory>('necesitate')
  const [scope, setScope] = useState<WishlistScope>('personal')
  const [priority, setPriority] = useState<WishlistPriority>('medium')
  const [estimatedPrice, setEstimatedPrice] = useState('')
  const [currency, setCurrency] = useState<string>(BASE_CURRENCY)
  const [link, setLink] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(item?.title ?? '')
    setCategory(item?.category ?? 'necesitate')
    setScope(item?.scope ?? defaultScope ?? 'personal')
    setPriority(item?.priority ?? 'medium')
    setEstimatedPrice(item?.estimatedPrice ?? '')
    setCurrency(item?.currency ?? BASE_CURRENCY)
    setLink(item?.link ?? '')
  }, [open, item, defaultScope])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        category,
        scope,
        priority,
        estimatedPrice: estimatedPrice ? parseRoDecimal(estimatedPrice) : undefined,
        currency,
        link: link || undefined,
      }
      return item
        ? api.patch<WishlistItem>(`/api/wishlist/${item.id}`, body)
        : api.post<WishlistItem>('/api/wishlist', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] })
      toast.success(item ? t('wishlist:item.updated') : t('wishlist:item.added'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/wishlist/${item?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] })
      toast.success(t('wishlist:item.deleted'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? t('wishlist:item.editTitle') : t('wishlist:item.new')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="wl-title">{t('common:labels.title')}</Label>
            <Input id="wl-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="wl-scope">{t('wishlist:labels.personalOrCompany')}</Label>
              <Select
                id="wl-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as WishlistScope)}
              >
                <option value="personal">{t('common:labels.personal')}</option>
                <option value="firma">{t('common:labels.company')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-category">{t('common:labels.category')}</Label>
              <Select
                id="wl-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as WishlistCategory)}
              >
                <option value="necesitate">{t('wishlist:category.need')}</option>
                <option value="placere">{t('wishlist:category.want')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-priority">{t('common:labels.priority')}</Label>
              <Select
                id="wl-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as WishlistPriority)}
              >
                <option value="low">{t('wishlist:priority.low')}</option>
                <option value="medium">{t('wishlist:priority.medium')}</option>
                <option value="high">{t('wishlist:priority.high')}</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wl-price">{t('wishlist:labels.estimatedPrice')}</Label>
              <Input
                id="wl-price"
                inputMode="decimal"
                value={estimatedPrice}
                onChange={(e) => setEstimatedPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-currency">{t('common:labels.currency')}</Label>
              <Select id="wl-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="RON">RON</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wl-link">{t('wishlist:item.linkOptional')}</Label>
            <Input id="wl-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {save.isPending ? t('common:states.saving') : t('common:actions.save')}
            </Button>
            {item ? (
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  void confirm({ title: t('wishlist:item.deleteTitle', { title: item.title }), confirmLabel: t('common:actions.delete'), destructive: true }).then((ok) => ok && remove.mutate())
                }}
              >
                {t('common:actions.delete')}
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

