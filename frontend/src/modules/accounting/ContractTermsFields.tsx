import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { Switch } from '@/shared/components/ui/switch'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { t } from '@/shared/lib/i18n'
import type { TermsErrors, TermsForm } from './contracts-logic'

/** Start, end, renewal and notice, shared by "new contract", "upload signed" and the edit form on the contract page. */
export function ContractTermsFields({
  idPrefix,
  value,
  errors,
  onChange,
}: {
  idPrefix: string
  value: TermsForm
  errors: TermsErrors
  onChange: (next: TermsForm) => void
}) {
  const set = (patch: Partial<TermsForm>) => onChange({ ...value, ...patch })
  const error = (key: keyof TermsErrors) => (errors[key] ? t(errors[key]!) : null)
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('accounting:contracts.terms.startsOn')} optional>
        <Input id={`${idPrefix}-starts`} type="date" value={value.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
      </Field>
      <Field label={t('accounting:contracts.terms.endsOn')} optional error={error('endsOn')}>
        <Input id={`${idPrefix}-ends`} type="date" value={value.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />
      </Field>
      <Field label={t('accounting:contracts.terms.noticeDays')} optional error={error('noticeDays')} hint={t('accounting:contracts.terms.noticeHint')}>
        <Input id={`${idPrefix}-notice`} inputMode="numeric" value={value.noticeDays} onChange={(e) => set({ noticeDays: e.target.value })} />
      </Field>
      <div className="space-y-1.5">
        <div className="flex min-h-control-md items-center gap-2 sm:pt-5">
          <Switch id={`${idPrefix}-renew`} checked={value.autoRenew} onCheckedChange={(autoRenew) => set({ autoRenew })} label={t('accounting:contracts.terms.autoRenew')} />
          <Label htmlFor={`${idPrefix}-renew`}>{t('accounting:contracts.terms.autoRenew')}</Label>
        </div>
      </div>
      {value.autoRenew ? (
        <Field label={t('accounting:contracts.terms.renewalMonths')} error={error('renewalMonths')}>
          <Input id={`${idPrefix}-months`} inputMode="numeric" value={value.renewalMonths} onChange={(e) => set({ renewalMonths: e.target.value })} />
        </Field>
      ) : null}
    </div>
  )
}

/** Only an admin can hand a contract to someone else; the others own what they make. */
export function ContractOwnerField({ id, value, onChange }: { id: string; value: string; onChange: (ownerUserId: string) => void }) {
  const { session } = useMe()
  const members = useTeamMembers()
  if (session?.user.role?.kind !== 'admin') return null
  return (
    <Field label={t('accounting:contracts.terms.owner')} optional>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('accounting:contracts.terms.ownerSelf')}</option>
        {(members.data ?? [])
          .filter((member) => member.status === 'active')
          .map((member) => (
            <option key={member.id} value={member.id}>
              {memberName(member)}
            </option>
          ))}
      </Select>
    </Field>
  )
}
