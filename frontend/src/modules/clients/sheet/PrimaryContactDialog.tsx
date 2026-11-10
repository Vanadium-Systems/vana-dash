import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { SheetContactPoint } from './types'
import { useSheet, useWrite } from './use-sheet'

const primaryOf = (points: SheetContactPoint[], kind: 'phone' | 'email') => [...points].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).find((point) => point.kind === kind)

/** The pencil in the list: change the main phone and email of a company without opening its sheet. */
export function PrimaryContactDialog({ prospect, onOpenChange }: { prospect: { id: string; name: string } | null; onOpenChange: (open: boolean) => void }) {
  const write = useWrite()
  const sheet = useSheet(prospect?.id ?? '', prospect !== null)
  const points = sheet.data?.contactPoints
  const phone = points ? primaryOf(points, 'phone') : undefined
  const email = points ? primaryOf(points, 'email') : undefined
  const [phoneText, setPhoneText] = useState('')
  const [emailText, setEmailText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!points) return
    setPhoneText(primaryOf(points, 'phone')?.value ?? '')
    setEmailText(primaryOf(points, 'email')?.value ?? '')
  }, [points, prospect?.id])

  const save = async () => {
    if (!prospect) return
    const base = `/api/prospects/${prospect.id}/contact-points`
    // One request per changed field: an unchanged one is not sent, a cleared one is removed.
    const sync = async (kind: 'phone' | 'email', existing: SheetContactPoint | undefined, text: string) => {
      const value = text.trim()
      if (existing && value === existing.value) return
      if (existing && !value) await api.delete(`${base}/${existing.id}`)
      else if (existing) await api.patch(`${base}/${existing.id}`, { value })
      else if (value) await api.post(base, { kind, value, isPrimary: true })
    }
    setSaving(true)
    const done = await write(async () => {
      await sync('phone', phone, phoneText)
      await sync('email', email, emailText)
      return true
    })
    setSaving(false)
    if (done) onOpenChange(false)
  }

  return (
    <Dialog open={prospect !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clients:sheet.contact.primaryTitle', { name: prospect?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('clients:sheet.contact.primaryBody')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label={t('clients:sheet.contact.phone')} optional>
            <Input autoFocus inputMode="tel" maxLength={255} disabled={sheet.isPending} value={phoneText} onChange={(e) => setPhoneText(e.target.value)} />
          </Field>
          <Field label={t('clients:sheet.contact.email')} optional>
            <Input inputMode="email" maxLength={255} disabled={sheet.isPending} value={emailText} onChange={(e) => setEmailText(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving || sheet.isPending}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
