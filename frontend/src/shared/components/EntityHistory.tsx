import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Timeline } from '@/shared/components/Timeline'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { api } from '@/shared/lib/api'
import { actionLabel, type AuditListItem } from '@/shared/lib/audit'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

// „Creat de … · Modificat de …" sub titlul unui obiect, cu panoul care arată cine, ce câmp,
// vechi → nou, când (PLAN.md C2, fișa „Istoric"). Se hrănește din `audit_log` prin
// `entityType` + `entityId`, deci nu cere câmpuri noi pe obiect — obiectul rămâne neatins.

const CREATE_ACTIONS: Record<string, string[]> = {
  invoice: ['factura.emitata'],
  billing_client: ['client.creat'],
  contract_addendum: ['contract.anexa.creata'],
}

const CHANGE_LABEL: Record<string, string> = {
  name: t('common:history.fields.name'),
  email: t('common:history.fields.email'),
  address: t('common:history.fields.address'),
  cif: t('common:history.fields.cif'),
  phone: t('common:history.fields.phone'),
  amount: t('common:history.fields.amount'),
  status: t('common:history.fields.status'),
  contractDetails: t('common:history.fields.contractDetails'),
  displayName: t('common:history.fields.displayName'),
  roleId: t('common:history.fields.role'),
  cutii: t('common:history.fields.mailboxes'),
}

function actorName(item: AuditListItem, members: ReturnType<typeof useTeamMembers>['data']): string {
  if (!item.actor) return t('common:labels.system')
  const member = members?.find((m) => m.id === item.actor?.id)
  return member ? memberName(member) : (item.actor.displayName ?? t('common:history.someone'))
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

  if (query.isPending) return <p className="text-xs text-muted-foreground">{t('common:history.loading')}</p>
  if (query.isError || items.length === 0) return null

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {created ? (
          <>
            {t('common:history.createdBy', { created: actorName(created, members.data), createdAt: formatDateTime(created.createdAt) })}
          </>
        ) : null}
        {created && lastChange ? ' · ' : null}
        {lastChange ? (
          <>
            {t('common:history.changedBy', { lastChange: actorName(lastChange, members.data), createdAt: formatRelativeTime(lastChange.createdAt) })}
          </>
        ) : null}
        {' · '}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setOpen(true)}>
          {t('common:nav.history')}
        </button>
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-base">{t('common:nav.history')}</DialogTitle>
          </DialogHeader>
          <Timeline
            entries={items.map((item) => ({
              id: item.id,
              author: actorName(item, members.data),
              at: item.createdAt,
              text: (
                <>
                  {actionLabel(item.action)}
                  {item.changes
                    ? Object.entries(item.changes).map(([field, [before, after]]) => (
                        <span key={field} className="mt-0.5 block text-xs text-muted-foreground">
                          {CHANGE_LABEL[field] ?? field}: <span className="line-through">{changeText(before)}</span> → {changeText(after)}
                        </span>
                      ))
                    : null}
                </>
              ),
            }))}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
