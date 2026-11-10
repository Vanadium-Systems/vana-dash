import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { SheetContactPoint, SheetPerson } from './types'
import { useWrite } from './use-sheet'

/** `null` = closed, `'new'` = add, a person = edit. */
export function PersonDialog({ prospectId, target, onClose }: { prospectId: string; target: SheetPerson | 'new' | null; onClose: () => void }) {
  const write = useWrite()
  const person = target === 'new' ? null : target
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [decisionMaker, setDecisionMaker] = useState(false)
  const [doNotContact, setDoNotContact] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!target) return
    setName(person?.name ?? '')
    setRole(person?.role ?? '')
    setDecisionMaker(person?.isDecisionMaker ?? false)
    setDoNotContact(person?.doNotContact ?? false)
    setReason(person?.doNotContactReason ?? '')
    setError(null)
  }, [target, person])

  const submit = async () => {
    if (!name.trim()) return setError(t('clients:sheet.people.nameRequired'))
    const body = {
      name: name.trim(),
      role: role.trim() || null,
      isDecisionMaker: decisionMaker,
      doNotContact,
      doNotContactReason: doNotContact ? reason.trim() || null : null,
    }
    setSaving(true)
    const done = await write(() => (person ? api.patch(`/api/prospects/${prospectId}/people/${person.id}`, body) : api.post(`/api/prospects/${prospectId}/people`, body)))
    setSaving(false)
    if (done !== undefined) onClose()
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{person ? t('clients:sheet.people.editTitle') : t('clients:sheet.people.addTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label={t('clients:sheet.people.name')} error={error}>
            <Input autoFocus maxLength={255} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('clients:sheet.people.role')} optional>
            <Input maxLength={255} value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={decisionMaker} onChange={(e) => setDecisionMaker(e.target.checked)} />
            {t('clients:sheet.people.decisionMaker')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={doNotContact} onChange={(e) => setDoNotContact(e.target.checked)} />
            {t('clients:sheet.people.doNotContact')}
          </label>
          {doNotContact ? (
            <Field label={t('clients:sheet.people.doNotContactReason')} optional>
              <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export interface ContactPointTarget {
  point: SheetContactPoint | null
  kind: 'phone' | 'email'
  personId: string | null
}

export function ContactPointDialog({ prospectId, people, target, onClose }: { prospectId: string; people: SheetPerson[]; target: ContactPointTarget | null; onClose: () => void }) {
  const write = useWrite()
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [personId, setPersonId] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!target) return
    setValue(target.point?.value ?? '')
    setLabel(target.point?.label ?? '')
    setPersonId(target.personId ?? '')
    setIsPrimary(target.point?.isPrimary ?? false)
    setError(null)
  }, [target])

  const submit = async () => {
    if (!target) return
    if (!value.trim()) return setError(t('clients:sheet.contact.valueRequired'))
    const body = { value: value.trim(), label: label.trim() || null, personId: personId || null, isPrimary }
    setSaving(true)
    const done = await write(() =>
      target.point ? api.patch(`/api/prospects/${prospectId}/contact-points/${target.point.id}`, body) : api.post(`/api/prospects/${prospectId}/contact-points`, { ...body, kind: target.kind }),
    )
    setSaving(false)
    if (done !== undefined) onClose()
  }

  const phone = target?.kind === 'phone'
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(target?.point ? (phone ? 'clients:sheet.contact.editPhone' : 'clients:sheet.contact.editEmail') : phone ? 'clients:sheet.contact.addPhone' : 'clients:sheet.contact.addEmail')}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label={phone ? t('clients:sheet.contact.phone') : t('clients:sheet.contact.email')} error={error}>
            <Input autoFocus inputMode={phone ? 'tel' : 'email'} maxLength={255} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label={t('clients:sheet.contact.label')} optional>
            <Input maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label={t('clients:sheet.contact.belongsTo')}>
            <Select value={personId} onValueChange={setPersonId}>
              <option value="">{t('clients:sheet.contact.company')}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            {t('clients:sheet.contact.primary')}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
