import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCheck, Clock, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { FeatureKey } from '@/shared/lib/types'
import type { AlertInstance, AlertRule, AlertSeverity } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { AlertRuleFormDialog } from './AlertRuleFormDialog'
import { RuleSparkline } from './RuleSparkline'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

// Citit și scris la alerte sunt funcționalități diferite: cine vede declanșările nu poate
// neapărat să editeze regulile care le produc (PLAN.md C2).
const TABS: Array<{ key: string; label: string; feature?: FeatureKey }> = [
  { key: 'active', label: t('alerts:tabs.active') },
  { key: 'istoric', label: t('common:nav.history') },
  { key: 'reguli', label: t('alerts:tabs.rules'), feature: 'alerte.reguli' },
]

const SEVERITY_TONE: Record<AlertSeverity, StateTone> = { critical: 'critical', warning: 'warning', info: 'neutral' }
const SEVERITY_LABEL: Record<AlertSeverity, string> = { critical: t('common:states.critical'), warning: t('common:states.warning'), info: t('common:states.info') }
const SEVERITY_GROUPS: AlertSeverity[] = ['critical', 'warning', 'info']

const SNOOZE_OPTIONS = [1, 3, 7] as const

const triggeredLabel = (iso: string) =>
  new Intl.DateTimeFormat(intlTag(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }).format(new Date(iso))

function useAlertActions() {
  const queryClient = useQueryClient()
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['alerts'] })
  const ack = useMutation({
    mutationFn: (id: string) => api.patch<AlertInstance>(`/api/alerts/${id}/ack`, {}),
    onSuccess: invalidate,
    onError: () => toast.error(t('alerts:ackFailed')),
  })
  const snooze = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => api.patch<AlertInstance>(`/api/alerts/${id}/snooze`, { days }),
    onSuccess: (_, { days }) => {
      invalidate()
      toast.success(t('alerts:snoozedFor', { days: t('common:count.days', { count: days }) }))
    },
    onError: () => toast.error(t('alerts:snoozeFailed')),
  })
  return { ack, snooze }
}

function AlertActions({ alert, compact }: { alert: AlertInstance; compact?: boolean }) {
  const { ack, snooze } = useAlertActions()
  return (
    <div className="flex items-center gap-1">
      {SNOOZE_OPTIONS.map((days) => (
        <Button
          key={days}
          variant="ghost"
          size={compact ? 'sm' : 'md'}
          title={t('alerts:snoozeFor', { days: t('common:count.days', { count: days }) })}
          disabled={snooze.isPending}
          onClick={(e) => {
            e.stopPropagation()
            snooze.mutate({ id: alert.id, days })
          }}
        >
          <Clock /> {days}z
        </Button>
      ))}
      <Button
        variant="outline"
        size={compact ? 'sm' : 'md'}
        disabled={ack.isPending}
        onClick={(e) => {
          e.stopPropagation()
          ack.mutate(alert.id)
        }}
      >
        <Check /> {t('common:actions.confirm')}
      </Button>
    </div>
  )
}

function AlertDetail({ alert }: { alert: AlertInstance }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <StatePill tone={SEVERITY_TONE[alert.severity]}>{SEVERITY_LABEL[alert.severity]}</StatePill>
        <p className="font-medium">{alert.message}</p>
        <p className="text-muted-foreground">
          {alert.ruleName} · {triggeredLabel(alert.triggeredAt)}
        </p>
      </div>
      {/* seria metricii regulii în fereastra ei (Contract F) */}
      {alert.ruleId ? <RuleSparkline ruleId={alert.ruleId} /> : null}
      <AlertActions alert={alert} />
      <Link to={`/alerts?tab=istoric&rule=${alert.ruleId}`} className="block text-xs text-muted-foreground underline underline-offset-2">
        {t('alerts:ruleHistory')}
      </Link>
    </div>
  )
}

/** Coada de triaj: grupată pe severitate, acțiunile la hover și la focus, detaliul în panou lateral. */
function ActiveAlertsSection() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const alerts = useQuery({
    queryKey: ['alerts', 'active'],
    queryFn: () => api.get<AlertInstance[]>('/api/alerts?status=active'),
  })

  if (alerts.isPending) {
    return (
      <div className="space-y-1" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  if (alerts.isError) {
    return (
      <p className="text-sm">
        {t('alerts:loadFailed')}{' '}
        <button type="button" className="underline underline-offset-2" onClick={() => void alerts.refetch()}>
          {t('common:actions.retry')}
        </button>
      </p>
    )
  }
  if (alerts.data.length === 0) {
    return <p className="rounded-md bg-muted/50 px-3 py-10 text-center text-sm text-muted-foreground">{t('alerts:noneActive')}</p>
  }

  const isDesktop = window.matchMedia('(min-width: 1024px)').matches
  // Pe desktop panoul arată din prima alerta cea mai gravă; pe mobil detaliul se deschide doar la atingere.
  const ordered = [...alerts.data].sort((a, b) => SEVERITY_GROUPS.indexOf(a.severity) - SEVERITY_GROUPS.indexOf(b.severity))
  const selected = alerts.data.find((a) => a.id === selectedId) ?? (isDesktop ? (ordered[0] ?? null) : null)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {SEVERITY_GROUPS.map((severity) => {
          const group = alerts.data.filter((a) => a.severity === severity)
          if (group.length === 0) return null
          return (
            <section key={severity} aria-label={SEVERITY_LABEL[severity]}>
              <h2 className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                {SEVERITY_LABEL[severity]} <span className="tnum">{group.length}</span>
              </h2>
              <ul className="divide-y">
                {group.map((alert) => (
                  <li
                    key={alert.id}
                    className={cn(
                      'group flex min-h-10 cursor-pointer items-center gap-3 px-2 py-1.5',
                      selected?.id === alert.id ? 'bg-accent' : 'hover:bg-accent/50',
                    )}
                    onClick={() => setSelectedId(alert.id)}
                  >
                    <StatePill tone={SEVERITY_TONE[alert.severity]} className="w-16 justify-center">
                      {SEVERITY_LABEL[alert.severity]}
                    </StatePill>
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setSelectedId(alert.id)}
                    >
                      <span className="block truncate text-sm">{alert.message}</span>
                      <span className="block truncate text-xs text-muted-foreground">{alert.ruleName}</span>
                    </button>
                    <span className="hidden shrink-0 font-mono text-xs text-muted-foreground tnum sm:inline">{triggeredLabel(alert.triggeredAt)}</span>
                    <div className="hidden shrink-0 md:block [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                      <AlertActions alert={alert} compact />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      <aside className="hidden lg:block" aria-label={t('alerts:detailAria')}>
        {selected ? <AlertDetail alert={selected} /> : <p className="text-sm text-muted-foreground">{t('alerts:pickOne')}</p>}
      </aside>
      <Dialog open={Boolean(selected) && !isDesktop} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-base">{t('alerts:alert')}</DialogTitle>
          </DialogHeader>
          {selected ? <AlertDetail alert={selected} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Istoric complet al declanșărilor (Contract F) — filtrabil pe regulă prin ?rule=<id>,
 *  deep-link din chips-urile asistentului ([[alert:<id>]] → /alerts?rule=<id>). */
function HistorySection({ ruleFilter }: { ruleFilter: string | null }) {
  const queryClient = useQueryClient()
  const rules = useQuery({
    queryKey: ['alert-rules'],
    queryFn: () => api.get<AlertRule[]>('/api/alert-rules'),
  })

  const history = useQuery({
    queryKey: ['alerts', 'history'],
    queryFn: () => api.get<AlertInstance[]>('/api/alerts?status=all'),
  })

  // Filtrul pe regulă e client-side — istoricul unui singur user e mic, nu justifică
  // încă un param server-side.
  const filtered = ruleFilter ? history.data?.filter((a) => a.ruleId === ruleFilter) : history.data

  const ackBulk = useMutation({
    mutationFn: () => api.post<{ acked: number }>('/api/alerts/ack-bulk', ruleFilter ? { ruleId: ruleFilter } : {}),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      void queryClient.invalidateQueries({ queryKey: ['active-count'] })
      toast.success(t('alerts:ackedMany', { count: result.acked }))
    },
    onError: () => toast.error(t('alerts:ackAllFailed')),
  })

  const activeInScope = (filtered ?? []).filter((a) => !a.acknowledgedAt)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {ruleFilter
            ? t('alerts:filteredByRule', { name: rules.data?.find((r) => r.id === ruleFilter)?.name ?? ruleFilter })
            : t('alerts:historyHint')}
        </p>
        <Button
          variant="outline"
          disabled={ackBulk.isPending || activeInScope.length === 0}
          onClick={() => ackBulk.mutate()}
        >
          <CheckCheck className="h-4 w-4" /> {t('alerts:ackAll')} {activeInScope.length > 0 ? `(${activeInScope.length})` : ''}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {history.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !filtered?.length ? (
            <p className="text-sm text-muted-foreground">{t('alerts:historyEmpty')}</p>
          ) : (
            // table-fixed + lățimi pe coloane: textul lung se taie cu „…" în loc să împingă tabelul
            // în scroll orizontal; coloanele secundare dispar pe ecrane înguste.
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">{t('common:labels.severity')}</TableHead>
                  <TableHead className="w-40 lg:w-56">{t('alerts:labels.rule')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('common:labels.message')}</TableHead>
                  <TableHead className="w-28">{t('alerts:labels.triggered')}</TableHead>
                  <TableHead className="hidden w-28 sm:table-cell">{t('common:labels.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell>
                      <StatePill tone={SEVERITY_TONE[alert.severity]}>{SEVERITY_LABEL[alert.severity]}</StatePill>
                    </TableCell>
                    <TableCell className="truncate font-medium" title={alert.ruleName}>
                      {alert.ruleName}
                    </TableCell>
                    <TableCell className="hidden truncate text-muted-foreground md:table-cell" title={alert.message}>
                      {alert.message}
                    </TableCell>
                    <TableCell className="truncate text-xs text-muted-foreground">{triggeredLabel(alert.triggeredAt)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {alert.acknowledgedAt ? (
                        <StatePill>{t('alerts:labels.acknowledged')}</StatePill>
                      ) : alert.snoozedUntil && new Date(alert.snoozedUntil) > new Date() ? (
                        <StatePill>{t('alerts:labels.snoozed')}</StatePill>
                      ) : (
                        <StatePill tone="warning">{t('common:states.activeF')}</StatePill>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RulesSection() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)

  const rules = useQuery({
    queryKey: ['alert-rules'],
    queryFn: () => api.get<AlertRule[]>('/api/alert-rules'),
  })

  const openCreate = () => {
    setEditingRule(null)
    setDialogOpen(true)
  }
  const openEdit = (rule: AlertRule) => {
    setEditingRule(rule)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> {t('alerts:rule.new')}
        </Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {rules.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !rules.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('alerts:rule.none')}</p>
          ) : (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.name')}</TableHead>
                  <TableHead className="hidden w-48 lg:table-cell">{t('alerts:labels.metric')}</TableHead>
                  <TableHead className="w-28">{t('alerts:rule.condition')}</TableHead>
                  <TableHead className="hidden w-20 text-right md:table-cell">{t('alerts:labels.window')}</TableHead>
                  <TableHead className="hidden w-24 sm:table-cell">{t('common:labels.severity')}</TableHead>
                  <TableHead className="hidden w-28 md:table-cell">{t('common:labels.status')}</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">{t('common:labels.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.data.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="truncate font-medium" title={rule.name}>
                      {rule.name}
                    </TableCell>
                    <TableCell className="hidden truncate font-mono text-xs lg:table-cell" title={rule.metricKey}>
                      {rule.metricKey}
                    </TableCell>
                    <TableCell className="tnum truncate">
                      {rule.condition} {rule.threshold}
                    </TableCell>
                    <TableCell className="tnum hidden text-right md:table-cell">{rule.windowHours}h</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatePill tone={SEVERITY_TONE[rule.severity]}>{SEVERITY_LABEL[rule.severity]}</StatePill>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {rule.enabled ? <StatePill tone="success">{t('common:states.activeF')}</StatePill> : <StatePill>{t('alerts:rule.disabled')}</StatePill>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>
                        {t('common:actions.edit')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <AlertRuleFormDialog open={dialogOpen} onOpenChange={setDialogOpen} rule={editingRule} />
    </div>
  )
}

export function AlertsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // Deep-link din chat: [[alert:<id>]] → /alerts?rule=<id> deschide istoricul filtrat (Contract F)
  const { can } = useMe()
  const tabs = TABS.filter((tab) => can(tab.feature))
  const ruleFilter = searchParams.get('rule')
  const tabParam = searchParams.get('tab')
  const tab = tabs.some((entry) => entry.key === tabParam) ? (tabParam as string) : ruleFilter ? 'istoric' : tabs[0]?.key

  function setTab(next: string) {
    const params: Record<string, string> = {}
    if (next !== 'active') params.tab = next
    if (ruleFilter) params.rule = ruleFilter
    setSearchParams(params)
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('common:nav.alerts')} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="active">
          <ActiveAlertsSection />
        </TabsContent>
        <TabsContent value="istoric">
          <HistorySection ruleFilter={ruleFilter} />
        </TabsContent>
        <TabsContent value="reguli">
          <RulesSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}
