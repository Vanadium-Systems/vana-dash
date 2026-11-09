import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { t } from '@/shared/lib/i18n'
import type { Note } from '@/shared/lib/types'
import type { LabelCount } from './notes-api'
import { useNoteActions } from './notes-api'

/** Label chips under the body, with "+ Label" that completes from the person's own labels. */
export function LabelsField({
  note,
  labels,
  readOnly,
  adding,
  onAddingChange,
}: {
  note: Note
  labels: LabelCount[]
  readOnly: boolean
  adding: boolean
  onAddingChange: (adding: boolean) => void
}) {
  const actions = useNoteActions()
  const listId = useId()
  const [draft, setDraft] = useState('')

  const commit = () => {
    const name = draft.trim()
    setDraft('')
    onAddingChange(false)
    if (name && !note.labels.includes(name)) void actions.addLabel([note], name)
  }

  if (note.labels.length === 0 && !adding) return null
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      {note.labels.map((label) => (
        <span key={label} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background/60 pl-2.5 text-xs">
          <span className="truncate">{label}</span>
          {readOnly ? (
            <span className="pr-2.5" />
          ) : (
            <button
              type="button"
              title={t('notes:label.remove', { label })}
              aria-label={t('notes:label.remove', { label })}
              onClick={() => void actions.removeLabel([note], label)}
              className="inline-flex h-control-sm w-6 items-center justify-center rounded-full hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {adding ? (
        <>
          <input
            autoFocus
            list={listId}
            value={draft}
            maxLength={50}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft('')
                onAddingChange(false)
              }
            }}
            data-esc-local=""
            placeholder={t('notes:label.newPlaceholder')}
            aria-label={t('notes:label.newPlaceholder')}
            className="h-control-sm w-40 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <datalist id={listId}>
            {labels.filter((label) => !note.labels.includes(label.name)).map((label) => (
              <option key={label.name} value={label.name} />
            ))}
          </datalist>
        </>
      ) : !readOnly ? (
        <button
          type="button"
          onClick={() => onAddingChange(true)}
          className="inline-flex h-control-sm items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-3 w-3" aria-hidden="true" /> {t('notes:label.add')}
        </button>
      ) : null}
    </div>
  )
}
