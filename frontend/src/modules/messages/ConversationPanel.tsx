import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { UserMinus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { FileTypeIcon } from '@/shared/components/FileTypeIcon'
import { Highlight } from '@/shared/components/Highlight'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Input } from '@/shared/components/ui/input'
import { SidePeek } from '@/shared/components/ui/side-peek'
import { Switch } from '@/shared/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { api } from '@/shared/lib/api'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { ChatAttachment, ChatConversation } from '@/shared/lib/types'
import { formatBytes } from '@/shared/lib/utils'
import { ChatAvatar } from './ChatAvatar'
import { conversationTitle, presenceLabel } from './ConversationList'
import { useMinuteTick } from '@/shared/hooks/use-minute-tick'

// The conversation's side panel (#24, #25), in the URL as `?panel=info|search`: members (added and
// removed here by whoever manages the group), mute, the photos and files sent in it, and search
// inside it. Full screen on a phone.

interface MediaItem {
  id: string
  messageId: string
  filename: string
  contentType: string
  sizeBytes: number
  createdAt: string
}

interface SearchHit {
  id: string
  createdAt: string
  authorName: string
  body: string
}

const isPhone = () => window.matchMedia?.('(max-width: 767px)').matches ?? false

export function ConversationPanel({
  conversation,
  meId,
  panel,
  onPanelChange,
  onJump,
  onOpenMedia,
  onMutedChange,
}: {
  conversation: ChatConversation
  meId: string
  panel: 'info' | 'search' | null
  onPanelChange: (panel: 'info' | 'search' | null) => void
  onJump: (messageId: string) => void
  onOpenMedia: (attachment: ChatAttachment) => void
  onMutedChange: () => void
}) {
  const close = () => onPanelChange(null)
  return (
    <SidePeek
      open={panel !== null}
      onClose={close}
      title={panel === 'search' ? t('messages:panel.search') : conversationTitle(conversation, meId)}
    >
      {panel === 'search' ? (
        <SearchPanel
          conversationId={conversation.id}
          onJump={(messageId) => {
            // On a phone the panel covers the thread, so it gets out of the way.
            if (isPhone()) close()
            onJump(messageId)
          }}
        />
      ) : panel === 'info' ? (
        <InfoPanel
          conversation={conversation}
          meId={meId}
          onOpenMedia={(attachment) => {
            if (isPhone()) close()
            onOpenMedia(attachment)
          }}
          onMutedChange={onMutedChange}
        />
      ) : null}
    </SidePeek>
  )
}

function InfoPanel({
  conversation,
  meId,
  onOpenMedia,
  onMutedChange,
}: {
  conversation: ChatConversation
  meId: string
  onOpenMedia: (attachment: ChatAttachment) => void
  onMutedChange: () => void
}) {
  useMinuteTick()
  const [saving, setSaving] = useState(false)
  const toggleMute = async (muted: boolean) => {
    setSaving(true)
    try {
      await api.patch(`/api/chat/conversations/${conversation.id}`, { muted })
      onMutedChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const [adding, setAdding] = useState(false)
  const changeMembers = async (change: { addMemberIds: string[] } | { removeMemberIds: string[] }, done: string, undo?: () => void) => {
    setSaving(true)
    try {
      await api.patch(`/api/chat/conversations/${conversation.id}`, change)
      onMutedChange()
      toast.success(done, undo ? { action: { label: t('common:undo.action'), onClick: undo } } : undefined)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  const addMember = (member: { id: string; displayName: string | null; email: string }) =>
    void changeMembers({ addMemberIds: [member.id] }, t('messages:panel.added', { name: memberName(member) }))
  const removeMember = (member: { id: string; displayName: string | null; email: string }) =>
    void changeMembers({ removeMemberIds: [member.id] }, t('messages:panel.removed', { name: memberName(member) }), () => addMember(member))

  return (
    <div className="space-y-5">
      <section aria-labelledby="panel-members">
        <h3 id="panel-members" className="mb-2 text-xs font-medium text-muted-foreground">
          {t('messages:panel.members', { count: conversation.members.length })}
        </h3>
        <ul className="space-y-2">
          {conversation.members.map((member) => (
            <li key={member.id} className="flex items-center gap-3">
              <ChatAvatar userId={member.id} name={memberName(member)} online={member.presence === 'online'} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {memberName(member)}
                  {member.id === meId ? <span className="text-muted-foreground"> ({t('messages:panel.you')})</span> : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{presenceLabel(member.presence, member.lastSeenAt)}</span>
              </span>
              {/* Nobody removes themselves: the group would be left without anyone to manage it. */}
              {conversation.canManage && member.id !== meId ? (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={saving}
                  aria-label={t('messages:panel.removeMember', { name: memberName(member) })}
                  title={t('messages:panel.removeMember', { name: memberName(member) })}
                  onClick={() => removeMember(member)}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {conversation.canManage ? (
          adding ? (
            <AddMembers conversation={conversation} disabled={saving} onAdd={addMember} onDone={() => setAdding(false)} />
          ) : (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" />
              {t('messages:panel.addPeople')}
            </Button>
          )
        ) : null}
      </section>

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">{t('messages:panel.mute')}</span>
        <Switch checked={conversation.muted} disabled={saving} onCheckedChange={(next: boolean) => void toggleMute(next)} />
      </label>

      <Tabs defaultValue="image">
        <TabsList variant="segmented">
          <TabsTrigger value="image">{t('messages:panel.media')}</TabsTrigger>
          <TabsTrigger value="file">{t('messages:panel.files')}</TabsTrigger>
        </TabsList>
        <TabsContent value="image">
          <MediaList conversationId={conversation.id} kind="image" onOpen={onOpenMedia} />
        </TabsContent>
        <TabsContent value="file">
          <MediaList conversationId={conversation.id} kind="file" onOpen={onOpenMedia} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Active colleagues not yet in the group; a click adds one at once. */
function AddMembers({
  conversation,
  disabled,
  onAdd,
  onDone,
}: {
  conversation: ChatConversation
  disabled: boolean
  onAdd: (member: { id: string; displayName: string | null; email: string }) => void
  onDone: () => void
}) {
  const team = useTeamMembers()
  const inGroup = new Set(conversation.members.map((m) => m.id))
  const candidates = (team.data ?? []).filter((member) => member.status === 'active' && !inGroup.has(member.id))
  return (
    <div className="mt-3 space-y-2 rounded-md border p-2">
      {team.isPending ? (
        <p className="px-1 text-sm text-muted-foreground">{t('common:states.loading')}</p>
      ) : candidates.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t('messages:panel.nobodyToAdd')}</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto">
          {candidates.map((member) => (
            <li key={member.id}>
              <Button variant="ghost" disabled={disabled} className="w-full justify-start gap-3" onClick={() => onAdd(member)}>
                <ChatAvatar userId={member.id} name={memberName(member)} size="sm" />
                <span className="truncate">{memberName(member)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {t('messages:panel.addDone')}
        </Button>
      </div>
    </div>
  )
}

function MediaList({ conversationId, kind, onOpen }: { conversationId: string; kind: 'image' | 'file'; onOpen: (attachment: ChatAttachment) => void }) {
  const media = useInfiniteQuery({
    queryKey: ['chat', 'media', conversationId, kind],
    queryFn: ({ pageParam }) =>
      api.get<{ items: MediaItem[]; nextCursor: string | null }>(
        `/api/chat/conversations/${conversationId}/media?kind=${kind}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = media.data?.pages.flatMap((page) => page.items) ?? []

  if (media.isPending) return <p className="py-4 text-sm text-muted-foreground">{t('common:states.loading')}</p>
  if (items.length === 0) {
    return <EmptyState kind="new" title={kind === 'image' ? t('messages:panel.noMedia') : t('messages:panel.noFiles')} className="py-6" />
  }

  return (
    <div className="pt-3">
      {kind === 'image' ? (
        <ul className="grid grid-cols-3 gap-1">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="block aspect-square w-full overflow-hidden rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={item.filename}
              >
                <img src={`/api/chat/attachments/${item.id}?size=thumb`} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void api.download(`/api/chat/attachments/${item.id}?download=1`, item.filename).catch((err: Error) => toast.error(err.message))}
                className="flex w-full items-center gap-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileTypeIcon filename={item.filename} contentType={item.contentType} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.filename}</span>
                  <span className="block text-xs text-muted-foreground tnum">
                    {formatBytes(item.sizeBytes)} · {formatDate(item.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {media.hasNextPage ? (
        <div className="pt-3 text-center">
          <Button variant="outline" size="sm" disabled={media.isFetchingNextPage} onClick={() => void media.fetchNextPage()}>
            {media.isFetchingNextPage ? t('common:states.loading') : t('messages:panel.more')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function SearchPanel({ conversationId, onJump }: { conversationId: string; onJump: (messageId: string) => void }) {
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term.trim(), 250)
  const hits = useQuery({
    queryKey: ['chat', 'search', conversationId, debounced],
    queryFn: () => api.get<SearchHit[]>(`/api/chat/conversations/${conversationId}/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  })

  return (
    <div className="space-y-3">
      <Input autoFocus type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('messages:panel.searchPlaceholder')} aria-label={t('messages:panel.search')} />
      {debounced.length < 2 ? null : hits.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common:states.loading')}</p>
      ) : (hits.data ?? []).length === 0 ? (
        <EmptyState kind="filtered" title={t('messages:panel.noResults')} onReset={() => setTerm('')} className="py-6" />
      ) : (
        <ul className="divide-y">
          {hits.data!.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => onJump(hit.id)}
                className="w-full py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate font-medium text-foreground">{hit.authorName}</span>
                  <time dateTime={hit.createdAt} className="shrink-0 tnum">
                    {formatDateTime(hit.createdAt)}
                  </time>
                </span>
                <span className="line-clamp-2 text-sm">
                  <Highlight text={hit.body} query={debounced} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
