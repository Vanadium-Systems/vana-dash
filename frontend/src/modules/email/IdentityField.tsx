import { useEffect, useMemo, useState } from 'react'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { useMe } from '@/shared/hooks/use-me'
import type { EmailFromKey, EmailIdentity } from '@/shared/lib/types'
import { extractEmailAddress, identityOptionLabel } from './identity'
import { t } from '@/shared/lib/i18n'

// Selectorul „De pe", în trei locuri (compose, trimitere în masă, secvențe). Cutii sunt per
// om (PLAN.md C2), deci lista se taie la ce are omul — altfel un coleg ar alege o cutie care
// nu e a lui și ar primi 403 la trimitere. Cu o singură cutie, alegerea e deja făcută: arată
// text, nu un dropdown cu un singur rând.

/** `mailboxes: null` = adminul, care le are pe toate. */
export function identitiesFor(identities: EmailIdentity[] | null | undefined, mailboxes: string[] | null | undefined): EmailIdentity[] {
  const list = identities ?? []
  if (!mailboxes) return list
  return list.filter((identity) => mailboxes.includes(identity.key))
}

/**
 * Cheia de trimitere, corectată la ce are omul: valoarea implicită a fiecărui formular
 * („contact" la trimitere în masă, „outreach" la secvențe) poate să nu fie cutia lui.
 */
export function useIdentityKey(initial: EmailFromKey, identities: EmailIdentity[] | null | undefined): [EmailFromKey, (key: EmailFromKey) => void, EmailIdentity[]] {
  const { session } = useMe()
  const mine = useMemo(() => identitiesFor(identities, session?.mailboxes), [identities, session?.mailboxes])
  const [key, setKey] = useState<EmailFromKey>(initial)

  useEffect(() => {
    if (mine.length > 0 && !mine.some((identity) => identity.key === key)) setKey(mine[0]!.key)
  }, [key, mine])

  return [key, setKey, mine]
}

export function IdentityField({
  id,
  value,
  onChange,
  identities,
}: {
  id: string
  value: EmailFromKey
  onChange: (key: EmailFromKey) => void
  identities: EmailIdentity[] | null | undefined
}) {
  const { session } = useMe()
  const mine = useMemo(() => identitiesFor(identities, session?.mailboxes), [identities, session?.mailboxes])

  if (mine.length === 1) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{t('email:labels.fromMailbox')}</Label>
        <p id={id} className="text-sm">
          {extractEmailAddress(mine[0]!.fromAddress)}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('email:labels.fromMailbox')}</Label>
      <Select id={id} value={value} onValueChange={(next) => onChange(next as EmailFromKey)}>
        {mine.map((identity) => (
          <option key={identity.key} value={identity.key}>
            {identityOptionLabel(identity)}
          </option>
        ))}
      </Select>
    </div>
  )
}
