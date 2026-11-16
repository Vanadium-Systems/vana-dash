import { t } from '@/shared/lib/i18n'
import { EmailWidget, PinnedNoteWidget, PlatformStatusWidget, TodayWidget, ToResolveWidget, UnreadMessagesWidget } from './core-widgets'
import { CollectedWidget, ExpensesByCategoryWidget, RevenueWidget, YearGridWidget } from './money-widgets'
import type { WidgetDef } from './types'
import { DeadlinesWidget, FunnelWidget, MyTasksWidget, NewTendersWidget, PlanNextWidget, QuickNoteWidget, ReceivableWidget, SuggestedLeadsWidget } from './work-widgets'

// The Home widgets. Ids, sizes and features mirror the backend's `modules/overview/widgets.ts`
// (a test compares them): the server filters a layout by feature, this list hides the same
// widgets from the catalog. Each widget asks its own module for data, under its own feature.
export const WIDGETS: WidgetDef[] = [
  {
    id: 'collected',
    feature: 'financiar.view',
    sizes: ['w', 'l'],
    module: () => t('common:nav.financials'),
    title: () => t('overview:widgets.collected'),
    description: () => t('overview:catalog.collected'),
    component: CollectedWidget,
  },
  {
    id: 'revenue',
    feature: 'financiar.view',
    sizes: ['w', 'l', 'band'],
    module: () => t('common:nav.financials'),
    title: () => t('overview:widgets.revenue'),
    description: () => t('overview:catalog.revenue'),
    component: RevenueWidget,
  },
  {
    id: 'today',
    feature: 'calendar.view',
    sizes: ['w', 'l'],
    module: () => t('common:nav.calendar'),
    title: () => t('overview:calendar.title'),
    description: () => t('overview:catalog.today'),
    component: TodayWidget,
  },
  {
    id: 'to_resolve',
    feature: 'alerte.view',
    sizes: ['w', 'l'],
    module: () => t('common:nav.alerts'),
    title: () => t('overview:todo.title'),
    description: () => t('overview:catalog.toResolve'),
    component: ToResolveWidget,
  },
  {
    id: 'unread_messages',
    feature: 'mesaje.view',
    sizes: ['s', 'w'],
    module: () => t('common:nav.messages'),
    title: () => t('overview:messages.unread'),
    description: () => t('overview:catalog.unreadMessages'),
    component: UnreadMessagesWidget,
  },
  {
    id: 'email',
    feature: 'email.view',
    sizes: ['w', 'l'],
    module: () => t('common:nav.email'),
    title: () => t('overview:email.newThreads'),
    description: () => t('overview:catalog.email'),
    component: EmailWidget,
  },
  {
    id: 'pinned_note',
    feature: 'notite.view',
    sizes: ['s', 'l'],
    module: () => t('common:nav.notes'),
    title: () => t('overview:notes.pinned'),
    description: () => t('overview:catalog.pinnedNote'),
    component: PinnedNoteWidget,
  },
  {
    id: 'platform_status',
    feature: 'platforme.view',
    sizes: ['s', 'w'],
    module: () => t('common:nav.platforms'),
    title: () => t('overview:widgets.platforms'),
    description: () => t('overview:catalog.platformStatus'),
    component: PlatformStatusWidget,
  },
  {
    id: 'receivable',
    feature: 'facturi.view',
    sizes: ['s', 'w'],
    module: () => t('common:nav.invoices'),
    title: () => t('overview:widgets.receivable'),
    description: () => t('overview:catalog.receivable'),
    component: ReceivableWidget,
  },
  {
    id: 'expenses_by_category',
    feature: 'financiar.view',
    sizes: ['w', 'l'],
    module: () => t('common:nav.financials'),
    title: () => t('overview:widgets.expensesByCategory'),
    description: () => t('overview:catalog.expensesByCategory'),
    component: ExpensesByCategoryWidget,
  },
  {
    id: 'plan_next',
    feature: 'notite.view',
    sizes: ['s', 'w'],
    module: () => t('common:nav.plan'),
    title: () => t('overview:widgets.planNext'),
    description: () => t('overview:catalog.planNext'),
    component: PlanNextWidget,
  },
  {
    id: 'my_tasks',
    feature: 'clienti.view',
    sizes: ['s', 'w', 'l'],
    module: () => t('common:nav.clients'),
    title: () => t('overview:widgets.myTasks'),
    description: () => t('overview:catalog.myTasks'),
    component: MyTasksWidget,
  },
  {
    id: 'deadlines',
    feature: 'facturi.view',
    sizes: ['s', 'w'],
    module: () => t('common:nav.invoices'),
    title: () => t('overview:widgets.deadlines'),
    description: () => t('overview:catalog.deadlines'),
    component: DeadlinesWidget,
  },
  {
    id: 'quick_note',
    feature: 'notite.view',
    sizes: ['w'],
    module: () => t('common:nav.notes'),
    title: () => t('overview:widgets.quickNote'),
    description: () => t('overview:catalog.quickNote'),
    component: QuickNoteWidget,
  },
  {
    id: 'suggested_leads',
    feature: 'clienti.view',
    sizes: ['w', 'l'],
    module: () => t('common:nav.clients'),
    title: () => t('overview:widgets.suggestedLeads'),
    description: () => t('overview:catalog.suggestedLeads'),
    component: SuggestedLeadsWidget,
  },
  {
    id: 'funnel',
    feature: 'clienti.view',
    sizes: ['w', 'l'],
    module: () => t('common:nav.clients'),
    title: () => t('overview:widgets.funnel'),
    description: () => t('overview:catalog.funnel'),
    component: FunnelWidget,
  },
  {
    id: 'year_grid',
    feature: 'financiar.view',
    sizes: ['band'],
    module: () => t('common:nav.financials'),
    title: () => t('overview:widgets.yearGrid'),
    description: () => t('overview:catalog.yearGrid'),
    component: YearGridWidget,
  },
  {
    id: 'new_tenders',
    feature: 'licitatii.view',
    sizes: ['w'],
    module: () => t('common:nav.tenders'),
    title: () => t('overview:widgets.newTenders'),
    description: () => t('overview:catalog.newTenders'),
    component: NewTendersWidget,
  },
]

export const WIDGET_BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]))

/** The widgets this person may place: the feature gate, the same as the server's. */
export function availableWidgets(can: (feature: string) => boolean): WidgetDef[] {
  return WIDGETS.filter((widget) => widget.feature === null || can(widget.feature))
}
