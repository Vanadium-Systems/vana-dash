import { useMemo } from 'react'
import type { FilterField } from '@/shared/lib/filters'
import { t } from '@/shared/lib/i18n'
import type { ProspectAssignee } from '@/shared/lib/types'
import type { ProspectKind, ProspectList } from './types'
import type { ProspectStatusEntry } from '@/shared/lib/types'

const NO_LISTS: ProspectList[] = []

export function useFilterFields(kind: ProspectKind, statuses: ProspectStatusEntry[], assignees: ProspectAssignee[], lists: ProspectList[] = NO_LISTS): FilterField[] {
  return useMemo(() => {
    const sales = t('pricing:prospects.filters.sales')
    const company = t('pricing:prospects.filters.company')
    const activity = t('pricing:prospects.filters.activity')
    const fields: FilterField[] = [
      { key: 'status', label: t('common:labels.status'), type: 'enum', group: sales, defaultPinned: true, options: statuses.map((s) => ({ value: s.key, label: s.label })) },
      { key: 'priority', label: t('common:labels.priority'), type: 'enum', group: sales, defaultPinned: true, options: (['HOT', 'WARM', 'NURTURE', 'SKIP'] as const).map((value) => ({ value, label: value })) },
      {
        key: 'owner',
        label: t('pricing:prospects.owner'),
        type: 'enum',
        group: sales,
        defaultPinned: true,
        options: [
          { value: 'me', label: t('pricing:prospects.mine') },
          { value: 'free', label: t('pricing:prospects.filters.unassigned') },
          ...assignees.map((a) => ({ value: a.id, label: a.displayName ?? a.email })),
        ],
      },
      { key: 'list', label: t('clients:lists.filterLabel'), type: 'enum', group: sales, options: lists.map((list) => ({ value: list.id, label: list.name })) },
      { key: 'score', label: t('pricing:prospects.score'), type: 'number', group: sales },
      { key: 'value', label: t('pricing:prospects.filters.value'), type: 'number', group: sales },
      { key: 'source', label: t('common:labels.source'), type: 'text', group: company },
      { key: 'lastActivityAt', label: t('pricing:prospects.filters.lastActivity'), type: 'date', group: activity },
      { key: 'createdAt', label: t('pricing:prospects.filters.createdAt'), type: 'date', group: activity },
      {
        key: 'archived',
        label: t('pricing:prospects.archivedFlag'),
        type: 'enum',
        group: activity,
        noNegate: true,
        options: [
          { value: 'yes', label: t('pricing:prospects.filters.archivedOnly') },
          { value: 'any', label: t('pricing:prospects.filters.archivedAny') },
        ],
      },
    ]
    const health = t('clients:health.fields.group')
    const contactStatuses = (['ok', 'invalid', 'bounced', 'unsubscribed'] as const).map((value) => ({ value, label: t(`clients:health.fields.statuses.${value}`) }))
    const people = t('clients:prospects.people.group')
    const yes = [{ value: 'yes', label: t('clients:prospects.people.yes') }]
    return [
      ...fields,
      { key: 'phone', label: t('clients:health.fields.phone'), type: 'text', group: health, ops: ['is_empty', 'not_empty'] },
      { key: 'email', label: t('clients:health.fields.email'), type: 'text', group: health, ops: ['is_empty', 'not_empty'] },
      { key: 'contactStatus', label: t('clients:health.fields.contactStatus'), type: 'enum', group: health, options: contactStatuses },
      {
        key: 'isActive',
        label: t('clients:health.fields.isActive'),
        type: 'enum',
        group: health,
        options: [
          { value: 'true', label: t('clients:health.fields.active') },
          { value: 'false', label: t('clients:health.fields.struckOff') },
        ],
      },
      { key: 'people.role', label: t('clients:prospects.people.role'), type: 'text', group: people, defaultPinned: kind === 'people' },
      { key: 'people.decisionMaker', label: t('clients:prospects.people.decisionMaker'), type: 'enum', group: people, noNegate: true, options: yes },
      { key: 'people.doNotContact', label: t('clients:prospects.people.doNotContact'), type: 'enum', group: people, noNegate: true, options: yes },
    ]
  }, [kind, statuses, assignees, lists])
}
