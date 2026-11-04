import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api, ApiError } from '@/shared/lib/api'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { EmailBlocklistEntry, EmailLabel, EmailRule, EmailRuleAction, EmailRuleMatchType, SuppressionsOverview } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { SettingsSection } from './SettingsLayout'

// The cards shared by the company's Email settings (email.setari) and a person's own settings
// (email.setari_proprii): labels and rules per scope, the blocklist and unsubscribes read-only
// for a colleague.

type Scope = 'company' | 'mine'

export function LabelsCard({ scope }: { scope: Scope }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const base = scope === 'mine' ? '/api/email/me/labels' : '/api/email/labels'
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['email', 'labels'] })
    void queryClient.invalidateQueries({ queryKey: ['email', 'me', 'labels'] })
  }

  // GET /api/email/labels gives the company's labels and the person's own; the company card lists
  // only the company's, the person's card asks its own route.
  const labels = useQuery({
    queryKey: scope === 'mine' ? ['email', 'me', 'labels'] : ['email', 'labels'],
    queryFn: () => api.get<EmailLabel[]>(base),
    select: (rows) => (scope === 'mine' ? rows : rows.filter((l) => !l.ownerUserId)),
  })

  const create = useMutation({
    mutationFn: () => api.post(base, { name }),
    onSuccess: () => {
      setName('')
      refresh()
    },
    onError: (err) => toast.error(err instanceof ApiError && err.code === 'LABEL_NAME_TAKEN' ? t('email:settings.labelTaken') : err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/${id}`),
    onSuccess: refresh,
  })

  // Automatically labelled DMARC reports flooded a user with push notifications.
  // Checked = no notifications for messages with this label (they still arrive and get labelled).
  const toggleNotifications = useMutation({
    mutationFn: ({ id, notificationsEnabled }: { id: string; notificationsEnabled: boolean }) => api.patch(`${base}/${id}`, { notificationsEnabled }),
    onSuccess: refresh,
    onError: (err) => toast.error(err.message),
  })

  return (
    <SettingsSection
      title={scope === 'mine' ? t('email:mySettings.labels') : t('email:labels.labels')}
      description={scope === 'mine' ? t('email:mySettings.labelsHint') : undefined}
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <Input
          className="max-w-sm"
          aria-label={t('email:settings.newLabelPlaceholder')}
          placeholder={t('email:settings.newLabelPlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={create.isPending}>
          {t('common:actions.add')}
        </Button>
      </form>
      <div className="space-y-1">
        {labels.data?.map((l) => (
          <div key={l.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
            <span>{l.name}</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!l.notificationsEnabled}
                  onChange={(e) =>
                    toggleNotifications.mutate({
                      id: l.id,
                      notificationsEnabled: !e.target.checked,
                    })
                  }
                />
                {t('email:settings.noNotifications')}
              </label>
              <Button variant="outline" onClick={() => remove.mutate(l.id)}>
                {t('common:actions.delete')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

const MATCH_TYPE_LABEL: Record<EmailRuleMatchType, string> = {
  from_address: t('email:rules.fromExactAddress'),
  from_domain: t('email:rules.fromDomain'),
  subject_contains: t('email:rules.subjectContains'),
}
const ACTION_LABEL: Record<EmailRuleAction, string> = {
  label: t('email:rules.actionLabel'),
  archive: t('common:actions.archive'),
  trash: t('common:actions.delete'),
  spam: t('email:rules.actionSpam'),
}

export function RulesCard({ scope }: { scope: Scope }) {
  const queryClient = useQueryClient()
  const base = scope === 'mine' ? '/api/email/me/rules' : '/api/email/rules'
  const rulesKey = scope === 'mine' ? ['email', 'me', 'rules'] : ['email', 'rules']
  const [form, setForm] = useState<{
    matchType: EmailRuleMatchType
    matchValue: string
    action: EmailRuleAction
    labelId: string
  }>({
    matchType: 'from_domain',
    matchValue: '',
    action: 'label',
    labelId: '',
  })

  const rules = useQuery({
    queryKey: rulesKey,
    queryFn: () => api.get<EmailRule[]>(base),
  })
  // A company rule labels only with company labels; a person's rule also with their own.
  const labels = useQuery({
    queryKey: ['email', 'labels'],
    queryFn: () => api.get<EmailLabel[]>('/api/email/labels'),
    select: (rows) => (scope === 'mine' ? rows : rows.filter((l) => !l.ownerUserId)),
  })

  const create = useMutation({
    mutationFn: () =>
      api.post(base, {
        matchType: form.matchType,
        matchValue: form.matchValue,
        action: form.action,
        ...(form.action === 'label' ? { labelId: form.labelId } : {}),
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, matchValue: '' }))
      void queryClient.invalidateQueries({ queryKey: rulesKey })
      toast.success(t('email:rules.created'))
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: rulesKey }),
  })

  const applyExisting = useMutation({
    mutationFn: (id: string) => api.post<{ affected: number }>(`/api/email/rules/${id}/apply-existing`),
    // A rule applied retroactively can move messages between folders and change their read state
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'threads'] })
      void queryClient.invalidateQueries({
        queryKey: ['email', 'unread-counts'],
      })
      toast.success(t('email:rules.appliedTo', { affected: result.affected }))
    },
    onError: (err) => toast.error(err.message),
  })

  const labelName = (id: string | null) => labels.data?.find((l) => l.id === id)?.name ?? '—'

  return (
    <SettingsSection
      title={scope === 'mine' ? t('email:mySettings.rules') : t('email:rules.title')}
      description={scope === 'mine' ? t('email:mySettings.rulesHint') : undefined}
    >
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (form.matchValue.trim()) create.mutate()
        }}
      >
        <Select
          className="w-auto"
          value={form.matchType}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              matchType: e.target.value as EmailRuleMatchType,
            }))
          }
        >
          {Object.entries(MATCH_TYPE_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          aria-label={t('email:rules.valuePlaceholder')}
          placeholder={t('email:rules.valuePlaceholder')}
          value={form.matchValue}
          onChange={(e) => setForm((f) => ({ ...f, matchValue: e.target.value }))}
        />
        <Select
          className="w-auto"
          value={form.action}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              action: e.target.value as EmailRuleAction,
            }))
          }
        >
          {Object.entries(ACTION_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        {form.action === 'label' ? (
          <Select className="w-auto" value={form.labelId} onChange={(e) => setForm((f) => ({ ...f, labelId: e.target.value }))} required>
            <option value="">{t('email:rules.pickLabel')}</option>
            {labels.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        ) : (
          <div />
        )}
        <Button type="submit" className="sm:col-span-2" disabled={create.isPending}>
          {t('email:rules.add')}
        </Button>
      </form>
      <div className="space-y-1">
        {rules.data?.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
            <span>
              {MATCH_TYPE_LABEL[r.matchType]} <strong>{r.matchValue}</strong> → {ACTION_LABEL[r.action]}
              {r.action === 'label' ? ` (${labelName(r.labelId)})` : ''}
            </span>
            <div className="flex gap-1">
              {scope === 'company' ? (
                <Button variant="outline" onClick={() => applyExisting.mutate(r.id)}>
                  {t('email:rules.applyRetroactively')}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => remove.mutate(r.id)}>
                {t('common:actions.delete')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

export function BlocklistCard({ readOnly = false }: { readOnly?: boolean }) {
  const queryClient = useQueryClient()
  const [address, setAddress] = useState('')

  const blocklist = useQuery({
    queryKey: readOnly ? ['email', 'me', 'blocklist'] : ['email', 'blocklist'],
    queryFn: () => api.get<EmailBlocklistEntry[]>(readOnly ? '/api/email/me/blocklist' : '/api/email/blocklist'),
  })

  const add = useMutation({
    mutationFn: () => api.post('/api/email/blocklist', { address }),
    onSuccess: () => {
      setAddress('')
      void queryClient.invalidateQueries({ queryKey: ['email', 'blocklist'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/email/blocklist/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email', 'blocklist'] }),
  })

  const applyExisting = useMutation({
    mutationFn: (id: string) => api.post<{ affected: number }>(`/api/email/blocklist/${id}/apply-existing`),
    // Messages moved to trash change the thread list and the unread counts
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'threads'] })
      void queryClient.invalidateQueries({
        queryKey: ['email', 'unread-counts'],
      })
      toast.success(t('email:blocklist.movedToTrash', { affected: result.affected }))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <SettingsSection title={t('email:blocklist.title')} description={readOnly ? t('email:mySettings.readOnlyHint') : undefined}>
      {readOnly ? null : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (address.trim()) add.mutate()
          }}
        >
          <Input
            type="email"
            className="max-w-sm"
            placeholder={t('email:blocklist.placeholder')}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Button type="submit" disabled={add.isPending}>
            {t('common:actions.block')}
          </Button>
        </form>
      )}
      {readOnly && blocklist.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t('email:mySettings.emptyList')}</p> : null}
      <div className="space-y-1">
        {blocklist.data?.map((b) => (
          <div key={b.id} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
            <span className="min-w-0 truncate">{b.address}</span>
            {readOnly ? null : (
              <div className="flex gap-1">
                <Button variant="outline" onClick={() => applyExisting.mutate(b.id)}>
                  {t('email:rules.applyRetroactively')}
                </Button>
                <Button variant="outline" onClick={() => remove.mutate(b.id)}>
                  {t('common:actions.unblock')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

function formatDay(iso: string): string {
  return formatDate(iso, { dateStyle: 'medium' })
}

// Closed by default: the lists grow with every campaign and, all open, made the settings tab one
// long scroll down to the last card.
function SuppressionSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Button variant="ghost" aria-expanded={open} disabled={count === 0} onClick={() => setOpen((v) => !v)}>
        <ChevronRight className={cn('transition-transform duration-150', open && 'rotate-90')} />
        {title} <span className="tnum text-muted-foreground">({count})</span>
      </Button>
      {open ? <div className="max-h-96 overflow-y-auto">{children}</div> : null}
    </div>
  )
}

// Only a count on "Unsubscribes" (SentTab.tsx) was visible, not the actual list.
// 3 separate tables: manually unsubscribed (a real click on the link), auto-unsubscribed
// (bounce/complaint, from the Resend webhook), and bounces aggregated per recipient (may include
// addresses that have not yet hit the suppression threshold; see getSuppressionsOverview,
// backend/unsubscribe-service.ts).
export function SuppressionsCard({ readOnly = false }: { readOnly?: boolean }) {
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: readOnly ? ['email', 'me', 'suppressions'] : ['email', 'suppressions-overview'],
    queryFn: () => api.get<SuppressionsOverview>(readOnly ? '/api/email/me/suppressions' : '/api/email/suppressions-overview'),
  })

  // Purely internal table (see the comment in unsubscribe-service.ts): deleting here reports
  // nothing externally, it only stops skipping the address in bulk sends/sequences. Real cases:
  // a transient bounce that blocked sending to a live contact (not a dead address), and the
  // owner's own address (template testing).
  const remove = useMutation({
    mutationFn: (email: string) => api.delete(`/api/email/suppressions/${encodeURIComponent(email)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['email', 'suppressions-overview'],
      })
      toast.success(t('email:suppressions.removed'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (overview.isPending) return <Skeleton className="h-48 w-full" />

  const data = overview.data
  if (!data) return null

  return (
    <SettingsSection title={t('email:suppressions.title')} description={readOnly ? t('email:mySettings.suppressionsHint') : t('email:suppressions.hint')}>
      <SuppressionSection title={t('email:suppressions.manual')} count={data.unsubscribed.length}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common:labels.email')}</TableHead>
              <TableHead priority="md">{t('email:suppressions.unsubscribedAt')}</TableHead>
              {readOnly ? null : (
                <TableHead className="text-right">
                  <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.unsubscribed.map((r) => (
              <TableRow key={r.email}>
                <TableCell className="w-full max-w-0 text-sm">
                  <div className="truncate">{r.email}</div>
                  <TableDetails items={[formatDay(r.unsubscribedAt)]} />
                </TableCell>
                <TableCell priority="md" className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDay(r.unsubscribedAt)}
                </TableCell>
                {readOnly ? null : (
                  <TableCell className="text-right">
                    <RowActions
                      actions={[
                        {
                          key: 'remove',
                          icon: Trash2,
                          label: t('common:actions.remove'),
                          disabled: remove.isPending,
                          onClick: () => remove.mutate(r.email),
                        },
                      ]}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SuppressionSection>

      <SuppressionSection title={t('email:suppressions.auto')} count={data.autoUnsubscribed.length}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common:labels.email')}</TableHead>
              <TableHead>{t('common:labels.reason')}</TableHead>
              <TableHead priority="md">{t('email:suppressions.at')}</TableHead>
              {readOnly ? null : (
                <TableHead className="text-right">
                  <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.autoUnsubscribed.map((r) => (
              <TableRow key={r.email}>
                <TableCell className="w-full max-w-0 text-sm">
                  <div className="truncate">{r.email}</div>
                  <TableDetails items={[formatDay(r.unsubscribedAt)]} />
                </TableCell>
                <TableCell>
                  <StatePill tone={r.source === 'complaint' ? 'critical' : 'warning'}>
                    {r.source === 'complaint' ? t('email:folders.spam') : t('email:status.bounceShort')}
                  </StatePill>
                </TableCell>
                <TableCell priority="md" className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDay(r.unsubscribedAt)}
                </TableCell>
                {readOnly ? null : (
                  <TableCell className="text-right">
                    <RowActions
                      actions={[
                        {
                          key: 'remove',
                          icon: Trash2,
                          label: t('common:actions.remove'),
                          disabled: remove.isPending,
                          onClick: () => remove.mutate(r.email),
                        },
                      ]}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SuppressionSection>

      <SuppressionSection title={t('email:suppressions.bounced')} count={data.bounced.length}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common:labels.recipient')}</TableHead>
              <TableHead className="text-right">{t('email:suppressions.howManyTimes')}</TableHead>
              <TableHead priority="md" className="text-right">
                {t('email:suppressions.lastBounce')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.bounced.map((r) => (
              <TableRow key={r.recipient}>
                <TableCell className="w-full max-w-0 text-sm">
                  <div className="truncate">{r.recipient}</div>
                  <TableDetails items={[formatDay(r.lastBouncedAt)]} />
                </TableCell>
                <TableCell className="text-right text-sm">{r.count}</TableCell>
                <TableCell priority="md" className="whitespace-nowrap text-right text-xs text-muted-foreground">
                  {formatDay(r.lastBouncedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SuppressionSection>
    </SettingsSection>
  )
}
