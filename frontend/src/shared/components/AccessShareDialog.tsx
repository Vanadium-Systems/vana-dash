import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { useMe } from '@/shared/hooks/use-me'
import type { AccessLevel, AccessShare } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

// „Partajează" pe un folder din Arhivă sau pe un calendar întreg — același model în ambele
// (vede / editează, dat de proprietar sau de admin), deci un singur dialog. Pagina aduce lista
// și face cererile; dialogul doar o arată.

const LEVEL_OPTIONS = [
  { value: 'view', label: t('common:access.share.levelView') },
  { value: 'edit', label: t('common:access.share.levelEdit') },
]

interface AccessShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Proprietarul nu apare în lista de oameni cărora li se poate da acces. */
  ownerUserId: string
  shares: AccessShare[] | undefined
  isLoading: boolean
  isPending: boolean
  onSet: (userId: string, level: AccessLevel) => void
  onRemove: (userId: string) => void
}

export function AccessShareDialog({
  open,
  onOpenChange,
  title,
  description,
  ownerUserId,
  shares,
  isLoading,
  isPending,
  onSet,
  onRemove,
}: AccessShareDialogProps) {
  const { session } = useMe()
  const members = useTeamMembers()
  const [userId, setUserId] = useState('')
  const [level, setLevel] = useState<AccessLevel>('view')
  const [error, setError] = useState<string | null>(null)

  const sharedIds = new Set((shares ?? []).map((s) => s.userId))
  const candidates = (members.data ?? []).filter(
    (m) => m.status === 'active' && m.id !== ownerUserId && m.id !== session?.user.id && !sharedIds.has(m.id),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : shares?.length ? (
          <ul className="divide-y" aria-label={t('common:access.share.whoHasAccess')}>
            {shares.map((s) => (
              <li key={s.userId} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{s.displayName ?? s.email}</p>
                  {s.displayName ? <p className="truncate text-xs text-muted-foreground">{s.email}</p> : null}
                </div>
                <Select
                  className="w-32"
                  aria-label={t('common:access.share.levelOf', { name: s.displayName ?? s.email })}
                  value={s.level}
                  options={LEVEL_OPTIONS}
                  disabled={isPending}
                  onValueChange={(v) => onSet(s.userId, v as AccessLevel)}
                />
                <Button variant="ghost" disabled={isPending} onClick={() => onRemove(s.userId)}>
                  {t('common:actions.remove')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('common:access.share.onlyYou')}</p>
        )}

        <form
          className="flex flex-wrap items-end gap-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!userId) {
              setError(t('common:access.share.pickPerson'))
              return
            }
            setError(null)
            onSet(userId, level)
            setUserId('')
          }}
        >
          <Field label={t('common:access.share.person')} error={error} className="min-w-48 flex-1">
            <Select value={userId} onValueChange={setUserId} disabled={!candidates.length}>
              <option value="">{candidates.length ? t('common:access.share.choose') : t('common:access.share.everyoneHasAccess')}</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {memberName(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:access.share.level')} className="w-32">
            <Select value={level} options={LEVEL_OPTIONS} onValueChange={(v) => setLevel(v as AccessLevel)} />
          </Field>
          <Button type="submit" disabled={isPending || !candidates.length}>
            {t('common:access.share.grant')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
