import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { InvoicingClient } from '@/shared/lib/types'
import { ClientCombobox } from './ClientCombobox'
import type { Counterparty, CounterpartyKind } from './contracts-api'

const KIND_LABEL: Record<CounterpartyKind, () => string> = {
  client: () => t('accounting:contracts.kinds.client'),
  prospect: () => t('accounting:contracts.kinds.prospect'),
  user: () => t('accounting:contracts.kinds.user'),
  other: () => t('accounting:contracts.kinds.other'),
}

function ProspectSearch({ id, invalid, onPick }: { id: string; invalid: boolean; onPick: (party: Counterparty) => void }) {
  const [term, setTerm] = useState('')
  const needle = useDebounced(term.trim(), 250)
  const found = useQuery({
    queryKey: ['contracts', 'prospect-search', needle],
    queryFn: () => api.get<{ rows: Array<{ id: string; name: string }> }>(`/api/prospects?kind=companies&pageSize=6&q=${encodeURIComponent(needle)}`),
    enabled: needle.length >= 2,
  })
  return (
    <div className="space-y-1">
      <Input id={id} type="search" autoComplete="off" value={term} maxLength={120} aria-invalid={invalid || undefined} onChange={(e) => setTerm(e.target.value)} />
      {(found.data?.rows ?? []).length > 0 ? (
        <ul className="rounded-md border p-1">
          {found.data!.rows.map((row) => (
            <li key={row.id}>
              <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onPick({ kind: 'prospect', id: row.id, label: row.name })}>
                <span className="truncate">{row.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** The other side of a contract: a client, a prospect, a colleague, or a name typed by hand. */
export function ContractPartyField({
  id,
  value,
  onChange,
  error,
}: {
  id: string
  value: Counterparty | null
  onChange: (party: Counterparty | null) => void
  error: string | null
}) {
  const { can } = useMe()
  const kinds = (['client', 'prospect', 'user', 'other'] as const).filter((kind) => (kind === 'prospect' ? can('clienti.view') : true))
  const [kind, setKind] = useState<CounterpartyKind>(value?.kind ?? 'client')
  const clients = useQuery({ queryKey: ['billing-clients'], queryFn: () => api.get<InvoicingClient[]>('/api/invoicing/clients'), enabled: kind === 'client' })
  const members = useTeamMembers()

  const pickKind = (next: CounterpartyKind) => {
    setKind(next)
    onChange(next === 'other' ? { kind: 'other', name: '' } : null)
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
      <Field label={t('accounting:contracts.party.kind')}>
        <Select value={kind} onChange={(e) => pickKind(e.target.value as CounterpartyKind)}>
          {kinds.map((option) => (
            <option key={option} value={option}>
              {KIND_LABEL[option]()}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('accounting:contracts.party.label')} error={error}>
        {kind === 'client' ? (
          <ClientCombobox id={id} clients={clients.data ?? []} value={value?.kind === 'client' ? value.id : ''} invalid={Boolean(error)} onChange={(client) => onChange({ kind: 'client', id: client.id, label: client.name })} />
        ) : kind === 'user' ? (
          <Select id={id} value={value?.kind === 'user' ? value.id : ''} onChange={(e) => {
            const member = members.data?.find((m) => m.id === e.target.value)
            onChange(member ? { kind: 'user', id: member.id, label: memberName(member) } : null)
          }}>
            <option value="">{t('accounting:contracts.party.pickColleague')}</option>
            {(members.data ?? [])
              .filter((member) => member.status === 'active')
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {memberName(member)}
                </option>
              ))}
          </Select>
        ) : kind === 'prospect' ? (
          value?.kind === 'prospect' ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">{value.label}</span>
              <Button type="button" variant="ghost" onClick={() => onChange(null)}>
                {t('accounting:contracts.party.change')}
              </Button>
            </div>
          ) : (
            <ProspectSearch id={id} invalid={Boolean(error)} onPick={onChange} />
          )
        ) : (
          <Input id={id} maxLength={200} value={value?.kind === 'other' ? value.name : ''} onChange={(e) => onChange({ kind: 'other', name: e.target.value })} />
        )}
      </Field>
    </div>
  )
}
