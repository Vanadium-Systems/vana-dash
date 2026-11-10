import { Copy, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { StatePill } from '@/shared/components/ui/state-pill'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { ContactPointDialog, PersonDialog, type ContactPointTarget } from './PersonDialogs'
import type { ContactPointStatus, ProspectSheet, SheetContactPoint, SheetPerson } from './types'
import { useWrite } from './use-sheet'

export type ContactKind = 'call' | 'write'

const copy = (value: string) =>
  void navigator.clipboard?.writeText(value).then(
    () => toast.success(t('common:states.copied')),
    () => toast.error(t('messages:actions.copyFailed')),
  )

const STATUS_LABEL: Record<Exclude<ContactPointStatus, 'ok'>, 'clients:sheet.contact.status.bounced' | 'clients:sheet.contact.status.unsubscribed' | 'clients:sheet.contact.status.invalid'> = {
  bounced: 'clients:sheet.contact.status.bounced',
  unsubscribed: 'clients:sheet.contact.status.unsubscribed',
  invalid: 'clients:sheet.contact.status.invalid',
}

function PointRow({ point, blockedReason, canEdit, onContact, onEdit, onDelete }: { point: SheetContactPoint; blockedReason: string | null; canEdit: boolean; onContact: (kind: ContactKind, value: string) => void; onEdit: () => void; onDelete: () => void }) {
  const phone = point.kind === 'phone'
  const Icon = phone ? Phone : Mail
  // An unsubscribed address is the person's own refusal; the button stays off even for the owner.
  const blocked = blockedReason ?? (point.status === 'unsubscribed' ? t('clients:sheet.contact.status.unsubscribed') : null)
  return (
    <li className="group flex min-w-0 items-center gap-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      {blocked ? (
        <span className="min-w-0 truncate text-muted-foreground line-through" title={blocked}>
          {point.value}
        </span>
      ) : (
        <a
          href={phone ? `tel:${point.value}` : `/email?to=${encodeURIComponent(point.value)}`}
          className="min-w-0 truncate text-primary underline underline-offset-2"
          onClick={(e) => {
            e.preventDefault()
            onContact(phone ? 'call' : 'write', point.value)
          }}
        >
          {point.value}
        </a>
      )}
      {point.label ? <span className="truncate text-xs text-muted-foreground">{point.label}</span> : null}
      {point.isPrimary ? <span className="shrink-0 text-xs text-muted-foreground">{t('clients:sheet.contact.primaryMark')}</span> : null}
      {point.status !== 'ok' ? <StatePill tone={point.status === 'invalid' ? 'neutral' : 'warning'}>{t(STATUS_LABEL[point.status])}</StatePill> : null}
      <span className="ml-auto flex shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t('clients:sheet.contact.copy')} title={t('clients:sheet.contact.copy')} onClick={() => copy(point.value)}>
          <Copy />
        </Button>
        {canEdit ? (
          <>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common:actions.edit')} title={t('common:actions.edit')} onClick={onEdit}>
              <Pencil />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common:actions.delete')} title={t('common:actions.delete')} onClick={onDelete}>
              <Trash2 />
            </Button>
          </>
        ) : null}
      </span>
    </li>
  )
}

export function PeopleSection({ sheet, onContact }: { sheet: ProspectSheet; onContact: (kind: ContactKind, value: string) => void }) {
  const confirm = useConfirm()
  const write = useWrite()
  const [personTarget, setPersonTarget] = useState<SheetPerson | 'new' | null>(null)
  const [pointTarget, setPointTarget] = useState<ContactPointTarget | null>(null)
  const canEdit = sheet.canEdit

  const pointsOf = (personId: string | null) => sheet.contactPoints.filter((point) => point.personId === personId)
  const addButtons = (personId: string | null) =>
    canEdit ? (
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => setPointTarget({ point: null, kind: 'phone', personId })}>
          <Plus aria-hidden="true" /> {t('clients:sheet.contact.addPhone')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setPointTarget({ point: null, kind: 'email', personId })}>
          <Plus aria-hidden="true" /> {t('clients:sheet.contact.addEmail')}
        </Button>
      </div>
    ) : null

  const deletePoint = (point: SheetContactPoint) =>
    void confirm({
      title: t('clients:sheet.contact.deleteTitle', { value: point.value }),
      confirmLabel: t('common:actions.delete'),
      destructive: true,
    }).then((ok) => ok && write(() => api.delete(`/api/prospects/${sheet.id}/contact-points/${point.id}`)))

  const deletePerson = (person: SheetPerson) =>
    void confirm({
      title: t('clients:sheet.people.deleteTitle', { name: person.name }),
      consequence: t('clients:sheet.people.deleteBody', { count: pointsOf(person.id).length }),
      confirmLabel: t('clients:sheet.people.deleteConfirm'),
      destructive: true,
    }).then((ok) => ok && write(() => api.delete(`/api/prospects/${sheet.id}/people/${person.id}`)))

  const list = (personId: string | null, blockedReason: string | null) => {
    const points = pointsOf(personId)
    if (points.length === 0) return null
    return (
      <ul className="space-y-0.5">
        {points.map((point) => (
          <PointRow
            key={point.id}
            point={point}
            blockedReason={blockedReason}
            canEdit={canEdit}
            onContact={onContact}
            onEdit={() => setPointTarget({ point, kind: point.kind, personId: point.personId })}
            onDelete={() => deletePoint(point)}
          />
        ))}
      </ul>
    )
  }

  const companyPoints = pointsOf(null)
  return (
    <section aria-label={t('clients:sheet.people.title')} className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('clients:sheet.people.title')}</h3>
        {canEdit ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setPersonTarget('new')}>
            <Plus aria-hidden="true" /> {t('clients:sheet.people.add')}
          </Button>
        ) : null}
      </div>

      {sheet.people.length === 0 && companyPoints.length === 0 ? <p className="text-sm text-muted-foreground">{t('clients:sheet.people.empty')}</p> : null}

      {sheet.people.map((person) => {
        const blockedReason = person.doNotContact ? t('clients:sheet.people.blocked', { reason: person.doNotContactReason ?? t('clients:sheet.people.noReason') }) : null
        return (
          <div key={person.id} className="space-y-1.5">
            {person.doNotContact ? (
              <div role="status" className="rounded-md border border-destructive-text/40 px-2 py-1 text-xs text-destructive-text">
                <span className="font-medium">{t('clients:sheet.people.doNotContactBand')}</span>
                {person.doNotContactReason ? ` · ${person.doNotContactReason}` : ''}
              </div>
            ) : null}
            <div className="group flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{person.name}</span>
              {person.role ? <span className="min-w-0 truncate text-xs text-muted-foreground">{person.role}</span> : null}
              {person.isDecisionMaker ? <Badge variant="secondary">{t('clients:sheet.people.decisionMaker')}</Badge> : null}
              {canEdit ? (
                <span className="ml-auto flex shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common:actions.edit')} title={t('common:actions.edit')} onClick={() => setPersonTarget(person)}>
                    <Pencil />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common:actions.delete')} title={t('common:actions.delete')} onClick={() => deletePerson(person)}>
                    <Trash2 />
                  </Button>
                </span>
              ) : null}
            </div>
            {list(person.id, blockedReason)}
            {addButtons(person.id)}
          </div>
        )
      })}

      {companyPoints.length > 0 || canEdit ? (
        <div className="space-y-1.5">
          {sheet.people.length > 0 ? <p className="text-xs text-muted-foreground">{t('clients:sheet.people.companyGroup')}</p> : null}
          {list(null, null)}
          {addButtons(null)}
        </div>
      ) : null}

      <PersonDialog prospectId={sheet.id} target={personTarget} onClose={() => setPersonTarget(null)} />
      <ContactPointDialog prospectId={sheet.id} people={sheet.people} target={pointTarget} onClose={() => setPointTarget(null)} />
    </section>
  )
}
