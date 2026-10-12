import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as React from 'react'
import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog'

// Înlocuiește window.confirm (DESIGN.md, Ștergere): titlul numește obiectul, corpul spune
// consecința, butonul are verbul. Focusul pleacă pe „Anulează", ca un Enter reflex să nu
// șteargă nimic.

export interface ConfirmOptions {
  title: string
  consequence?: React.ReactNode
  confirmLabel: string
  destructive?: boolean
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ConfirmDialog({ open, onOpenChange, onConfirm, title, consequence, confirmLabel, destructive }: ConfirmDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role="alertdialog"
        className="top-auto md:max-w-md"
        {...(consequence ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle className="text-base">{title}</DialogTitle>
          {consequence ? <DialogDescription>{consequence}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <DialogPrimitive.Close asChild>
            <Button ref={cancelRef} variant="outline">
              Anulează
            </Button>
          </DialogPrimitive.Close>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Resolver = (confirmed: boolean) => void
const ConfirmContext = React.createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

/** Montat o dată în AppLayout; paginile cer confirmarea cu `await confirm({...})`. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<(ConfirmOptions & { resolve: Resolver }) | null>(null)

  const confirm = React.useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <ConfirmDialog
          open
          title={pending.title}
          consequence={pending.consequence}
          confirmLabel={pending.confirmLabel}
          destructive={pending.destructive}
          onConfirm={() => pending.resolve(true)}
          onOpenChange={(open) => {
            if (open) return
            pending.resolve(false)
            setPending(null)
          }}
        />
      ) : null}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = React.useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm trebuie folosit sub <ConfirmProvider>')
  return confirm
}
