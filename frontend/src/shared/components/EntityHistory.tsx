import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { api } from '@/shared/lib/api'
import { actionLabel, type AuditListItem } from '@/shared/lib/audit'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/utils'

// „Creat de … · Modificat de …" sub titlul unui obiect, cu panoul care arată cine, ce câmp,
// vechi → nou, când (PLAN.md C2, fișa „Istoric"). Se hrănește din `audit_log` prin
// `entityType` + `entityId`, deci nu cere câmpuri noi pe obiect — obiectul rămâne neatins.

const CREATE_ACTIONS: Record<string, string[]> = {
  invoice: ['factura.emitata'],
  billing_client: ['client.creat'],
  contract_addendum: ['contract.anexa.creata'],
}

const CHANGE_LABEL: Record<string, string> = {
  name: 'nume',
  email: 'email',
  address: 'adresă',
  cif: 'CUI',
  phone: 'telefon',
  amount: 'sumă',
  status: 'stare',
  contractDetails: 'detalii contract',
  displayName: 'nume afișat',
  roleId: 'rol',
  cutii: 'cutii de email',
}

function actorName(item: AuditListItem, members: ReturnType<typeof useTeamMembers>['data']): string {
  if (!item.actor) return 'Sistem'
  const member = members?.find((m) => m.id === item.actor?.id)
  return member ? memberName(member) : (item.actor.displayName ?? 'Un om din echipă')
}

/** Valoarea veche → cea nouă, pe o singură linie; obiectele lungi devin JSON scurt. */
function changeText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'gol'
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 60)
  return String(value)
}

export function EntityHistory({ entityType, entityId }: { entityType: string; entityId: string | null | undefined }) {
  const { can } = useMe()
  const [open, setOpen] = useState(false)
  const enabled = Boolean(entityId) && can('echipa.istoric')
  const members = useTeamMembers()

  const query = useQuery({
    queryKey: ['audit', 'entity', entityType, entityId],
    queryFn: () => api.get<AuditListItem[]>(`/api/audit?entityType=${entityType}&entityId=${entityId}&limit=50`),
    enabled,
  })

  if (!enabled) return null

  const items = query.data ?? []
  const createActions = CREATE_ACTIONS[entityType] ?? []
  const created = items.filter((item) => createActions.includes(item.action)).at(-1)
  const changes = items.filter((item) => !createActions.includes(item.action))
  const lastChange = changes[0]

  if (query.isPending) return <p className="text-xs text-muted-foreground">Se citește istoricul…</p>
  if (query.isError || items.length === 0) return null

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {created ? (
          <>
            Creat de {actorName(created, members.data)} · {formatDateTime(created.createdAt)}
          </>
        ) : null}
        {created && lastChange ? ' · ' : null}
        {lastChange ? (
          <>
            Modificat de {actorName(lastChange, members.data)} {formatRelativeTime(lastChange.createdAt)}
          </>
        ) : null}
        {' · '}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setOpen(true)}>
          Istoric
        </button>
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-base">Istoric</DialogTitle>
          </DialogHeader>
          <ul className="space-y-3 text-sm">
            {items.map((item) => (
              <li key={item.id} className="border-t pt-3 first:border-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span>{actionLabel(item.action)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(item.createdAt)}>
                    {formatRelativeTime(item.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{actorName(item, members.data)}</div>
                {item.changes
                  ? Object.entries(item.changes).map(([field, [before, after]]) => (
                      <div key={field} className="mt-0.5 text-xs text-muted-foreground">
                        {CHANGE_LABEL[field] ?? field}: <span className="line-through">{changeText(before)}</span> → {changeText(after)}
                      </div>
                    ))
                  : null}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
