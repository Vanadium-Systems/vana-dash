import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Ellipsis, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import { Tooltip } from '@/shared/components/ui/tooltip'
import { api, ApiError } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'

// Ce poate face fiecare rol, pagină cu pagină (PLAN.md C2, fișa „Module"). O matrice, nu
// o listă de roluri: rolurile sunt puține (Admin, Manager și câteva custom), deci le vezi
// pe toate odată, iar întrebarea „ce poate face Sales?" se răspunde dintr-o privire.
//
// Reguli care se văd aici, nu în cod: salvarea e la fiecare switch (optimist, „Salvat" pe
// rând), oprirea e reversibilă deci nu are dialog, iar cu „Vede pagina" oprit restul paginii
// rămâne salvat dar inert, cu motivul scris pe rând.

interface CatalogFeature {
  key: string
  label: string
  ownerOnly: boolean
}

interface CatalogPage {
  page: string
  label: string
  group: string
  viewFeature: string | null
  features: CatalogFeature[]
}

interface MatrixRole {
  id: string
  name: string
  kind: 'admin' | 'manager' | 'custom'
  features: string[]
  memberCount: number
  editable: boolean
  lockedFeatures: string[]
}

const MATRIX_QUERY_KEY = ['access', 'matrix'] as const

export function ModulesPage() {
  const queryClient = useQueryClient()
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<MatrixRole | null>(null)
  const [deleting, setDeleting] = useState<MatrixRole | null>(null)
  const [notice, setNotice] = useState<{ cell: string; text: string; tone: 'ok' | 'error' } | null>(null)

  const catalog = useQuery({ queryKey: ['access', 'catalog'], queryFn: () => api.get<CatalogPage[]>('/api/access/catalog'), staleTime: 5 * 60 * 1000 })
  const matrix = useQuery({ queryKey: MATRIX_QUERY_KEY, queryFn: () => api.get<{ tenantFeatures: string[]; roles: MatrixRole[] }>('/api/access/matrix') })

  const announce = (cell: string, text: string) => {
    setNotice({ cell, text, tone: 'ok' })
    // „Salvat" stă ~2s, cât tranziția, apoi dispare fără să ocupe locul rândului.
    window.setTimeout(() => setNotice((current) => (current?.cell === cell && current.tone === 'ok' ? null : current)), 2000)
  }

  // Optimist: serverul întoarce lista nouă de funcționalități, cu care înlocuim rolul în cache.
  const setFeature = useMutation({
    mutationFn: ({ roleId, key, enabled }: { roleId: string; key: string; enabled: boolean }) =>
      api.put<{ features: string[] }>(`/api/access/roles/${roleId}/features/${key}`, { enabled }),
    onMutate: async ({ roleId, key, enabled }) => {
      await queryClient.cancelQueries({ queryKey: MATRIX_QUERY_KEY })
      const previous = queryClient.getQueryData<{ tenantFeatures: string[]; roles: MatrixRole[] }>(MATRIX_QUERY_KEY)
      queryClient.setQueryData<{ tenantFeatures: string[]; roles: MatrixRole[] }>(MATRIX_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              roles: current.roles.map((role) =>
                role.id === roleId
                  ? { ...role, features: enabled ? [...new Set([...role.features, key])].sort() : role.features.filter((f) => f !== key) }
                  : role,
              ),
            }
          : current,
      )
      return { previous }
    },
    onSuccess: (_data, { roleId, key }) => announce(`${roleId}:${key}`, 'Salvat'),
    onError: (error, { roleId, key }, context) => {
      if (context?.previous) queryClient.setQueryData(MATRIX_QUERY_KEY, context.previous)
      void queryClient.invalidateQueries({ queryKey: MATRIX_QUERY_KEY })
      setNotice({ cell: `${roleId}:${key}`, text: error instanceof ApiError ? error.message : 'Schimbarea nu s-a salvat.', tone: 'error' })
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: MATRIX_QUERY_KEY }),
  })

  const setPage = useMutation({
    mutationFn: ({ roleId, page, enabled }: { roleId: string; page: string; enabled: boolean }) =>
      api.put<{ features: string[] }>(`/api/access/roles/${roleId}/pages/${page}`, { enabled }),
    onSuccess: (_data, { roleId, page }) => announce(`${roleId}:${page}`, 'Salvat'),
    onError: (error, { roleId, page }) => {
      void queryClient.invalidateQueries({ queryKey: MATRIX_QUERY_KEY })
      setNotice({ cell: `${roleId}:${page}`, text: error instanceof ApiError ? error.message : 'Schimbarea nu s-a salvat.', tone: 'error' })
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: MATRIX_QUERY_KEY }),
  })

  const roles = matrix.data?.roles ?? []
  // Sub `lg` matricea nu încape: o singură coloană, rolul ales de sus.
  const visibleRoles = roleFilter ? roles.filter((role) => role.id === roleFilter) : roles
  const onlyAdmin = roles.length === 1 && roles[0]?.kind === 'admin'

  // Grupul se scrie o singură dată, pe prima lui pagină — antetul de grup, nu o coloană.
  const pages = (catalog.data ?? []).map((page, index, all) => ({
    page,
    showGroup: all.findIndex((other) => other.group === page.group) === index,
  }))

  const refetchAll = () => {
    void queryClient.invalidateQueries({ queryKey: MATRIX_QUERY_KEY })
  }

  return (
    <div className="space-y-6" data-density="comfortable">
      <PageHeader
        title="Module"
        description="Ce poate face fiecare rol, pe fiecare pagină."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Rol nou
          </Button>
        }
      />

      {catalog.isPending || matrix.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : catalog.isError || matrix.isError ? (
        <div className="space-y-2 py-8 text-sm">
          <p>Nu am putut încărca modulele.</p>
          <Button
            variant="outline"
            onClick={() => {
              void catalog.refetch()
              void matrix.refetch()
            }}
          >
            Încearcă din nou
          </Button>
        </div>
      ) : onlyAdmin ? (
        <div className="max-w-md py-6">
          <p className="text-sm font-medium">Niciun rol în afară de Admin</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Admin are tot ce are firma, deci nu se editează. Creează primul rol ca să poți da funcționalități cuiva.
          </p>
          <Button className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            Creează primul rol
          </Button>
        </div>
      ) : (
        <>
          {visibleRoles.length > 1 ? (
            <div className="sm:hidden">
              <Field label="Rol">
                <Select
                  value={roleFilter ?? ''}
                  onValueChange={(value) => setRoleFilter(value || null)}
                  options={[{ value: '', label: 'Toate rolurile' }, ...roles.map((role) => ({ value: role.id, label: role.name }))]}
                />
              </Field>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">Funcționalitățile fiecărui rol, pe pagini</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-2/5 pb-2 text-left text-xs font-normal text-muted-foreground">
                    Pagină
                  </th>
                  {visibleRoles.map((role) => (
                    <th key={role.id} scope="col" className="pb-2 text-left text-xs font-normal text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span>{role.name}</span>
                        {role.kind === 'admin' ? <span className="text-muted-foreground/70">· acces complet</span> : null}
                        {role.editable ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent">
                              <Ellipsis className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Ce se poate face cu rolul {role.name}</span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => setRenaming(role)}>Redenumește</DropdownMenuItem>
                              <DropdownMenuItem destructive onClick={() => setDeleting(role)}>
                                Șterge rolul
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                      {role.memberCount > 0 ? (
                        <span className="block text-xs text-muted-foreground/70">{role.memberCount} oameni</span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pages.map(({ page, showGroup }) => (
                  <PageRows
                    key={page.page}
                    page={page}
                    roles={visibleRoles}
                    showGroup={showGroup}
                    group={page.group}
                    onPage={(roleId, enabled) => setPage.mutate({ roleId, page: page.page, enabled })}
                    onFeature={(roleId, key, enabled) => setFeature.mutate({ roleId, key, enabled })}
                    notice={notice}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <CreateRoleDialog open={creating} onOpenChange={setCreating} roles={roles} onCreated={refetchAll} />
      <RenameRoleDialog role={renaming} onClose={() => setRenaming(null)} onRenamed={refetchAll} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Șterge rolul ${deleting?.name ?? ''}`}
        consequence={
          deleting && deleting.memberCount > 0
            ? `${deleting.memberCount} ${deleting.memberCount === 1 ? 'om are' : 'oameni au'} rolul ăsta. Mută-i pe alt rol, apoi șterge-l.`
            : 'Rolul dispare; oamenii rămân în echipă, dar nu mai au rol.'
        }
        confirmLabel="Șterge rolul"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          try {
            await api.delete(`/api/access/roles/${deleting.id}`)
            toast.success(`Rolul ${deleting.name} a fost șters.`)
            setDeleting(null)
            refetchAll()
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Rolul nu a fost șters.')
          }
        }}
      />
    </div>
  )
}

function PageRows({
  page,
  roles,
  showGroup,
  group,
  onPage,
  onFeature,
  notice,
}: {
  page: CatalogPage
  roles: MatrixRole[]
  showGroup: boolean
  group: string
  onPage: (roleId: string, enabled: boolean) => void
  onFeature: (roleId: string, key: string, enabled: boolean) => void
  notice: { cell: string; text: string; tone: 'ok' | 'error' } | null
}) {
  return (
    <>
      {showGroup ? (
        <tr>
          <th scope="rowgroup" colSpan={roles.length + 1} className="pb-1 pt-6 text-left text-xs font-medium text-muted-foreground">
            {group}
          </th>
        </tr>
      ) : null}
      {page.features.map((feature, index) => {
        const isView = feature.key === page.viewFeature
        return (
          <tr key={feature.key} className="border-t">
            <th scope="row" className={cn('py-1 pr-3 text-left text-sm font-normal', index === 0 && 'pt-2')}>
              {isView ? <span>{page.label}</span> : <span className="pl-6 text-muted-foreground">{feature.label}</span>}
            </th>
            {roles.map((role) => {
              const on = role.features.includes(feature.key)
              // Funcționalitățile rămase salvate, dar inactive: fără poarta paginii nu au
              // efect, deci arată gri, cu motivul scris (nu doar o stingească discretă).
              const pageOff = Boolean(page.viewFeature) && !role.features.includes(page.viewFeature as string)
              const locked = role.lockedFeatures.includes(feature.key)
              const disabled = !role.editable || (!isView && pageOff) || (locked && !on)
              const cell = `${role.id}:${feature.key}`
              const reason = !role.editable
                ? 'Rolul Admin are tot ce are firma'
                : !isView && pageOff
                  ? `Pornește întâi «${page.label}»`
                  : locked && !on
                    ? `Nu ai ${feature.label.toLowerCase()}, deci nu îl poți da altcuiva`
                    : undefined
              const control = isView ? (
                <Checkbox
                  checked={on}
                  indeterminate={!on && page.features.some((f) => role.features.includes(f.key))}
                  disabled={disabled}
                  aria-label={`${page.label} pentru ${role.name}`}
                  onChange={(event) => onPage(role.id, event.target.checked)}
                />
              ) : (
                <Switch
                  checked={on}
                  disabled={disabled}
                  label={`${feature.label} pentru ${role.name}`}
                  onCheckedChange={(checked) => onFeature(role.id, feature.key, checked)}
                />
              )
              return (
                <td key={role.id} className={cn('py-1 pr-3 align-top', index === 0 && 'pt-2')}>
                  <div className="flex min-h-8 items-center gap-2">
                    {/* Coloana Admin spune deja „acces complet" în header, deci nu repetăm
                        motivul pe fiecare rând — doar pe cel care chiar trebuie explicat. */}
                    {reason && role.editable ? <Tooltip content={reason}>{control}</Tooltip> : control}
                    {isView ? (
                      <span className="text-xs text-muted-foreground tnum">
                        {page.features.filter((f) => role.features.includes(f.key)).length} din {page.features.length}
                      </span>
                    ) : null}
                    {notice?.cell === cell ? (
                      <span className={cn('text-xs', notice.tone === 'ok' ? 'text-muted-foreground' : 'text-destructive-text')}>{notice.text}</span>
                    ) : null}
                  </div>
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}

function CreateRoleDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: MatrixRole[]
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => api.post('/api/access/roles', copyFrom ? { name, copyFromRoleId: copyFrom } : { name }),
    onSuccess: () => {
      toast.success(`Rolul ${name} a fost creat.`)
      setName('')
      setCopyFrom('')
      onOpenChange(false)
      onCreated()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Rolul nu a fost creat.'),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setError(null)
      }}
    >
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">Rol nou</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            create.mutate()
          }}
        >
          <Field label="Nume" error={error}>
            <Input value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </Field>
          <Field label="Pornește de la" optional>
            <Select
              value={copyFrom}
              onValueChange={setCopyFrom}
              options={[
                { value: '', label: 'Gol' },
                ...roles.filter((role) => role.kind !== 'admin').map((role) => ({ value: role.id, label: role.name })),
              ]}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Renunță
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim().length < 2}>
              <Check className="h-4 w-4" />
              Creează rolul
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RenameRoleDialog({ role, onClose, onRenamed }: { role: MatrixRole | null; onClose: () => void; onRenamed: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rename = useMutation({
    mutationFn: () => api.patch(`/api/access/roles/${role?.id}`, { name }),
    onSuccess: () => {
      toast.success('Rolul a fost redenumit.')
      onClose()
      onRenamed()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Numele nu a fost salvat.'),
  })

  return (
    <Dialog
      open={Boolean(role)}
      onOpenChange={(open) => {
        if (open && role) {
          setName(role.name)
          setError(null)
        }
        if (!open) onClose()
      }}
    >
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">Redenumește rolul</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            rename.mutate()
          }}
        >
          <Field label="Nume" error={error}>
            <Input value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Renunță
            </Button>
            <Button type="submit" disabled={rename.isPending || name.trim().length < 2}>
              Salvează
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
