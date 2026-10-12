import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Check, Download, Pencil, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { downloadCsv } from '@/shared/lib/csv'
import type { Prospect, ProspectImportResult, ProspectPriority, ProspectStatusEntry } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { formatNumber } from '@/shared/lib/format'
import { AddToSequenceDialog } from './AddToSequenceDialog'
import { PromoteProspectDialog } from './PromoteProspectDialog'
import { ProspectStatusesCard } from './ProspectStatusesCard'
import { ScoringConfigCard } from './ScoringConfigCard'
import { StatusDot } from './status-colors'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'

const PRIORITY_VARIANT: Record<ProspectPriority, 'destructive' | 'warning' | 'secondary' | 'outline'> = {
  HOT: 'destructive',
  WARM: 'warning',
  NURTURE: 'secondary',
  SKIP: 'outline',
}

// Chip de filtru: selecția e neutră (tentă + text mai tare), nu culoarea stării filtrate.
const FILTER_CHIP = 'inline-flex h-control-sm items-center gap-1.5 rounded-md border px-2 text-xs font-medium'
const FILTER_CHIP_ON = 'border-foreground/30 bg-accent text-foreground'
const FILTER_CHIP_OFF = 'border-border text-muted-foreground hover:text-foreground'

function toggleValue<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

// Telefon/email pot ține mai multe valori pe același prospect, separate prin "/" (export CSV) —
// fiecare devine un link clicabil separat, nu unul singur pe tot string-ul.
function splitMultiValue(raw: string): string[] {
  return raw
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Website-urile din CSV vin des fără protocol (ex: "acme.ro") — un <a href> fără schemă e
// interpretat ca path relativ pe domeniul curent (dash.vanadium.systems/acme.ro), nu ca URL extern.
function withProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

export function ProspectareTab() {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Multi-select (bifabile) în loc de un singur status/prioritate selectat — cerut explicit
  // (Stefan, 2026-07-29): pe 164 firme, un filtru "un singur status" nu ajută să vezi mai
  // multe deodată sau să ascunzi doar câteva. Array gol = fără filtru, arată tot.
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [priorityFilter, setPriorityFilter] = useState<ProspectPriority[]>([])
  const [search, setSearch] = useState('')
  // Arhivați — ascunși din lista implicită, dar căutabili la nevoie (toggle explicit).
  const [showArchived, setShowArchived] = useState(false)
  const [promoteTarget, setPromoteTarget] = useState<Prospect | null>(null)
  const [importSource, setImportSource] = useState('')
  // Editare la cerere, un singur rând deodată — nu ținem ~500 input-uri montate simultan
  // (164 rânduri × 3 câmpuri): bug găsit 2026-07-29, pagina îngheța 3-5s la fiecare click
  // pe telefon/email/contact, semn clasic de extensie de autofill/password manager care
  // scanează pagina la fiecare focus pe un input nou apărut.
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  // Selecție bulk pt. „Adaugă în secvență" (2026-08-12) — Set, nu array, lookup O(1) la fiecare
  // rând randat (~164 rânduri, un array ar face .includes() liniar de 164 ori pe randare).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [addToSequenceTargets, setAddToSequenceTargets] = useState<Prospect[]>([])
  // Paginare (2026-08-17) — randarea tuturor rândurilor deodată (164+ Textarea-uri pt. notițe)
  // îngheța pagina la încărcare. Selecția rămâne pe `selectedIds` (Set, independent de pagină) —
  // „selectează tot" bifează tot setul filtrat, nu doar pagina curentă.
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(0)
  // Export CSV — checkbox propriu (2026-09-08), independent de `showArchived` de mai sus:
  // ăla e exclusiv (ori activi, ori doar arhivați), pt. export vrem aditiv (activi + arhivați).
  const [exportIncludeArchived, setExportIncludeArchived] = useState(false)

  const query = new URLSearchParams()
  if (search) query.set('search', search)
  if (showArchived) query.set('archived', 'only')

  const prospects = useQuery({
    queryKey: ['prospects', { search, showArchived }],
    queryFn: () => api.get<Prospect[]>(`/api/prospects?${query.toString()}`),
  })
  const statuses = useQuery({
    queryKey: ['prospects', 'statuses'],
    queryFn: () => api.get<ProspectStatusEntry[]>('/api/prospects/statuses'),
  })
  const statusCatalog = statuses.data ?? []
  const statusToken = (status: string) => statusCatalog.find((s) => s.key === status)?.colorToken

  // Filtrare pe status/prioritate client-side (nu server) — multi-select, volum mic (~164 rânduri),
  // instant la fiecare bifă fără round-trip la API.
  const visibleProspects = (prospects.data ?? []).filter(
    (p) => (statusFilter.length === 0 || statusFilter.includes(p.status)) && (priorityFilter.length === 0 || priorityFilter.includes(p.priority)),
  )

  useEffect(() => setPage(0), [search, statusFilter, priorityFilter])

  const pageCount = Math.max(1, Math.ceil(visibleProspects.length / pageSize))
  const clampedPage = Math.min(page, pageCount - 1)
  const pagedProspects = visibleProspects.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize)

  const updateProspect = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch<Prospect>(`/api/prospects/${id}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['prospects'] }),
    onError: (err) => toast.error(err.message),
  })

  const removeProspect = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/prospects/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      toast.success(t('pricing:prospects.deleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  const archiveProspect = useMutation({
    mutationFn: (id: string) => api.post<Prospect>(`/api/prospects/${id}/archive`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      toast.success(t('pricing:prospects.archived'))
    },
    onError: (err) => toast.error(err.message),
  })

  const unarchiveProspect = useMutation({
    mutationFn: (id: string) => api.post<Prospect>(`/api/prospects/${id}/unarchive`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      toast.success(t('pricing:prospects.unarchived'))
    },
    onError: (err) => toast.error(err.message),
  })

  const archiveBulk = useMutation({
    mutationFn: (ids: string[]) => api.post<{ archived: number }>('/api/prospects/archive-bulk', { ids }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      setSelectedIds(new Set())
      toast.success(t('pricing:prospects.archivedMany', { count: data.archived }))
    },
    onError: (err) => toast.error(err.message),
  })

  const unarchiveBulk = useMutation({
    mutationFn: (ids: string[]) => api.post<{ unarchived: number }>('/api/prospects/unarchive-bulk', { ids }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      setSelectedIds(new Set())
      toast.success(t('pricing:prospects.unarchivedMany', { count: data.unarchived }))
    },
    onError: (err) => toast.error(err.message),
  })

  const importCsv = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      // source TREBUIE adăugat înainte de file (@fastify/multipart citește secvențial).
      if (importSource) fd.append('source', importSource)
      fd.append('file', file)
      return api.upload<ProspectImportResult>('/api/prospects/import', fd)
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      toast.success(t('pricing:prospects.importDone', { imported: data.imported, updated: data.updated }))
    },
    onError: (err) => toast.error(err.message),
  })

  const exportCsv = useMutation({
    mutationFn: async () => {
      // Fetch dedicat, nu `prospects.data` din tabel — tabelul respectă `showArchived`
      // (exclusiv: ori activi, ori doar arhivați), export-ul are propriul bifabil aditiv.
      const exportQuery = new URLSearchParams()
      if (exportIncludeArchived) exportQuery.set('archived', 'all')
      const all = await api.get<Prospect[]>(`/api/prospects?${exportQuery.toString()}`)
      return all.filter(
        (p) => (statusFilter.length === 0 || statusFilter.includes(p.status)) && (priorityFilter.length === 0 || priorityFilter.includes(p.priority)),
      )
    },
    onSuccess: (rows) => {
      if (!rows.length) {
        toast.error(t('pricing:prospects.noneMatchFilters'))
        return
      }
      downloadCsv(`prospecti-${new Date().toISOString().slice(0, 10)}.csv`, [
        [t('common:labels.priority'), t('pricing:prospects.score'), t('common:labels.company'), t('common:labels.cif'), t('common:labels.phone'), t('common:labels.email'), t('pricing:prospects.contact'), t('common:labels.status'), t('common:nav.notes'), t('pricing:prospects.employees'), t('pricing:prospects.turnoverShort'), t('common:labels.source'), t('pricing:prospects.archivedFlag')],
        ...rows.map((p) => [
          p.priority,
          p.score ?? '',
          p.name,
          p.cif ?? '',
          p.phone ?? '',
          p.email ?? '',
          p.contactName ?? '',
          statusCatalog.find((s) => s.key === p.status)?.label ?? p.status,
          p.notes ?? '',
          p.employeeCount != null ? String(p.employeeCount) : '',
          p.revenue ?? '',
          p.source ?? '',
          p.archivedAt ? 'da' : 'nu',
        ]),
      ])
      toast.success(t('pricing:prospects.exported', { count: rows.length }))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <ScoringConfigCard />
      <ProspectStatusesCard />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">{t('pricing:prospects.searchLabel')}</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('pricing:prospects.searchPlaceholder')} />
        </div>
        <div className="w-40 space-y-1">
          <label className="text-xs text-muted-foreground">{t('pricing:prospects.importSource')}</label>
          <Input value={importSource} onChange={(e) => setImportSource(e.target.value)} placeholder={t('pricing:prospects.importSourcePlaceholder')} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('pricing:prospects.showArchived')}
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) importCsv.mutate(file)
            e.target.value = ''
          }}
        />
        <Button type="button" variant="outline" disabled={importCsv.isPending} onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4" /> {importCsv.isPending ? t('pricing:prospects.importing') : t('pricing:prospects.importCsv')}
        </Button>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t('pricing:prospects.priorityFilter')}</label>
          <div className="flex flex-wrap gap-1">
            {(['HOT', 'WARM', 'NURTURE', 'SKIP'] as const).map((p) => {
              const active = priorityFilter.includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPriorityFilter((prev) => toggleValue(prev, p))}
                  className={cn(FILTER_CHIP, active ? FILTER_CHIP_ON : FILTER_CHIP_OFF)}
                >
                  {p}
                </button>
              )
            })}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t('pricing:prospects.statusFilter')}</label>
          <div className="flex flex-wrap gap-1">
            {statusCatalog.map((s) => {
              const active = statusFilter.includes(s.key)
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter((prev) => toggleValue(prev, s.key))}
                  className={cn(FILTER_CHIP, active ? FILTER_CHIP_ON : FILTER_CHIP_OFF)}
                >
                  <StatusDot token={s.colorToken} />
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={exportIncludeArchived} onChange={(e) => setExportIncludeArchived(e.target.checked)} />
            {t('pricing:prospects.fromArchive')}
          </label>
          <Button type="button" variant="outline" disabled={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
            <Download className="h-4 w-4" /> {exportCsv.isPending ? t('pricing:prospects.exporting') : t('common:actions.exportCsv')}
          </Button>
        </div>
      </div>

      {selectedIds.size > 0 ? (
        <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2">
          <span className="text-sm">{t('pricing:prospects.selected', { count: selectedIds.size })}</span>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => setAddToSequenceTargets(visibleProspects.filter((p) => selectedIds.has(p.id)))}>
              {t('pricing:prospects.addToSequence')}
            </Button>
            {showArchived ? (
              <Button type="button" variant="outline" onClick={() => unarchiveBulk.mutate([...selectedIds])}>
                <ArchiveRestore className="h-4 w-4" /> {t('pricing:prospects.unarchiveSelection')}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => archiveBulk.mutate([...selectedIds])}>
                <Archive className="h-4 w-4" /> {t('pricing:prospects.archiveSelection')}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              {t('pricing:prospects.clearSelection')}
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {prospects.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : !prospects.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('pricing:prospects.empty')}</p>
          ) : !visibleProspects.length ? (
            <p className="text-sm text-muted-foreground">{t('pricing:prospects.noneMatchFiltersHint')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={visibleProspects.length > 0 && visibleProspects.every((p) => selectedIds.has(p.id))}
                        onChange={(e) =>
                          setSelectedIds(e.target.checked ? new Set(visibleProspects.map((p) => p.id)) : new Set())
                        }
                      />
                    </TableHead>
                    <TableHead>{t('common:labels.priority')}</TableHead>
                    <TableHead>{t('pricing:prospects.score')}</TableHead>
                    <TableHead>{t('common:labels.company')}</TableHead>
                    <TableHead>{t('pricing:prospects.contact')}</TableHead>
                    <TableHead>{t('common:labels.status')}</TableHead>
                    <TableHead>{t('common:nav.notes')}</TableHead>
                    <TableHead>{t('pricing:prospects.employees')}</TableHead>
                    <TableHead>{t('pricing:prospects.turnoverShort')}</TableHead>
                    <TableHead>{t('common:labels.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedProspects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(p.id)}
                          onChange={(e) =>
                            setSelectedIds((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(p.id)
                              else next.delete(p.id)
                              return next
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={PRIORITY_VARIANT[p.priority]}>{p.priority}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.score ?? '—'}</TableCell>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.cif ?? t('pricing:prospects.noCif')}</div>
                      </TableCell>
                      <TableCell className="min-w-[11rem] space-y-1 text-xs">
                        {editingContactId === p.id ? (
                          <>
                            <Input
                              className="h-control-sm"
                              placeholder={t('common:labels.phone')}
                              autoComplete="off"
                              defaultValue={p.phone ?? ''}
                              onBlur={(e) => {
                                if (e.target.value !== (p.phone ?? '')) updateProspect.mutate({ id: p.id, body: { phone: e.target.value || null } })
                              }}
                            />
                            <Input
                              className="h-control-sm"
                              placeholder={t('common:labels.email')}
                              autoComplete="off"
                              defaultValue={p.email ?? ''}
                              onBlur={(e) => {
                                if (e.target.value !== (p.email ?? '')) updateProspect.mutate({ id: p.id, body: { email: e.target.value || null } })
                              }}
                            />
                            <Input
                              className="h-control-sm"
                              placeholder={t('pricing:prospects.contactPerson')}
                              autoComplete="off"
                              defaultValue={p.contactName ?? ''}
                              onBlur={(e) => {
                                if (e.target.value !== (p.contactName ?? '')) updateProspect.mutate({ id: p.id, body: { contactName: e.target.value || null } })
                              }}
                            />
                            <Button size="sm" type="button" variant="outline" className="gap-1" onClick={() => setEditingContactId(null)}>
                              <Check className="h-3 w-3" /> {t('pricing:prospects.done')}
                            </Button>
                          </>
                        ) : (
                          <div className="flex items-start justify-between gap-1">
                            <div className="space-y-0 leading-tight">
                              {p.phone && (
                                <div className="flex flex-wrap gap-1">
                                  {splitMultiValue(p.phone).map((num) => (
                                    <a key={num} href={`tel:${num}`} className="text-primary underline">
                                      {num}
                                    </a>
                                  ))}
                                </div>
                              )}
                              {p.email && (
                                <div className="flex flex-wrap gap-1">
                                  {splitMultiValue(p.email).map((addr) => (
                                    <a
                                      key={addr}
                                      href={`/email?to=${encodeURIComponent(addr)}`}
                                      className="text-primary underline"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        navigate(`/email?to=${encodeURIComponent(addr)}`)
                                      }}
                                    >
                                      {addr}
                                    </a>
                                  ))}
                                </div>
                              )}
                              {p.contactName && <div className="text-muted-foreground">{p.contactName}</div>}
                              {p.website && (
                                <a href={withProtocol(p.website)} target="_blank" rel="noreferrer" className="text-primary underline">
                                  {p.website}
                                </a>
                              )}
                              {!p.phone && !p.email && !p.contactName && !p.website && <span className="text-muted-foreground">—</span>}
                            </div>
                            <Button
                              size="sm"
                              type="button"
                              variant="outline"
                              className="shrink-0"
                              title={t('pricing:prospects.editContactHint')}
                              onClick={() => setEditingContactId(p.id)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {statusToken(p.status) ? <StatusDot token={statusToken(p.status)!} /> : <span className="w-2" />}
                          <Select
                            size="sm"
                            aria-label={`Status ${p.name}`}
                            className="w-auto w-40"
                            value={p.status}
                            onValueChange={(status) => updateProspect.mutate({ id: p.id, body: { status } })}
                          >
                            {statusCatalog.some((s) => s.key === p.status) ? null : <option value={p.status}>{p.status}</option>}
                            {statusCatalog.map((s) => (
                              <option key={s.id} value={s.key}>
                                {s.label}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[12rem]">
                        <Textarea
                          className="min-h-9"
                          defaultValue={p.notes ?? ''}
                          onBlur={(e) => {
                            if (e.target.value !== (p.notes ?? '')) updateProspect.mutate({ id: p.id, body: { notes: e.target.value || null } })
                          }}
                        />
                      </TableCell>
                      <TableCell>{p.employeeCount ?? '—'}</TableCell>
                      <TableCell>{p.revenue ? formatNumber(Number(p.revenue), BASE_CURRENCY) : '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button type="button" variant="outline" onClick={() => navigate(`/pricing?tab=calculator&prospectId=${p.id}`)}>
                            {t('pricing:prospects.calculatePrice')}
                          </Button>
                          {!p.billingClientId && (
                            <Button type="button" variant="outline" onClick={() => setPromoteTarget(p)}>
                              {t('pricing:prospects.promote')}
                            </Button>
                          )}
                          {showArchived ? (
                            <Button type="button" variant="outline" onClick={() => unarchiveProspect.mutate(p.id)}>
                              <ArchiveRestore className="h-4 w-4" /> {t('pricing:prospects.unarchive')}
                            </Button>
                          ) : (
                            <Button type="button" variant="ghost" title={t('common:actions.archive')} onClick={() => archiveProspect.mutate(p.id)}>
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              void confirm({ title: t('pricing:prospects.deleteTitle', { name: p.name }), consequence: t('pricing:prospects.deleteBody'), confirmLabel: t('pricing:prospects.deleteConfirm'), destructive: true }).then((ok) => ok && removeProspect.mutate(p.id))
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {visibleProspects.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>{t('pricing:prospects.rowsPerPage')}</span>
                <Select
                  className="w-auto"
                  size="sm"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(0)
                  }}
                >
                  {[25, 50, 100].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span>
                  {t('pricing:pagination.range', { from: clampedPage * pageSize + 1, to: Math.min((clampedPage + 1) * pageSize, visibleProspects.length), total: visibleProspects.length })}
                </span>
                <Button type="button" variant="outline" disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>
                  {t('common:actions.back')}
                </Button>
                <Button type="button" variant="outline" disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)}>
                  {t('pricing:prospects.nextPage')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PromoteProspectDialog prospect={promoteTarget} onOpenChange={(open) => !open && setPromoteTarget(null)} />
      <AddToSequenceDialog
        prospects={addToSequenceTargets}
        onOpenChange={(open) => {
          if (!open) {
            setAddToSequenceTargets([])
            setSelectedIds(new Set())
          }
        }}
      />
    </div>
  )
}
