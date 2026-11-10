import { MoreVertical, Mic, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { api } from '@/shared/lib/api'
import { formatDateTime, formatDuration, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { VoiceNote } from '../types'
import { useWrite } from '../use-sheet'
import { voiceAudioUrl } from './voice-api'

export function VoiceNoteRow({ prospectId, note }: { prospectId: string; note: VoiceNote }) {
  const confirm = useConfirm()
  const write = useWrite()
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(note.caption ?? '')
  const author = note.authorName ?? note.authorEmail ?? t('clients:voice.unknownAuthor')
  const base = `/api/prospects/${prospectId}/voice-notes/${note.id}`

  const saveCaption = async () => {
    const done = await write(() => api.patch(base, { caption: caption.trim() || null }))
    if (done !== undefined) setEditing(false)
  }

  return (
    <li className="space-y-1" data-testid="voice-note">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate font-medium text-foreground">{author}</span>
        <span className="shrink-0" title={formatDateTime(note.createdAt)}>
          {formatRelativeTime(note.createdAt)}
        </span>
        <span className="shrink-0 tabular-nums" aria-label={t('clients:voice.durationLabel', { duration: formatDuration(note.durationSeconds) })}>
          {formatDuration(note.durationSeconds)}
        </span>
        {note.canManage ? (
          <span className="ml-auto shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-control-md w-control-md items-center justify-center rounded-md hover:bg-accent">
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('common:labels.actions')}</span>
              </DropdownMenuTrigger>
              <ResponsiveMenuContent title={author}>
                <DropdownMenuItem
                  onClick={() => {
                    setCaption(note.caption ?? '')
                    setEditing(true)
                  }}
                >
                  <Pencil className="h-4 w-4" /> {t('clients:voice.editCaption')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onClick={() =>
                    void confirm({ title: t('clients:voice.deleteTitle'), consequence: t('clients:voice.deleteBody'), confirmLabel: t('common:actions.delete'), destructive: true }).then(
                      (ok) => ok && write(() => api.delete(base)),
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
                </DropdownMenuItem>
              </ResponsiveMenuContent>
            </DropdownMenu>
          </span>
        ) : null}
      </div>
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void saveCaption()
          }}
        >
          <Input className="min-w-0 flex-1" aria-label={t('clients:voice.caption')} value={caption} maxLength={200} autoFocus onChange={(e) => setCaption(e.target.value)} />
          <Button type="button" variant="outline" onClick={() => setEditing(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit">{t('common:actions.save')}</Button>
        </form>
      ) : note.caption ? (
        <p className="whitespace-pre-wrap break-words text-sm">{note.caption}</p>
      ) : null}
      <audio controls preload="none" src={voiceAudioUrl(prospectId, note.id)} aria-label={t('clients:voice.audioLabel', { author })} className="w-full max-w-full" />
    </li>
  )
}
