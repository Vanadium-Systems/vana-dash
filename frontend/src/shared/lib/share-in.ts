import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/shared/lib/api'
import { isNative } from '@/shared/lib/native'
import { useAuth } from '@/shared/hooks/use-auth'
import { t } from '@/shared/lib/i18n'

interface SharedFile {
  path?: string
  name?: string
  mimeType?: string
}

interface ShareInPlugin {
  isPending(): Promise<{ count: number }>
  readNext(): Promise<SharedFile>
  clear(): Promise<void>
  addListener(eventName: 'pendingShare', listener: () => void): Promise<PluginListenerHandle>
}

const ShareIn = registerPlugin<ShareInPlugin>('ShareIn')

export interface PendingSave {
  id: number
  name: string
  mimeType: string
  base64: string
}

// Fișierele partajate stau aici până când Stefan alege folderul destinație în SaveShareDialog —
// nimic nu urcă automat în rădăcina Arhivei (cerința lui: „popup unde să salvez documentul").
let saves: PendingSave[] = []
let snapshot: PendingSave[] = []
let nextId = 0
const listeners = new Set<() => void>()

function emit() {
  snapshot = [...saves]
  for (const listener of listeners) listener()
}

export function subscribeSaves(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSavesSnapshot(): PendingSave[] {
  return snapshot
}

export function removeSaved(ids: number[]) {
  const dropped = new Set(ids)
  saves = saves.filter((save) => !dropped.has(save.id))
  emit()
}

export function discardSaves() {
  if (!saves.length) return
  saves = []
  emit()
}

export async function uploadSave(save: PendingSave, folderId: string | null, nameOverride?: string): Promise<void> {
  const fd = new FormData()
  // folderId TREBUIE adăugat înainte de file (@fastify/multipart citește secvențial).
  if (folderId) fd.append('folderId', folderId)
  // Dacă Stefan redenumește fără extensie, o păstrăm din numele original — altfel fișierul
  // ajunge pe disc fără .pdf/.jpg și nu se mai deschide la dublu-click.
  const requested = nameOverride?.trim()
  const ext = (s: string) => {
    const i = s.lastIndexOf('.')
    return i > 0 ? s.slice(i) : ''
  }
  const finalName = requested
    ? ext(requested) || !ext(save.name)
      ? requested
      : requested + ext(save.name)
    : save.name
  fd.append(
    'file',
    new Blob([Uint8Array.from(atob(save.base64), (c) => c.charCodeAt(0))], { type: save.mimeType }),
    finalName,
  )
  await api.upload('/api/archive/files', fd)
}

async function processPendingShares(navigate: (path: string) => void) {
  const { count } = await ShareIn.isPending()
  const incoming: Omit<PendingSave, 'id'>[] = []
  for (let i = 0; i < count; i++) {
    const file = await ShareIn.readNext()
    if (!file.path || !file.name) continue
    try {
      const { data } = await Filesystem.readFile({ path: file.path, directory: Directory.Cache })
      if (typeof data !== 'string') continue
      incoming.push({ name: file.name, mimeType: file.mimeType ?? 'application/octet-stream', base64: data })
    } catch {
      // Fișier pierdut din cache — nu aruncăm tot batch-ul pentru el.
    } finally {
      await Filesystem.deleteFile({ path: file.path, directory: Directory.Cache }).catch(() => {})
    }
  }
  await ShareIn.clear()
  if (!incoming.length) return
  saves.push(...incoming.map((item) => ({ ...item, id: ++nextId })))
  emit()
  navigate('/archive')
}

// La share pe app deja deschisă sosesc ÎMPREUNĂ evenimentul nativ pendingShare ȘI
// visibilitychange — două rulări concurente se împușcă reciproc prin clear(), care șterge
// fișierul scris de cealaltă înainte s-o citească (ENOENT, găsit live 2026-08-24). Le pun pe
// lanț, nu le sar: fiecare rulare ajunge să vadă coada goală și iese curat.
let processingChain: Promise<void> = Promise.resolve()

function scheduleProcessing(navigate: (path: string) => void): Promise<void> {
  const run = processingChain.then(() => processPendingShares(navigate))
  processingChain = run.catch((err) => {
    toast.error(t('common:errors.shareToArchive', { message: err instanceof Error ? err.message : t('common:errors.unknown') }))
  })
  return run.catch(() => {})
}

// Autentificat-only: uploadul are nevoie de sesiune, iar re-rularea la trecerea în starea
// autentificată acoperă cazul „share → login → salvare". Procesează la mount, la revenirea
// în app (visibilitychange) și la share pe app deja deschisă (evenimentul nativ pendingShare).
export function useShareIn() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isNative || !isAuthenticated) return
    scheduleProcessing(navigate)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void scheduleProcessing(navigate)
    }
    document.addEventListener('visibilitychange', onVisibility)
    const listener = ShareIn.addListener('pendingShare', () => void scheduleProcessing(navigate))
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void listener.then((handle) => handle.remove())
    }
  }, [isAuthenticated, navigate])
}
