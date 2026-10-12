import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import type { ArchiveFolder } from '@/shared/lib/types'

export interface PickerCrumb {
  id: string | null
  name: string
}

// Mini-browser de foldere reutilizat de MoveDialog și SaveShareDialog — navighezi cu click,
// folderul curent e ultimul din trail (null = rădăcină). Starea (trail) e a părinților, care
// decid ce fac cu selecția la confirmare.
export function FolderPicker({ trail, onNavigate }: { trail: PickerCrumb[]; onNavigate: (trail: PickerCrumb[]) => void }) {
  const currentId = trail[trail.length - 1]?.id ?? null

  const folders = useQuery({
    queryKey: ['archive', 'folders', 'picker', currentId],
    queryFn: () => api.get<ArchiveFolder[]>(`/api/archive/folders${currentId ? `?parentId=${currentId}` : ''}`),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {trail.map((crumb, i) => (
          <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
            {i > 0 ? <span>/</span> : null}
            <button
              type="button"
              className="hover:underline disabled:no-underline"
              onClick={() => onNavigate(trail.slice(0, i + 1))}
              disabled={i === trail.length - 1}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
        {folders.isPending ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Se încarcă…</p>
        ) : folders.data?.length ? (
          folders.data.map((f) => (
            <button
              key={f.id}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => onNavigate([...trail, { id: f.id, name: f.name }])}
            >
              📁 {f.name}
            </button>
          ))
        ) : (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Niciun subfolder aici.</p>
        )}
      </div>
    </>
  )
}
