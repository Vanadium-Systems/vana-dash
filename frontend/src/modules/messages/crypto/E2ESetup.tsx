import { useState } from 'react'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { t } from '@/shared/lib/i18n'
import type { ChatMember } from '@/shared/lib/types'
import { useE2E } from './E2EProvider'
import { toastError } from '@/shared/lib/errors'

// The screens of the end-to-end setup (FE-M4): the recovery key on the first device, then, on
// every new one, approval from another device or the recovery key. Shown in place of Mesaje
// until this device can read: without keys there is nothing to show.

/** Mesaje itself once this device can read; the setup until then. */
export function E2EGate({ children }: { children: React.ReactNode }) {
  const { status } = useE2E()
  // Kept here: making the key flips the status to ready, and the dialog must outlive that.
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const keyDialog = recoveryKey ? <ShowRecoveryKey recoveryKey={recoveryKey} onDone={() => setRecoveryKey(null)} /> : null
  if (status === 'ready' || status === 'off' || status === 'loading') {
    return (
      <>
        {children}
        {keyDialog}
      </>
    )
  }
  return (
    <div className="mx-auto w-full max-w-md py-8">
      {keyDialog}
      {status === 'unsupported' ? (
        <Alert tone="warning">{t('messages:e2e.unsupported')}</Alert>
      ) : status === 'error' ? (
        <Alert tone="critical">{t('messages:e2e.startFailed')}</Alert>
      ) : status === 'needs-identity' ? (
        <CreateIdentity onKey={setRecoveryKey} />
      ) : (
        <ApproveThisDevice onKey={setRecoveryKey} />
      )}
    </div>
  )
}

function CreateIdentity({ reset = false, onKey }: { reset?: boolean; onKey: (recoveryKey: string) => void }) {
  const { engine } = useE2E()
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!engine) return
    setBusy(true)
    try {
      onKey(await engine.createIdentity(reset))
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t('messages:e2e.setupTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('messages:e2e.setupBody')}</p>
      <Button onClick={() => void create()} disabled={busy || !engine}>
        {t('messages:e2e.createKey')}
      </Button>
    </section>
  )
}

function ShowRecoveryKey({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent hideClose className="md:max-w-md" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('messages:e2e.keyTitle')}</DialogTitle>
          <DialogDescription>{t('messages:e2e.keyBody')}</DialogDescription>
        </DialogHeader>
        <p className="select-all break-words rounded-md bg-muted px-3 py-2 font-mono text-sm" aria-label={t('messages:e2e.recoveryLabel')}>
          {recoveryKey}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() =>
              void navigator.clipboard?.writeText(recoveryKey).then(
                () => setCopied(true),
                () => undefined,
              )
            }
          >
            {copied ? t('messages:e2e.copied') : t('messages:e2e.copy')}
          </Button>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="e2e-saved" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <Label htmlFor="e2e-saved" className="font-normal">
            {t('messages:e2e.saved')}
          </Label>
        </div>
        <DialogFooter>
          <Button disabled={!saved} onClick={onDone}>
            {t('messages:e2e.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApproveThisDevice({ onKey }: { onKey: (recoveryKey: string) => void }) {
  const { engine } = useE2E()
  const confirm = useConfirm()
  const [mode, setMode] = useState<'choose' | 'waiting' | 'recovery' | 'reset'>('choose')
  const [code, setCode] = useState('')
  const [recoveryText, setRecoveryText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const askOtherDevice = async () => {
    if (!engine) return
    setBusy(true)
    try {
      setCode(await engine.requestApproval())
      setMode('waiting')
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const unlock = async () => {
    if (!engine) return
    setBusy(true)
    setError(null)
    try {
      if (!(await engine.restoreWithRecoveryKey(recoveryText))) setError(t('messages:e2e.recoveryWrong'))
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    const ok = await confirm({
      title: t('messages:e2e.resetTitle'),
      consequence: t('messages:e2e.resetBody'),
      confirmLabel: t('messages:e2e.resetConfirm'),
      destructive: true,
    })
    if (ok) setMode('reset')
  }

  if (mode === 'reset') return <CreateIdentity reset onKey={onKey} />

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('messages:e2e.approvalTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('messages:e2e.approvalBody')}</p>
      </div>

      {mode === 'waiting' ? (
        <div className="space-y-2">
          <p className="text-sm">{t('messages:e2e.codeHint')}</p>
          <p className="text-3xl font-semibold tracking-widest tnum">{code}</p>
          <p className="text-sm text-muted-foreground" role="status">
            {t('messages:e2e.waitingApproval')}
          </p>
        </div>
      ) : mode === 'recovery' ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void unlock()
          }}
        >
          <Field label={t('messages:e2e.recoveryLabel')} error={error}>
            <Input
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={recoveryText}
              onChange={(e) => setRecoveryText(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy || recoveryText.trim().length < 20}>
            {t('messages:e2e.recoverySubmit')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void askOtherDevice()} disabled={busy || !engine}>
            {t('messages:e2e.approveFromOther')}
          </Button>
          <Button variant="outline" onClick={() => setMode('recovery')}>
            {t('messages:e2e.useRecovery')}
          </Button>
        </div>
      )}

      {mode !== 'choose' ? (
        <Button variant="ghost" onClick={() => setMode('choose')}>
          {t('messages:e2e.cancel')}
        </Button>
      ) : null}
      <Button variant="ghost" className="text-muted-foreground" onClick={() => void reset()}>
        {t('messages:e2e.lostKey')}
      </Button>
    </section>
  )
}

/** On a device that can read: another device of the same person asks to be approved. */
export function ApprovalRequests() {
  const { engine } = useE2E()
  const [busy, setBusy] = useState(false)
  const request = engine?.approvals[0]
  if (!engine || !request) return null
  return (
    <Dialog open onOpenChange={(open) => !open && engine.dismissApproval(request.requestId)}>
      <DialogContent role="alertdialog" className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {request.device.label
              ? t('messages:e2e.requestTitle', { label: request.device.label })
              : t('messages:e2e.requestUnknownDevice')}
          </DialogTitle>
          <DialogDescription>{t('messages:e2e.requestBody')}</DialogDescription>
        </DialogHeader>
        <p className="text-center text-3xl font-semibold tracking-widest tnum">{request.code}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => engine.dismissApproval(request.requestId)}>
            {t('messages:e2e.deny')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void engine
                .approve(request)
                .catch((err: Error) => toastError(err))
                .finally(() => setBusy(false))
            }}
          >
            {t('messages:e2e.approve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A colleague in this conversation made a new recovery key since this device first saw them. */
export function ChangedKeysNotice({ members, meId }: { members: ChatMember[]; meId: string }) {
  const { engine } = useE2E()
  const changed = members.filter((member) => member.id !== meId && engine?.changedKeys.has(member.id))
  if (changed.length === 0) return null
  return (
    <div className="px-4 pt-2">
      {changed.map((member) => (
        <Alert key={member.id} tone="neutral">
          {t('messages:e2e.changedKey', { name: member.displayName ?? member.email })}
        </Alert>
      ))}
    </div>
  )
}
