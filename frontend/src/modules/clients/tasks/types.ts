export const TASK_TABS = ['all', 'call', 'email', 'linkedin', 'today', 'overdue'] as const
export type TaskTabKey = (typeof TASK_TABS)[number]
export type TaskScope = 'mine' | 'team'
export type TaskPriority = 'low' | 'medium' | 'high'

export const CALL_OUTCOMES = ['answered', 'no_answer', 'voicemail', 'wrong_number', 'callback'] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

/** One row of `GET /api/prospects/tasks` (crm-service.ts `listTasks`). */
export interface TaskRow {
  id: string
  prospectId: string
  personId: string | null
  assigneeUserId: string
  kind: string
  title: string
  description: string | null
  dueAt: string
  priority: TaskPriority
  prospectName: string
  personName: string | null
  assigneeName: string | null
}

export interface TaskPage {
  rows: TaskRow[]
  total: number
  page: number
  pageSize: number
}

export type TaskCounts = Record<TaskTabKey, number>

export interface Snippet {
  id: string
  ownerUserId: string
  name: string
  body: string
  shared: boolean
}
