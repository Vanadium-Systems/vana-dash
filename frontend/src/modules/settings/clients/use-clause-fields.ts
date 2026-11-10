import { useMemo } from 'react'
import { useFilterFields } from '@/modules/clients/prospects/use-filter-fields'
import { useAssignees, useProspectLists, useStatuses } from '@/modules/clients/prospects/use-prospect-data'
import type { FilterField } from '@/shared/lib/filters'

/** The prospect list's fields, for the filters kept with a criterion or a signal. */
export function useClauseFields(extra: FilterField[] = []): FilterField[] {
  const statuses = useStatuses().data
  const assignees = useAssignees().data
  const lists = useProspectLists(true).data
  const base = useFilterFields('companies', statuses ?? [], assignees ?? [], lists ?? [])
  return useMemo(() => [...base, ...extra], [base, extra])
}
