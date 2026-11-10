import { Mic, Pencil, Pin, PinOff, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { SnippetTextarea } from '../tasks/SnippetTextarea'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { useMe } from '@/shared/hooks/use-me'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { api } from '@/shared/lib/api'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { SheetNote, VoiceNote } from './types'
import { useNotes, useWrite } from './use-sheet'
import { useVoiceNotes, useVoiceStorageOff } from './voice/voice-api'
import { VoiceNoteRow } from './voice/VoiceNoteRow'
import { VoiceRecorder } from './voice/VoiceRecorder'
import { VoiceUploadPanel } from './voice/VoiceUploadPanel'

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

export type NoteEntry = { kind: 'note'; note: SheetNote } | { kind: 'voice'; voice: VoiceNote }

/** Pinned text notes stay on top as the server sends them; the rest, text and voice, newest first. */
export function mixNotes(notes: SheetNote[], voices: VoiceNote[]): NoteEntry[] {
  const pinned = notes.filter((note) => note.pinned).map<NoteEntry>((note) => ({ kind: 'note', note }))
  const rest = [...notes.filter((note) => !note.pinned).map<NoteEntry>((note) => ({ kind: 'note', note })), ...voices.map<NoteEntry>((voice) => ({ kind: 'voice', voice }))]
  const at = (entry: NoteEntry) => Date.parse(entry.kind === 'note' ? entry.note.createdAt : entry.voice.createdAt)
  return [...pinned, ...rest.sort((a, b) => at(b) - at(a))]
}

export function NotesTab({ prospectId }: { prospectId: string }) {
  const { session } = useMe()
  const confirm = useConfirm()
  const write = useWrite()
  const notes = useNotes(prospectId)
  const voices = useVoiceNotes(prospectId)
  const storageOff = useVoiceStorageOff()
  const [editing, setEditing] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recorderBusy, setRecorderBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const meId = session?.user.id
  const entries = mixNotes(notes.data ?? [], voices.data ?? [])

  return (
    <div className="space-y-4">
      <NoteEditor prospectId={prospectId} />
      {storageOff ? (
        <Alert tone="warning">{t('clients:voice.storageOff')}</Alert>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setRecording(true)}>
            <Mic aria-hidden="true" /> {t('clients:voice.button')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setUploading(true)}>
            <Upload aria-hidden="true" /> {t('clients:voice.uploadButton')}
          </Button>
        </div>
      )}
      {/* A take that is not saved yet is lost when the dialog closes, so only "Renunță" closes it then. */}
      <Dialog open={recording} onOpenChange={(open) => (open || !recorderBusy) && setRecording(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clients:voice.recorderTitle')}</DialogTitle>
          </DialogHeader>
          <VoiceRecorder prospectId={prospectId} onBusyChange={setRecorderBusy} onSaved={() => setRecording(false)} onClose={() => setRecording(false)} />
        </DialogContent>
      </Dialog>
      {uploading ? <VoiceUploadPanel prospectId={prospectId} onClose={() => setUploading(false)} /> : null}
      {notes.isPending || voices.isPending ? (
        <ListSkeleton rows={3} />
      ) : entries.length > 0 ? (
        <ul className="space-y-4">
          {entries.map((entry) => {
            if (entry.kind === 'voice') return <VoiceNoteRow key={`voice-${entry.voice.id}`} prospectId={prospectId} note={entry.voice} />
            const note = entry.note
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
