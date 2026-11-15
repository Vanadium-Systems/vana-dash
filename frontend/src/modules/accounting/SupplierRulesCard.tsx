import { Mail, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Select } from '@/shared/components/ui/select'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import {
  Table,
  TableBody,
  TableCell,
  TableDetails,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'
import type { ReverseChargeType, SupplierEmailRule } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import {
  type SupplierRulePayload,
  useBackfillSupplierRules,
  useCreateSupplierRule,
  useDeleteSupplierRule,
  useRecurringExpensesList,
  useSupplierRules,
  useUpdateSupplierRule,
} from './hooks'

interface RuleFormState {
  id: string | null
  senderPattern: string
  subjectContains: string
  attachmentNamePattern: string
  counterpartyName: string
  counterpartyCif: string
  counterpartyCountry: string
  currency: 'RON' | 'EUR' | 'USD'
  category: string
  reverseChargeType: ReverseChargeType
  reverseChargeVatRate: string
  recurringExpenseId: string
  active: boolean
}

const EMPTY_FORM: RuleFormState = {
  id: null,
  senderPattern: '',
  subjectContains: '',
  attachmentNamePattern: '',
  counterpartyName: '',
  counterpartyCif: '',
  counterpartyCountry: '',
  currency: 'EUR',
  category: '',
  reverseChargeType: 'none',
  reverseChargeVatRate: '21',
  recurringExpenseId: '',
  active: true,
}

const PRESET_ANTHROPIC: RuleFormState = {
  ...EMPTY_FORM,
  senderPattern: 'invoice+statements@mail.anthropic.com',
  attachmentNamePattern: 'Invoice-',
  counterpartyName: 'Anthropic, PBC',
  counterpartyCif: '',
  counterpartyCountry: 'US',
  currency: 'EUR',
  category: 'AI / Cloud',
  reverseChargeType: 'non_eu_services',
  reverseChargeVatRate: '0',
}

const PRESET_HETZNER: RuleFormState = {
  ...EMPTY_FORM,
  senderPattern: '@hetzner.com',
  attachmentNamePattern: '',
  counterpartyName: 'Hetzner Online GmbH',
  counterpartyCif: 'DE812871812',
  counterpartyCountry: 'DE',
  currency: 'EUR',
  category: 'Hosting',
  reverseChargeType: 'eu_services',
  reverseChargeVatRate: '21',
}

function fromRule(rule: SupplierEmailRule): RuleFormState {
  return {
    id: rule.id,
    senderPattern: rule.senderPattern,
    subjectContains: rule.subjectContains ?? '',
    attachmentNamePattern: rule.attachmentNamePattern ?? '',
    counterpartyName: rule.counterpartyName,
    counterpartyCif: rule.counterpartyCif ?? '',
    counterpartyCountry: rule.counterpartyCountry ?? '',
    currency: rule.currency,
    category: rule.category ?? '',
    reverseChargeType: rule.reverseChargeType,
    reverseChargeVatRate:
      rule.reverseChargeVatRate != null ? String(rule.reverseChargeVatRate) : '',
    recurringExpenseId: rule.recurringExpenseId ?? '',
    active: rule.active,
  }
}

function reverseChargeLabel(type: ReverseChargeType): string {
  if (type === 'eu_services') return t('accounting:reverseCharge.eu')
  if (type === 'non_eu_services') return t('accounting:reverseCharge.nonEu')
  return t('accounting:reverseCharge.none')
}

export function SupplierRulesCard() {
  const confirm = useConfirm()
  const { can } = useMe()
  const canRecurring = can('facturi.cheltuieli')
  const rulesQuery = useSupplierRules()
  const recurringQuery = useRecurringExpensesList(canRecurring)
  const createRule = useCreateSupplierRule()
  const updateRule = useUpdateSupplierRule()
  const deleteRule = useDeleteSupplierRule()
  const backfill = useBackfillSupplierRules()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM)

  const openNew = (preset: RuleFormState = EMPTY_FORM) => {
    setForm(preset)
    setDialogOpen(true)
  }

  const openEdit = (rule: SupplierEmailRule) => {
    setForm(fromRule(rule))
    setDialogOpen(true)
  }

  const handleBackfill = () => {
    backfill.mutate(
      { months: 3 },
      {
        onSuccess: (res) => {
          toast.success(
            t('accounting:supplierRules.backfillResult', {
              scanned: res.scannedMessages,
              created: res.createdRecords,
              linked: res.linkedRecurring,
              skipped: res.skippedExisting,
            }),
          )
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const parsedVat = form.reverseChargeVatRate.trim()
      ? parseRoDecimal(form.reverseChargeVatRate)
      : null
    const payload: SupplierRulePayload = {
      senderPattern: form.senderPattern.trim().toLowerCase(),
      subjectContains: form.subjectContains.trim() || null,
      attachmentNamePattern: form.attachmentNamePattern.trim() || null,
      counterpartyName: form.counterpartyName.trim(),
      counterpartyCif: form.counterpartyCif.trim() || null,
      counterpartyCountry: form.counterpartyCountry.trim().toUpperCase() || null,
      currency: form.currency,
      category: form.category.trim() || null,
      reverseChargeType: form.reverseChargeType,
      reverseChargeVatRate:
        form.reverseChargeType === 'none'
          ? null
          : parsedVat != null && Number.isFinite(parsedVat)
            ? parsedVat
            : null,
      recurringExpenseId: form.recurringExpenseId || null,
      active: form.active,
    }

    if (form.id) {
      updateRule.mutate(
        { id: form.id, ...payload },
        {
          onSuccess: () => {
            toast.success(t('accounting:supplierRules.savedToast'))
            setDialogOpen(false)
          },
          onError: (err) => toast.error(err.message),
        },
      )
      return
    }

    createRule.mutate(payload, {
      onSuccess: () => {
        toast.success(t('accounting:supplierRules.savedToast'))
        setDialogOpen(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const handleDelete = (rule: SupplierEmailRule) => {
    void confirm({
      title: t('accounting:supplierRules.deleteConfirmTitle', { name: rule.counterpartyName }),
      consequence: t('accounting:supplierRules.deleteConfirmDesc'),
      confirmLabel: t('accounting:supplierRules.delete'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      deleteRule.mutate(rule.id, {
        onSuccess: () => toast.success(t('accounting:supplierRules.deletedToast')),
        onError: (err) => toast.error(err.message),
      })
    })
  }

  const rules = rulesQuery.data ?? []
  const recurringExpenses = recurringQuery.data ?? []
  const saving = createRule.isPending || updateRule.isPending

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              {t('accounting:supplierRules.title')}
            </CardTitle>
            <CardDescription>{t('accounting:supplierRules.subtitle')}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openNew(PRESET_ANTHROPIC)}
            >
              {t('accounting:supplierRules.presetAnthropic')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openNew(PRESET_HETZNER)}
            >
              {t('accounting:supplierRules.presetHetzner')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={backfill.isPending}
              onClick={handleBackfill}
            >
              <Search className="h-3.5 w-3.5" />
              {backfill.isPending
                ? t('accounting:supplierRules.backfillRunning')
                : t('accounting:supplierRules.backfillButton')}
            </Button>
            <Button type="button" size="sm" onClick={() => openNew(EMPTY_FORM)}>
              <Plus className="h-3.5 w-3.5" />
              {t('accounting:supplierRules.addRule')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rulesQuery.isPending ? (
            <ListSkeleton rows={3} />
          ) : rulesQuery.isError ? (
            <Alert tone="critical" title={rulesQuery.error.message} />
          ) : rules.length === 0 ? (
            <EmptyState kind="new" title={t('accounting:supplierRules.empty')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('accounting:supplierRules.counterpartyName')}</TableHead>
                  <TableHead priority="md">{t('accounting:supplierRules.senderPattern')}</TableHead>
                  <TableHead priority="lg">{t('accounting:supplierRules.reverseChargeType')}</TableHead>
                  <TableHead priority="md">{t('accounting:monthClose.columns.status')}</TableHead>
                  <TableHead className="w-1 text-right">
                    <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="tbl-fill font-medium">
                      <div className="truncate">{rule.counterpartyName}</div>
                      {(rule.counterpartyCif || rule.counterpartyCountry) ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {[rule.counterpartyCif, rule.counterpartyCountry].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                      <TableDetails
                        items={[
                          rule.senderPattern,
                          rule.attachmentNamePattern,
                          reverseChargeLabel(rule.reverseChargeType),
                          <StatePill key="active" tone={rule.active ? 'success' : 'neutral'}>
                            {t(rule.active ? 'common:states.active' : 'common:states.inactive')}
                          </StatePill>,
                        ]}
                      />
                    </TableCell>
                    <TableCell priority="md">
                      <div className="truncate font-mono text-xs">{rule.senderPattern}</div>
                      {rule.attachmentNamePattern ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {rule.attachmentNamePattern}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell priority="lg" className="text-sm text-muted-foreground">
                      {reverseChargeLabel(rule.reverseChargeType)}
                    </TableCell>
                    <TableCell priority="md">
                      <StatePill tone={rule.active ? 'success' : 'neutral'}>
                        {t(rule.active ? 'common:states.active' : 'common:states.inactive')}
                      </StatePill>
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        title={rule.counterpartyName}
                        actions={[
                          {
                            key: 'edit',
                            icon: Pencil,
                            label: t('accounting:supplierRules.edit'),
                            onClick: () => openEdit(rule),
                          },
                          {
                            key: 'delete',
                            icon: Trash2,
                            label: t('accounting:supplierRules.delete'),
                            destructive: true,
                            onClick: () => handleDelete(rule),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? t('accounting:supplierRules.edit') : t('accounting:supplierRules.addRule')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <Field
              label={t('accounting:supplierRules.senderPattern')}
              hint={t('accounting:supplierRules.senderPatternHint')}
            >
              <Input
                id="sr-sender"
                value={form.senderPattern}
                onChange={(e) => setForm((f) => ({ ...f, senderPattern: e.target.value }))}
                required
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('accounting:supplierRules.attachmentNamePattern')}
                hint={t('accounting:supplierRules.attachmentNamePatternHint')}
              >
                <Input
                  id="sr-att"
                  value={form.attachmentNamePattern}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, attachmentNamePattern: e.target.value }))
                  }
                />
              </Field>
              <Field label={t('accounting:supplierRules.subjectContains')}>
                <Input
                  id="sr-subject"
                  value={form.subjectContains}
                  onChange={(e) => setForm((f) => ({ ...f, subjectContains: e.target.value }))}
                />
              </Field>
            </div>

            <Field label={t('accounting:supplierRules.counterpartyName')}>
              <Input
                id="sr-name"
                value={form.counterpartyName}
                onChange={(e) => setForm((f) => ({ ...f, counterpartyName: e.target.value }))}
                required
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('accounting:supplierRules.counterpartyCif')}>
                <Input
                  id="sr-cif"
                  value={form.counterpartyCif}
                  onChange={(e) => setForm((f) => ({ ...f, counterpartyCif: e.target.value }))}
                />
              </Field>
              <Field label={t('accounting:supplierRules.counterpartyCountry')}>
                <Input
                  id="sr-country"
                  maxLength={2}
                  value={form.counterpartyCountry}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, counterpartyCountry: e.target.value.toUpperCase() }))
                  }
                />
              </Field>
              <Field label={t('accounting:supplierRules.currency')}>
                <Select
                  id="sr-currency"
                  value={form.currency}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      currency: e.target.value as 'RON' | 'EUR' | 'USD',
                    }))
                  }
                >
                  <option value="EUR">EUR</option>
                  <option value="RON">RON</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('accounting:supplierRules.reverseChargeType')}>
                <Select
                  id="sr-rc"
                  value={form.reverseChargeType}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      reverseChargeType: e.target.value as ReverseChargeType,
                    }))
                  }
                >
                  <option value="none">{t('accounting:reverseCharge.none')}</option>
                  <option value="eu_services">{t('accounting:reverseCharge.eu')}</option>
                  <option value="non_eu_services">{t('accounting:reverseCharge.nonEu')}</option>
                </Select>
              </Field>
              {form.reverseChargeType !== 'none' ? (
                <Field label={t('accounting:supplierRules.reverseChargeVatRate')}>
                  <Input
                    id="sr-vat"
                    inputMode="decimal"
                    value={form.reverseChargeVatRate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, reverseChargeVatRate: e.target.value }))
                    }
                  />
                </Field>
              ) : (
                <Field label={t('accounting:supplierRules.category')}>
                  <Input
                    id="sr-cat"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  />
                </Field>
              )}
            </div>

            {canRecurring && (
              <Field label={t('accounting:supplierRules.recurringExpenseId')}>
                <Select
                  id="sr-rec"
                  value={form.recurringExpenseId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recurringExpenseId: e.target.value }))
                  }
                >
                  <option value="">{t('accounting:supplierRules.noRecurringLink')}</option>
                  {recurringExpenses.map((rec) => (
                    <option key={rec.id} value={rec.id}>
                      {rec.counterpartyName ? `${rec.counterpartyName} - ${rec.description}` : rec.description}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>{t('accounting:supplierRules.active')}</span>
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t('accounting:supplierRules.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {t('accounting:supplierRules.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
