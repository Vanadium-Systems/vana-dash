import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useFilterState, useSearchState } from '@/shared/components/FilterBar'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { api } from '@/shared/lib/api'
import { clauseLabel, clauseValueLabel, resultsLabel, type FilterClause, type FilterField } from '@/shared/lib/filters'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useFilterFields } from '../prospects/use-filter-fields'
import { filterParams, useAssignees, useStatuses } from '../prospects/use-prospect-data'
import { skippedSummary } from './skipped'
import type { AddMembersResult, SkipRules } from './types'
import { listFilterParam, useListActions, useListFolders, useLists } from './use-lists-data'

const MAX_ROWS = 5000
const MAX_NAME = 100
const NO_FOLDER = ''

type Destination = 'new' | 'existing'

const fieldFor = (fields: FilterField[], clause: FilterClause): FilterField => fields.find((field) => field.key === clause.field) ?? { key: clause.field, label: clause.field, type: 'text' }

/** "Contactat, Brașov, CAEN 3811": the search text first, then the value of each filter. */
export function proposeName(q: string, f: FilterClause[], fields: FilterField[]): string {
  const parts = [q.trim(), ...f.map((clause) => clauseValueLabel(fieldFor(fields, clause), clause))].filter(Boolean)
  return parts.join(', ').slice(0, MAX_NAME)
}

/** A list built from the current search (`?f=&q=`): new or added to one that exists, with the rules for who is left out. */
export function FromSearchPage() {
  const navigate = useNavigate()
  const [f] = useFilterState()
  const [q] = useSearchState()
  const statuses = useStatuses().data ?? []
  const assignees = useAssignees().data ?? []
  const lists = useLists()
  const folders = useListFolders()
  const actions = useListActions()
  const fields = useFilterFields('companies', statuses, assignees, lists.data ?? [])

  const count = useQuery({
    queryKey: ['prospects', 'count', 'companies', filterParams(f, q)],
    queryFn: () => api.get<{ total: number | null }>(`/api/prospects/count?${filterParams(f, q, { kind: 'companies' })}`).then((r) => r.total),
  })

  const [destination, setDestination] = useState<Destination>('new')
  const [name, setName] = useState<string | null>(null)
  const [folderId, setFolderId] = useState(NO_FOLDER)
  const [shared, setShared] = useState(true)
  const [existingId, setExistingId] = useState('')
  const [scope, setScope] = useState<'all' | 'first'>('all')
  const [firstN, setFirstN] = useState('100')
  const [rules, setRules] = useState<SkipRules>({})
  const [errors, setErrors] = useState<{ name?: string; list?: string; rows?: string }>({})
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<{ listId: string; listName: string; result: AddMembersResult } | null>(null)

  const shownName = name ?? proposeName(q, f, fields)
  const existing = lists.data?.find((list) => list.id === existingId)
  // The rule looks at the folder the target list is in; a list outside any folder has nothing to compare with.
  const targetFolderId = destination === 'new' ? folderId : (existing?.folderId ?? '')
  const total = count.data
  const back = () => navigate(`/clients?${filterParams(f, q)}`)

  const submit = async () => {
    const next: typeof errors = {}
    if (destination === 'new' && !shownName.trim()) next.name = t('clients:lists.nameRequired')
    if (destination === 'existing' && !existingId) next.list = t('clients:lists.add.required')
    const limit = scope === 'first' ? Number(firstN) : undefined
    if (scope === 'first' && !(Number.isInteger(limit) && limit! >= 1 && limit! <= MAX_ROWS)) next.rows = t('clients:lists.fromSearchPage.rowsInvalid', { max: formatNumber(MAX_ROWS) })
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setPending(true)
    try {
      let listId = existingId
      let listName = existing?.name ?? ''
      if (destination === 'new') {
        const created = await actions.createList.mutateAsync({ name: shownName.trim(), folderId: folderId || null, shared })
        listId = created.id
        listName = created.name
      }
      const effective: SkipRules = { ...rules, skipInFolderLists: targetFolderId ? rules.skipInFolderLists : false }
      const result = await actions.addFromSearch.mutateAsync({ listId, f, q, rules: effective, limit })
      setDone({ listId, listName, result })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  if (done) {
    const skipped = skippedSummary(done.result.skipped)
    return (
      <div data-density="comfortable" className="mx-auto max-w-2xl space-y-6">
        <PageHeader title={t('clients:lists.fromSearchPage.doneTitle', { name: done.listName })} />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm">{t('clients:prospects.bulk.listAdded', { count: done.result.added })}</p>
            {skipped ? <p className="text-sm text-muted-foreground">{skipped}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={back}>
                {t('clients:lists.fromSearchPage.backToSearch')}
              </Button>
              <Button type="button" onClick={() => navigate(`/clients?f=${encodeURIComponent(listFilterParam(done.listId))}`)}>
                {t('clients:lists.fromSearchPage.openList')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const setRule = (key: keyof SkipRules) => (e: React.ChangeEvent<HTMLInputElement>) => setRules((old) => ({ ...old, [key]: e.target.checked }))

  return (
    <div data-density="comfortable" className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={t('clients:lists.fromSearchPage.title')}
        description={t('clients:lists.fromSearchPage.description')}
        actions={
          <Button type="button" variant="outline" onClick={back}>
            <ArrowLeft aria-hidden="true" /> {t('common:actions.back')}
          </Button>
        }
      />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Card>
          <CardContent className="space-y-2 pt-6">
            <h2 className="text-sm font-semibold">{t('clients:lists.fromSearchPage.search')}</h2>
            {f.length === 0 && !q ? (
              <p className="text-sm text-muted-foreground">{t('clients:lists.fromSearchPage.noFilters')}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 text-sm">
                {q ? <li className="rounded-md bg-muted px-2 py-0.5">{t('clients:lists.fromSearchPage.text', { q })}</li> : null}
                {f.map((clause, index) => (
                  <li key={index} className="rounded-md bg-muted px-2 py-0.5">
                    {clauseLabel(fieldFor(fields, clause), clause)}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {total === undefined ? '' : resultsLabel(total)}
            </p>
            {total !== undefined && (total === null || total > MAX_ROWS) ? <p className="text-xs text-muted-foreground">{t('clients:lists.fromSearchPage.cap', { max: formatNumber(MAX_ROWS) })}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <Tabs value={destination} onValueChange={(next) => setDestination(next as Destination)}>
              <TabsList variant="segmented">
                <TabsTrigger value="new">{t('clients:lists.fromSearchPage.newList')}</TabsTrigger>
                <TabsTrigger value="existing">{t('clients:lists.fromSearchPage.existingList')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {destination === 'new' ? (
              <>
                <Field label={t('clients:lists.name')} error={errors.name}>
                  <Input value={shownName} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label={t('clients:lists.folder.label')} optional>
                  <Select value={folderId} onValueChange={setFolderId} options={[{ value: NO_FOLDER, label: t('clients:lists.noFolder') }, ...(folders.data ?? []).map((folder) => ({ value: folder.id, label: folder.name }))]} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t('clients:lists.share')}
                </label>
              </>
            ) : (
              <Field label={t('clients:lists.add.list')} error={errors.list}>
                <Select
                  value={existingId}
                  onValueChange={setExistingId}
                  options={[{ value: '', label: t('clients:lists.add.choose') }, ...(lists.data ?? []).map((list) => ({ value: list.id, label: `${list.name} (${formatNumber(list.memberCount)})` }))]}
                />
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <Field label={t('clients:lists.fromSearchPage.rows')} error={errors.rows}>
              <Select
                value={scope}
                onValueChange={(next) => setScope(next as 'all' | 'first')}
                options={[
                  { value: 'all', label: total === undefined || total === null ? t('clients:lists.fromSearchPage.allRows') : t('clients:lists.fromSearchPage.allRowsCount', { n: formatNumber(Math.min(total, MAX_ROWS)) }) },
                  { value: 'first', label: t('clients:lists.fromSearchPage.firstRows') },
                ]}
              />
            </Field>
            {scope === 'first' ? (
              <Field label={t('clients:lists.fromSearchPage.firstCount')}>
                <Input inputMode="numeric" value={firstN} onChange={(e) => setFirstN(e.target.value.replace(/\D/g, ''))} />
              </Field>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t('clients:lists.fromSearchPage.rulesTitle')}</legend>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={Boolean(rules.skipInFolderLists) && Boolean(targetFolderId)} disabled={!targetFolderId} onChange={setRule('skipInFolderLists')} /> {t('clients:lists.fromSearchPage.skipInFolder')}
              </label>
              {targetFolderId ? null : <p className="pl-6 text-xs text-muted-foreground">{t('clients:lists.fromSearchPage.skipInFolderNeedsFolder')}</p>}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={Boolean(rules.skipWithoutPhone)} onChange={setRule('skipWithoutPhone')} /> {t('clients:lists.fromSearchPage.skipNoPhone')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={Boolean(rules.skipDoNotContact)} onChange={setRule('skipDoNotContact')} /> {t('clients:lists.fromSearchPage.skipDnc')}
              </label>
            </fieldset>
          </CardContent>
        </Card>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={back}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={pending || total === 0}>
            {destination === 'new' ? t('clients:lists.fromSearchPage.create') : t('clients:lists.add.confirm')}
          </Button>
        </div>
      </form>
    </div>
  )
}
