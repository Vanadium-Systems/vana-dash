import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import { cn, parseRoDecimal } from '@/shared/lib/utils'
import { formatUsd, type OrderPreviewResult } from './types'

interface OrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultSymbol: string
  liveMode: boolean
}

/** Confirmare în doi pași (Track D, Wave 8): preview → execută. Preview-ul nu plasează nimic;
 *  butonul de execuție e activ doar după un preview reușit. Kill-switch-ul e verificat din nou
 *  de backend la execuție — UI-ul doar îl afișează în preview. */
export function OrderDialog({ open, onOpenChange, defaultSymbol, liveMode }: OrderDialogProps) {
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [type, setType] = useState<'market' | 'limit'>('market')
  const [quantity, setQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [preview, setPreview] = useState<OrderPreviewResult | null>(null)

  function reset() {
    setSymbol(defaultSymbol)
    setSide('buy')
    setType('market')
    setQuantity('')
    setLimitPrice('')
    setPreview(null)
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      api.post<OrderPreviewResult>('/api/assets/orders/preview', {
        symbol: symbol.trim(),
        side,
        type,
        quantity: parseRoDecimal(quantity),
        ...(type === 'limit' ? { limitPrice: parseRoDecimal(limitPrice) } : {}),
      }),
    onSuccess: setPreview,
    onError: (err) => toast.error(err.message),
  })

  const placeMutation = useMutation({
    mutationFn: () =>
      api.post<{ filled: boolean; paper: boolean; price: number | null }>('/api/assets/orders', {
        symbol: symbol.trim(),
        side,
        type,
        quantity: parseRoDecimal(quantity),
        ...(type === 'limit' ? { limitPrice: parseRoDecimal(limitPrice) } : {}),
      }),
    onSuccess: (result) => {
      toast.success(result.paper ? `Ordin paper ${result.filled ? 'executat' : 'deschis'}` : 'Ordin live trimis pe Trading212')
      reset()
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const quantityValid = parseRoDecimal(quantity) > 0
  const canPreview = quantityValid && symbol.trim().length >= 1 && (type !== 'limit' || parseRoDecimal(limitPrice) > 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ordin nou — Trading212</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Preview → execută. Live-ul cere kill-switch activ din Setări; fără el, doar paper.
          {liveMode ? ' Mod live: simbolul e ticker-ul EXACT Trading212 (ex: AAPL_US_EQ), nu simbolul de preț.' : ''}
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="order-symbol">Simbol</Label>
              <Input
                id="order-symbol"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value.toUpperCase())
                  setPreview(null)
                }}
                placeholder="AAPL"
              />
            </div>
            <div className="space-y-1">
              <Label>Parte</Label>
              <div className="flex gap-1">
                {(['buy', 'sell'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setSide(s)
                      setPreview(null)
                    }}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-1.5 text-sm capitalize transition-colors',
                      side === s
                        ? s === 'buy'
                          ? 'border-success-text bg-success-text/10 text-success-text'
                          : 'border-destructive-text bg-destructive-text/10 text-destructive-text'
                        : 'hover:bg-accent',
                    )}
                  >
                    {s === 'buy' ? 'Cumpără' : 'Vinde'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-1">
            {(['market', 'limit'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t)
                  setPreview(null)
                }}
                className={cn('rounded-md border px-3 py-1 text-xs capitalize', type === t ? 'bg-accent' : 'text-muted-foreground hover:bg-accent')}
              >
                {t === 'market' ? 'Market' : 'Limit'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="order-qty">Cantitate</Label>
              <Input
                id="order-qty"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value)
                  setPreview(null)
                }}
              />
            </div>
            {type === 'limit' ? (
              <div className="space-y-1">
                <Label htmlFor="order-limit">Preț limit</Label>
                <Input
                  id="order-limit"
                  inputMode="decimal"
                  value={limitPrice}
                  onChange={(e) => {
                    setLimitPrice(e.target.value)
                    setPreview(null)
                  }}
                />
              </div>
            ) : null}
          </div>

          {preview ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="assets-order-preview">
              <p>
                Referință: <span className="tnum font-mono">{formatUsd(preview.referencePrice)}</span> · Estimat:{' '}
                <span className="tnum font-mono">{formatUsd(preview.estimatedValue)}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Mod: <span className={preview.mode === 'live' ? 'font-semibold text-destructive-text' : ''}>{preview.mode}</span>
                {!preview.tradingEnabled && preview.mode === 'live' ? ' — kill-switch OPRIT, ordinul live va fi respins' : ''}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={!canPreview || previewMutation.isPending}>
            {previewMutation.isPending ? 'Se calculează…' : 'Pasul 1 · Preview'}
          </Button>
          <Button
            onClick={() => placeMutation.mutate()}
            disabled={!preview || placeMutation.isPending}
            variant={preview?.mode === 'live' && preview.tradingEnabled ? 'destructive' : 'default'}
            data-testid="assets-order-execute"
          >
            {placeMutation.isPending ? 'Se trimite…' : 'Pasul 2 · Execută'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
