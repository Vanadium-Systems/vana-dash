import { MessageSquarePlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { useLiveChatConversations } from '@/shared/hooks/use-chat'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { api } from '@/shared/lib/api'
import { ConversationList } from './ConversationList'
import { ThreadView } from './ThreadView'
import { t } from '@/shared/lib/i18n'

// Pagina Mesaje (fișa din PLAN.md): desktop = coloană de conversații + fir în dreapta; mobil =
// listă și fir sunt ecrane separate (`/messages/:id`), cu înapoi. Streamul e în App.tsx, deasupra
// shell-ului (o singură conexiune per tab), deci nu se reia la fiecare navigare.

export function MessagesPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const conversations = useLiveChatConversations()
  const { session } = useMe()
  const meId = session?.user.id ?? ''
  const [newOpen, setNewOpen] = useState(false)

  // Pe desktop, la intrarea în pagină deschidem prima conversație în locul unui fir gol; după
  // Esc nu, altfel conversația din care tocmai ai ieșit s-ar redeschide imediat. Pe telefon
  // niciodată: lista e ecranul de intrare, iar „înapoi" din conversație trebuie să rămână pe ea.
  // `replace`, ca istoricul să nu acumuleze navigări la fiecare alegere.
  const routeState = location.state as { left?: boolean; fromList?: boolean } | null
  const leftConversation = routeState?.left === true
  useEffect(() => {
    const first = conversations.data?.[0]
    if (id || leftConversation || conversations.isPending || !first) return
    if (!window.matchMedia('(min-width: 768px)').matches) return
    navigate(`/messages/${first.id}`, { replace: true })
  }, [conversations.data, conversations.isPending, id, leftConversation, navigate])

  // Esc iese din conversație. Dialogurile și meniurile deschise își consumă singure Esc-ul,
  // iar editarea unui mesaj îl oprește cu preventDefault.
  useEffect(() => {
    if (!id) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      navigate('/messages', { replace: true, state: { left: true } })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [id, navigate])

  const conversation = conversations.data?.find((c) => c.id === id)
  // Conversația cerută prin id poate să nu existe (stearsă) sau să nu mai conțină omul — 404 de
  // la server, deci aici e o singură linie, nu o pagină de eroare.
  const missing = Boolean(id) && !conversations.isPending && !conversation

  return (
    // comfortable: ecranul e folosit de toată echipa, nu doar de oameni tehnici (DESIGN.md).
    // Înălțimea e cea a shell-ului (padding 2rem pe mobil, 3rem pe desktop), ca firul să aibă
    // scroll propriu în loc să împingă pagina.
    // Pe telefon scădem și bara de jos (4rem) + zonele sigure, ca lista să nu împingă pagina.
    <div
      className="flex h-[calc(100dvh-6rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] min-h-0 flex-col md:h-[calc(100dvh-3rem)]"
      data-density="comfortable"
    >
      <div className="flex min-h-0 flex-1 md:grid md:grid-cols-[300px_minmax(0,1fr)]">
        <aside
          className={id ? 'hidden min-h-0 border-r md:block' : 'min-h-0 flex-1 overflow-hidden md:border-r'}
          aria-label={t('messages:list.title')}
        >
          <ConversationList meId={meId} onNew={() => setNewOpen(true)} />
        </aside>

        <section
          // Pe telefon conversația ocupă tot ecranul, peste shell: antetul și câmpul de scris stau
          // pe loc, doar mesajele au scroll (cu tastatura deschisă, `resizes-content` din
          // index.html micșorează ecranul, deci câmpul rămâne deasupra ei).
          className={
            id
              ? 'safe-top safe-bottom fixed inset-0 z-50 flex flex-col bg-background md:static md:z-auto md:min-h-0 md:min-w-0 md:flex-1 md:p-0'
              : 'hidden min-h-0 min-w-0 md:block'
          }
          aria-label={t('common:nav.messages')}
        >
          {conversation ? (
            <ThreadView
              key={conversation.id}
              conversation={conversation}
              meId={meId}
              onBack={() => (routeState?.fromList ? navigate(-1) : navigate('/messages', { replace: true }))}
            />
          ) : missing ? (
            <p className="p-6 text-sm text-muted-foreground">{t('messages:page.gone')}</p>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <MessageSquarePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">{t('messages:page.pickOne')}</p>
            </div>
          )}
        </section>
      </div>

      <NewConversationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onOpened={(conversationId) => navigate(`/messages/${conversationId}`)}
      />
    </div>
  )
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpened: (conversationId: string) => void
}) {
  const members = useTeamMembers()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const others = (members.data ?? []).filter((member) => member.status === 'active')

  const close = () => {
    setName('')
    setSelected([])
    onOpenChange(false)
  }

  const create = async (payload: { kind: 'dm'; userId: string } | { kind: 'group'; name: string; memberIds: string[] }) => {
    setSaving(true)
    try {
      const { id } = await api.post<{ id: string }>('/api/chat/conversations', payload)
      close()
      onOpened(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('messages:list.writeToSomeone')}</DialogTitle>
        </DialogHeader>

        <section className="space-y-1">
          <h3 className="text-sm font-medium">{t('messages:new.direct')}</h3>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('messages:new.nobodyActive')}</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto">
              {others.map((member) => (
                <li key={member.id}>
                  {/* Rând de listă, deci `Button` ghost pe lățime plină, nu un <button> gol. */}
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void create({ kind: 'dm', userId: member.id })}
                    className="w-full justify-start"
                  >
                    <span className="font-medium">{memberName(member)}</span>
                    <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 border-t pt-3">
          <Label htmlFor="group-name">{t('messages:new.group')}</Label>
          <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('messages:new.groupPlaceholder')} />
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted-foreground">{t('messages:new.members')}</legend>
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {others.map((member) => (
                <li key={member.id}>
                  <label className="flex items-center gap-2 px-2 py-1 text-sm">
                    <Checkbox
                      checked={selected.includes(member.id)}
                      onChange={(e) =>
                        setSelected((current) =>
                          e.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id),
                        )
                      }
                    />
                    {memberName(member)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <Button
            onClick={() => void create({ kind: 'group', name, memberIds: selected })}
            disabled={saving || name.trim().length === 0 || selected.length === 0}
          >
            <Users className="h-4 w-4" />
            {t('messages:new.createGroup')}
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  )
}