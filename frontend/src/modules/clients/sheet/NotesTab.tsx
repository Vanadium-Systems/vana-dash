import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { SnippetTextarea } from '../tasks/SnippetTextarea'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { api } from '@/shared/lib/api'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { SheetNote } from './types'
import { useNotes, useWrite } from './use-sheet'

/** The text after the last `@` when it is still being typed (no space yet), else null. */
function mentionFragment(body: string): string | null {
  const match = body.match(/(?:^|\s)@([^\s@]*)$/)
  return match ? match[1]! : null
}

function NoteEditor({ prospectId, note, onDone }: { prospectId: string; note?: SheetNote; onDone?: () => void }) {
  const write = useWrite()
  const members = (useTeamMembers().data ?? []).filter((member) => member.status === 'active')
  const [body, setBody] = useState(note?.body ?? '')
  const [picked, setPicked] = useState<Array<{ id: string; name: string }>>([])
  const fragment = mentionFragment(body)
  const suggestions = fragment === null ? [] : members.filter((member) => memberName(member).toLowerCase().includes(fragment.toLowerCase())).slice(0, 5)

  const submit = async () => {
    const text = body.trim()
    if (!text) return
    // Only the people whose @name is still in the text are told.
    const mentions = picked.filter((person) => text.includes(`@${person.name}`)).map((person) => person.id)
    const done = await write(() => (note ? api.patch(`/api/prospects/${prospectId}/notes/${note.id}`, { body: text, mentions }) : api.post(`/api/prospects/${prospectId}/notes`, { body: text, mentions })))
    if (done === undefined) return
    setBody('')
    setPicked([])
    onDone?.()
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <SnippetTextarea
        rows={3}
        maxLength={10000}
        aria-label={t('clients:sheet.notes.label')}
        value={body}
        onValueChange={setBody}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {suggestions.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label={t('clients:sheet.notes.mention')}>
          {suggestions.map((member) => (
            <li key={member.id}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setBody((current) => current.replace(/@[^\s@]*$/, () => `@${memberName(member)} `))
                  setPicked((current) => [...current.filter((person) => person.id !== member.id), { id: member.id, name: memberName(member) }])
                }}
              >
                @{memberName(member)}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end gap-2">
        {onDone ? (
          <Button type="button" variant="outline" onClick={onDone}>
            {t('common:actions.cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={!body.trim()}>
          {note ? t('common:actions.save') : t('clients:sheet.notes.add')}
        </Button>
      </div>
    </form>
  )
}

export function NotesTab({ prospectId }: { prospectId: string }) {
  const { session } = useMe()
  const confirm = useConfirm()
  const write = useWrite()
  const notes = useNotes(prospectId)
  const [editing, setEditing] = useState<string | null>(null)
  const meId = session?.user.id

  return (
    <div className="space-y-4">
      <NoteEditor prospectId={prospectId} />
      {notes.isPending ? (
        <ListSkeleton rows={3} />
      ) : notes.data && notes.data.length > 0 ? (
        <ul className="space-y-4">
          {notes.data.map((note) => {
            const own = note.authorUserId === meId
            return (
              <li key={note.id} className="group space-y-1">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate font-medium text-foreground">{note.authorName ?? t('clients:sheet.notes.imported')}</span>
                  <span title={formatDateTime(note.createdAt)}>{formatRelativeTime(note.createdAt)}</span>
                  {note.pinned ? <Pin className="h-3.5 w-3.5" aria-label={t('clients:sheet.notes.pinned')} /> : null}
                  {own ? (
                    <span className="ml-auto flex shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={note.pinned ? t('clients:sheet.notes.unpin') : t('clients:sheet.notes.pin')}
                        title={note.pinned ? t('clients:sheet.notes.unpin') : t('clients:sheet.notes.pin')}
                        onClick={() => void write(() => api.patch(`/api/prospects/${prospectId}/notes/${note.id}`, { pinned: !note.pinned }))}
                      >
                        {note.pinned ? <PinOff /> : <Pin />}
                      </Button>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common:actions.edit')} title={t('common:actions.edit')} onClick={() => setEditing(note.id)}>
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common:actions.delete')}
                        title={t('common:actions.delete')}
                        onClick={() =>
                          void confirm({ title: t('clients:sheet.notes.deleteTitle'), consequence: t('clients:sheet.notes.deleteBody'), confirmLabel: t('common:actions.delete'), destructive: true }).then(
                            (ok) => ok && write(() => api.delete(`/api/prospects/${prospectId}/notes/${note.id}`)),
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  ) : null}
                </div>
                {editing === note.id ? <NoteEditor prospectId={prospectId} note={note} onDone={() => setEditing(null)} /> : <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('clients:sheet.notes.empty')}</p>
      )}
    </div>
  )
}
