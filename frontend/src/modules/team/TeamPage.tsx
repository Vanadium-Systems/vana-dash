import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ellipsis, Mail, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { Tooltip } from '@/shared/components/ui/tooltip'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, TEAM_QUERY_KEY, useTeamMembers, type TeamMember } from '@/shared/hooks/use-team'
import { api, ApiError } from '@/shared/lib/api'
import type { EmailIdentity, EmailSettings } from '@/shared/lib/types'
import { cn, normalizeForSearch } from '@/shared/lib/utils'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

// Cine e în echipă, ce rol are fiecare și cine n-a acceptat încă invitația (fișa „Echipă").
// Lista e `self` — orice om activ o vede, ca să îi poată scrie cuiva din Mesaje; partea de
// administrare (invită, schimbă rolul, cutiile de email) apare doar cu `echipa.administrare`.
// Cutia de email e o listă de check-uri, nu de switch-uri: se salvează odată cu formularul,
// nu la fiecare apăsare.

const STATUS: Record<TeamMember['status'], { label: string; tone: StateTone }> = {
  active: { label: t('common:states.active'), tone: 'success' },
  invited: { label: t('team:status.invited'), tone: 'warning' },
  disabled: { label: t('team:status.disabled'), tone: 'critical' },
}

const TZ = 'Europe/Bucharest'
const MAILBOX_QUERY_KEY = ['email', 'settings'] as const

/** „acum 2 ore", cu data completă la hover și focus; „Activ acum" e text, nu doar un punct. */
function LastSeen({ at }: { at: string | null }) {
  if (!at) return <span className="text-sm text-muted-foreground">{t('team:members.neverSignedIn')}</span>
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000)
  const full = new Intl.DateTimeFormat(intlTag(), { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }).format(new Date(at))
  // Fără prezență (push B vine cu Mesajele), „activ acum" înseamnă că a venit un request
  // în ultimele două minute — `last_seen_at` se scrie cel mult o dată pe minut.
  const active = minutes < 2
  const label = active ? t('team:members.activeNow') : new Intl.RelativeTimeFormat(intlTag(), { numeric: 'auto' }).format(-minutes, 'minute')
  return (
    <Tooltip content={full}>
      <span className="text-sm text-muted-foreground">
        {active ? <span className="mr-1.5 inline-block size-1.5 rounded-full bg-success-text align-middle" aria-hidden="true" /> : null}
        {label}
      </span>
    </Tooltip>
  )
}

// Name, email, role, mailboxes, state, last activity, actions: what drops first on a narrow screen.
const COLUMN_VISIBILITY = ['', 'hidden md:table-cell', '', 'hidden lg:table-cell', '', 'hidden lg:table-cell', '']

/** Identitățile de trimitere existente, ca omul să aleagă din ce îi e permis. */
function useIdentities(enabled: boolean) {
  return useQuery({
    queryKey: MAILBOX_QUERY_KEY,
    queryFn: () => api.get<EmailSettings>('/api/email/settings'),
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

function MailboxPicker({
  identities,
  selected,
  onToggle,
  blocked,
}: {
  identities: EmailIdentity[]
  selected: string[]
  onToggle: (key: string, on: boolean) => void
  /** Cheile pe care actorul nu le are: bifa rămâne vizibilă, dar cu motivul la hover. */
  blocked: string[]
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-sm font-medium">{t('team:labels.mailboxes')}</legend>
      {identities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('team:members.noIdentities')}</p>
      ) : (
        identities.map((identity) => {
          const address = (/<(.+)>/.exec(identity.fromAddress)?.[1] ?? identity.fromAddress).trim().toLowerCase()
          const on = selected.includes(identity.key)
          const reason = blocked.includes(identity.key) ? t('team:members.mailboxNotYours', { address }) : undefined
          const control = (
            <Checkbox
              checked={on}
              disabled={Boolean(reason)}
              aria-label={address}
              onChange={(event) => onToggle(identity.key, event.target.checked)}
            />
          )
          return (
            <div key={identity.key} className="flex items-center gap-2">
              {reason ? <Tooltip content={reason}>{control}</Tooltip> : control}
              <span className="text-sm">{address}</span>
            </div>
          )
        })
      )}
    </fieldset>
  )
}

export function TeamPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { can, session } = useMe()
  const canManage = can('echipa.administrare')
  const canChat = can('mesaje.view')
  // Folderele unui om plecat rămân închise până le preia altcineva (Arhivă, Wave 6).
  const canAssignFolders = can('arhiva.administrare')
  const [assigning, setAssigning] = useState<TeamMember | null>(null)
  const [search, setSearch] = useState('')
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<TeamMember | null>(null)
  const [sentReset, setSentReset] = useState<{ id: string; email: string } | null>(null)
  const debouncedSearch = useDebounced(search, 200)

  const members = useTeamMembers()
  const roles = useQuery({
    queryKey: ['access', 'matrix'],
    queryFn: () => api.get<{ roles: { id: string; name: string; kind: string }[] }>('/api/access/matrix'),
    enabled: canManage,
  })

  // Cutiile fiecărui om vin pe rând, cu o interogare per membru (`useQueries`, nu o apă):
  // lista e de mărimea echipei, iar o listă goală înseamnă „nu are", nu „nu știm".
  const mailboxQueries = useQueries({
    queries: (members.data ?? []).map((member) => ({
      queryKey: ['team', 'mailboxes', member.id],
      queryFn: () => api.get<{ identityKeys: string[] }>(`/api/team/members/${member.id}/mailboxes`),
      staleTime: 60_000,
    })),
  })

  const list = members.data ?? []
  const mailboxesByMember = new Map(list.map((member, index) => [member.id, mailboxQueries[index]?.data?.identityKeys ?? []]))
  const needle = normalizeForSearch(debouncedSearch.trim())
  const filtered = needle
    ? list.filter((m) => normalizeForSearch(`${memberName(m)} ${m.email} ${m.role?.name ?? ''}`).includes(needle))
    : list

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: TEAM_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['team', 'mailboxes'] })
  }

  const resetPassword = useMutation({
    mutationFn: (id: string) => api.post(`/api/team/members/${id}/reset-password`),
    onSuccess: (_data, id) => {
      const target = list.find((m) => m.id === id)
      // Confirmare pe rând, nu dialog: linkul a plecat, deci n-are ce anula.
      setSentReset({ id, email: target?.email ?? '' })
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('team:toasts.linkNotSent')),
  })

  // „Scrie" de pe rând (fișa Echipă): deschide DM-ul cu omul acela, creat dacă nu exista.
  const openDm = useMutation({
    mutationFn: (userId: string) => api.post<{ id: string }>('/api/chat/conversations', { kind: 'dm', userId }),
    onSuccess: (data) => navigate(`/messages/${data.id}`),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('team:toasts.conversationFailed')),
  })

  const resendInvite = useMutation({
    mutationFn: (id: string) => api.post(`/api/team/members/${id}/resend-invite`),
    onSuccess: () => toast.success(t('team:toasts.inviteResent')),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('team:toasts.inviteNotSent')),
  })

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'disabled' }) => api.patch(`/api/team/members/${id}`, { status }),
    onSuccess: (_data, { id, status }) => {
      refresh()
      // Dezactivarea e reversibilă, deci nu merită dialog: se anulează din toast.
      if (status === 'disabled') {
        const target = list.find((m) => m.id === id)
        toast.success(t('team:toasts.disabled', { value: memberName(target as TeamMember) }), {
          action: { label: t('common:actions.cancel'), onClick: () => setStatus.mutate({ id, status: 'active' }) },
        })
      } else {
        toast.success(t('team:toasts.reactivated'))
      }
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common:states.changeNotSaved')),
  })

  if (members.isPending) {
    return (
      <div className="space-y-6" data-density="comfortable">
        <Skeleton className="h-8 w-40" />
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (members.isError) {
    return (
      <div className="space-y-2 py-8 text-sm" data-density="comfortable">
        <p>{t('team:loadFailed')}</p>
        <Button variant="outline" onClick={() => void members.refetch()}>
          {t('common:actions.retry')}
        </Button>
      </div>
    )
  }

  const roleOptions = (roles.data?.roles ?? []).map((role) => ({ value: role.id, label: role.name }))

  return (
    <div className="space-y-6" data-density="comfortable">
      <PageHeader
        title={t('common:nav.team')}
        description={t('team:description')}
        actions={
          canManage ? (
            <Button onClick={() => setInviting(true)}>
              <UserPlus className="h-4 w-4" />
              {t('team:invite.button')}
            </Button>
          ) : null
        }
      />

      {list.length === 1 ? (
        <EmptyState
          kind="new"
          title={t('team:empty.aloneTitle')}
          description={canManage ? t('team:empty.aloneAdminHint') : t('team:empty.aloneMemberHint')}
          action={
            canManage ? (
              <Button onClick={() => setInviting(true)}>
                <UserPlus className="h-4 w-4" />
                {t('team:invite.first')}
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="max-w-xs">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('team:search.placeholder')}
              aria-label={t('team:search.aria')}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              kind="filtered"
              title={t('team:empty.noMatchTitle')}
              description={t('team:empty.noMatchHint', { debouncedSearch: debouncedSearch.trim() })}
              onReset={() => setSearch('')}
            />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">{t('team:members.tableCaption')}</caption>
                <thead>
                  <tr>
                    {[t('common:labels.name'), t('common:labels.email'), t('common:labels.role'), t('team:members.mailboxesShort'), t('common:labels.state'), t('team:members.lastActivity'), ''].map((heading, index) => (
                      <th
                        key={heading || 'actions'}
                        scope="col"
                        className={cn('whitespace-nowrap border-b pb-2 pr-3 text-left text-xs font-normal text-muted-foreground', COLUMN_VISIBILITY[index])}
                      >
                        {heading ? heading : <span className="sr-only">{t('common:labels.actions')}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((member) => {
                    const boxes = mailboxesByMember.get(member.id) ?? []
                    const isAdmin = member.role?.kind === 'admin'
                    return (
                      <tr key={member.id} className="border-t">
                        <td className="w-full max-w-0 py-2 pr-3">
                          <div className="truncate">
                            {memberName(member)}
                            {member.id === session?.user.id ? <span className="ml-2 text-xs text-muted-foreground">{t('team:members.you')}</span> : null}
                          </div>
                          <div className="truncate text-xs text-muted-foreground md:hidden">{member.email}</div>
                        </td>
                        <td className="hidden max-w-[16rem] truncate py-2 pr-3 text-muted-foreground md:table-cell">{member.email}</td>
                        <td className="py-2 pr-3">
                          {canManage && !isAdmin && member.role ? (
                            <Link to="/modules" className="underline underline-offset-2 hover:text-foreground">
                              {member.role.name}
                            </Link>
                          ) : (
                            (member.role?.name ?? '—')
                          )}
                        </td>
                        <td className="hidden py-2 pr-3 text-muted-foreground lg:table-cell">{isAdmin ? t('common:labels.all') : boxes.length > 0 ? boxes.join(', ') : t('team:members.none')}</td>
                        <td className="py-2 pr-3">
                          <StatePill tone={STATUS[member.status].tone}>{STATUS[member.status].label}</StatePill>
                        </td>
                        <td className="hidden py-2 pr-3 lg:table-cell">
                          {sentReset?.id === member.id ? (
                            <span className="text-sm text-muted-foreground">{t('team:members.resetLinkSent', { email: sentReset.email })}</span>
                          ) : (
                            <LastSeen at={member.lastSeenAt} />
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <span className="mr-1 inline-flex">
                            {canChat && member.status === 'active' && member.id !== session?.user.id ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={openDm.isPending}
                                onClick={() => openDm.mutate(member.id)}
                              >
                                {t('team:members.write')}
                              </Button>
                            ) : null}
                          </span>
                          {canManage || (canAssignFolders && member.status === 'disabled') ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger className="rounded-sm p-1 hover:bg-accent">
                                <Ellipsis className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">{t('team:members.actionsFor', { member: memberName(member) })}</span>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {canAssignFolders && member.status === 'disabled' ? (
                                  <DropdownMenuItem onClick={() => setAssigning(member)}>{t('team:members.assignFolders')}</DropdownMenuItem>
                                ) : null}
                                {canManage ? (
                                  <>
                                    <DropdownMenuItem onClick={() => setEditing(member)}>{t('team:members.changeRoleAndMailboxes')}</DropdownMenuItem>
                                    {member.status === 'invited' ? (
                                      <DropdownMenuItem onClick={() => resendInvite.mutate(member.id)}>{t('team:members.resendInvite')}</DropdownMenuItem>
                                    ) : null}
                                    <DropdownMenuItem onClick={() => resetPassword.mutate(member.id)}>
                                      <Mail className="h-4 w-4" aria-hidden="true" />
                                      {t('team:members.sendResetLink')}
                                    </DropdownMenuItem>
                                    {member.status === 'disabled' ? (
                                      <DropdownMenuItem onClick={() => setStatus.mutate({ id: member.id, status: 'active' })}>
                                        {t('team:members.reactivate')}
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem destructive onClick={() => setStatus.mutate({ id: member.id, status: 'disabled' })}>
                                        {t('common:actions.disable')}
                                      </DropdownMenuItem>
                                    )}
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <InviteDialog open={inviting} onOpenChange={setInviting} roleOptions={roleOptions} onInvited={refresh} />
      <EditMemberDialog member={editing} onClose={() => setEditing(null)} roleOptions={roleOptions} onSaved={refresh} />
      <AssignFoldersDialog from={assigning} members={list} onClose={() => setAssigning(null)} />
    </div>
  )
}

/** Mută toate spațiile de arhivă ale unui om dezactivat la un coleg activ, cu tot subarborele. */
function AssignFoldersDialog({ from, members, onClose }: { from: TeamMember | null; members: TeamMember[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [toUserId, setToUserId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const candidates = members.filter((m) => m.status === 'active' && m.id !== from?.id)

  const assign = useMutation({
    mutationFn: () => api.post<{ moved: number }>(`/api/archive/spaces/${from!.id}/assign`, { toUserId }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
      const target = candidates.find((m) => m.id === toUserId)
      toast.success(data.moved ? target ? t('team:folders.movedTo', { from: memberName(from!), to: memberName(target) }) : t('team:folders.movedToColleague', { from: memberName(from!) }) : t('team:folders.hadNone', { value: memberName(from!) }))
      setToUserId('')
      onClose()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('team:folders.notMoved')),
  })

  return (
    <Dialog open={from !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('team:folders.assignTitle', { from: from ? memberName(from) : '' })}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!toUserId) {
              setError(t('team:folders.pickTarget'))
              return
            }
            setError(null)
            assign.mutate()
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t('team:folders.hint')}
          </p>
          <Field label={t('team:folders.takenBy')} error={error}>
            <Select value={toUserId} onValueChange={setToUserId}>
              <option value="">{t('common:access.share.choose')}</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {memberName(m)}
                </option>
              ))}
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={assign.isPending}>
              {assign.isPending ? t('team:folders.moving') : t('team:folders.assign')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InviteDialog({
  open,
  onOpenChange,
  roleOptions,
  onInvited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleOptions: { value: string; label: string }[]
  onInvited: () => void
}) {
  const identities = useIdentities(open)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [roleId, setRoleId] = useState('')
  const [boxes, setBoxes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const invite = useMutation({
    // Cutiile se trimit imediat după creare, cu id-ul omului tocmai invitat — serverul le
    // scrie în aceeași cerere, deci rândul nou apare în tabel cu cutiile lui, gata.
    mutationFn: async () => {
      const created = await api.post<{ id: string; status: string }>('/api/team/members', {
        email,
        displayName: displayName || undefined,
        roleId,
      })
      if (boxes.length > 0) await api.put(`/api/team/members/${created.id}/mailboxes`, { identityKeys: boxes })
      return created
    },
    onSuccess: () => {
      toast.success(t('team:invite.sentTo', { email }))
      setEmail('')
      setDisplayName('')
      setRoleId('')
      setBoxes([])
      setError(null)
      onOpenChange(false)
      // Rândul nou apare în tabel cu „Invitat" — confirmarea stă acolo, nu într-un toast.
      onInvited()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('team:toasts.inviteNotSent')),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">{t('team:invite.title')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            invite.mutate()
          }}
        >
          <Field label={t('common:labels.email')} error={error}>
            <Input type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
          </Field>
          <Field label={t('team:invite.displayName')} optional>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <Field label={t('common:labels.role')}>
            <Select
              value={roleId}
              onValueChange={setRoleId}
              required
              options={[{ value: '', label: t('team:invite.pickRole') }, ...roleOptions.filter((role) => role.label !== 'Admin')]}
            />
          </Field>
          <MailboxPicker
            identities={identities.data?.identities ?? []}
            selected={boxes}
            blocked={[]}
            onToggle={(key, on) => setBoxes((current) => (on ? [...new Set([...current, key])] : current.filter((k) => k !== key)))}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.discard')}
            </Button>
            <Button type="submit" disabled={invite.isPending || !roleId}>
              <UserPlus className="h-4 w-4" />
              {t('team:invite.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditMemberDialog({
  member,
  onClose,
  roleOptions,
  onSaved,
}: {
  member: TeamMember | null
  onClose: () => void
  roleOptions: { value: string; label: string }[]
  onSaved: () => void
}) {
  const { session } = useMe()
  const identities = useIdentities(Boolean(member))
  // `mailboxes: null` = adminul, care le are pe toate; la manager, blocăm ce nu are el.
  const ownKeys = session?.mailboxes
  const blockedKeys = ownKeys === null || ownKeys === undefined ? [] : (identities.data?.identities ?? []).filter((i) => !ownKeys.includes(i.key)).map((i) => i.key)
  const [roleId, setRoleId] = useState('')
  const [boxes, setBoxes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const currentBoxes = useQuery({
    queryKey: ['team', 'mailboxes', member?.id],
    queryFn: () => api.get<{ identityKeys: string[] }>(`/api/team/members/${member?.id}/mailboxes`),
    enabled: Boolean(member),
    staleTime: 60_000,
  })

  // Cutiile se citesc în dialog, nu la deschidere: `currentBoxes` e deja în cache din tabel.
  const loaded = currentBoxes.data?.identityKeys
  useEffect(() => {
    if (member && loaded) {
      setRoleId(member.role?.id ?? '')
      setBoxes(loaded)
      setError(null)
    }
  }, [member, loaded])

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/api/team/members/${member?.id}`, { roleId })
      await api.put(`/api/team/members/${member?.id}/mailboxes`, { identityKeys: boxes })
    },
    onSuccess: () => {
      toast.success(t('team:edit.saved'))
      onSaved()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('team:edit.notSaved')),
  })

  const isAdmin = member?.role?.kind === 'admin'

  return (
    <Dialog
      open={Boolean(member)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">{member ? memberName(member) : ''}</DialogTitle>
        </DialogHeader>
        {isAdmin ? (
          <p className="text-sm text-muted-foreground">{t('team:edit.adminNote')}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setError(null)
              save.mutate()
            }}
          >
            <Field label={t('common:labels.role')} error={error}>
              <Select value={roleId} onValueChange={setRoleId} options={roleOptions.filter((role) => role.label !== 'Admin')} />
            </Field>
            <MailboxPicker
              identities={identities.data?.identities ?? []}
              selected={boxes}
              blocked={blockedKeys}
              onToggle={(key, on) => setBoxes((current) => (on ? [...new Set([...current, key])] : current.filter((k) => k !== key)))}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common:actions.discard')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t('common:actions.save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
