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
  const [currency, setCurrency] = useState('RON')
  const [link, setLink] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(item?.title ?? '')
    setCategory(item?.category ?? 'necesitate')
    setScope(item?.scope ?? defaultScope ?? 'personal')
    setPriority(item?.priority ?? 'medium')
    setEstimatedPrice(item?.estimatedPrice ?? '')
    setCurrency(item?.currency ?? 'RON')
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
      toast.success(item ? 'Item actualizat' : 'Item adăugat')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/wishlist/${item?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wishlist'] })
      toast.success('Item șters')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Editează itemul' : 'Item nou'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="wl-title">Titlu</Label>
            <Input id="wl-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="wl-scope">Personal / Firmă</Label>
              <Select
                id="wl-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as WishlistScope)}
              >
                <option value="personal">Personal</option>
                <option value="firma">Firmă</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-category">Categorie</Label>
              <Select
                id="wl-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as WishlistCategory)}
              >
                <option value="necesitate">Necesitate</option>
                <option value="placere">Plăcere</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-priority">Prioritate</Label>
              <Select
                id="wl-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as WishlistPriority)}
              >
                <option value="low">Scăzută</option>
                <option value="medium">Medie</option>
                <option value="high">Ridicată</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wl-price">Preț estimat</Label>
              <Input
                id="wl-price"
                inputMode="decimal"
                value={estimatedPrice}
                onChange={(e) => setEstimatedPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wl-currency">Monedă</Label>
              <Select id="wl-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="RON">RON</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wl-link">Link (opțional)</Label>
            <Input id="wl-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {save.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
            {item ? (
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  void confirm({ title: `Șterge „${item.title}” din wishlist`, confirmLabel: 'Șterge', destructive: true }).then((ok) => ok && remove.mutate())
                }}
              >
                Șterge
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

