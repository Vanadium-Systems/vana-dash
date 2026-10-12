import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import {
  CalendarClock,
  Download,
  File as FileIcon,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Share2,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { PageHeader } from '@/shared/components/PageHeader'
import { AccessShareDialog } from '@/shared/components/AccessShareDialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { api } from '@/shared/lib/api'
import { blobToBase64, isNative } from '@/shared/lib/native'
import type {
  AccessLevel,
  AccessShare,
  ArchiveDownloadUrl,
  ArchiveFile,
  ArchiveFolder,
  ArchiveFolderPath,
  ArchiveSearchResult,
  ArchiveSpaceEntry,
  ArchiveSpaces,
  StorageUsage,
} from '@/shared/lib/types'
import { cn, formatBytes } from '@/shared/lib/utils'
import { MoveDialog } from './MoveDialog'
import { SaveShareDialog } from './SaveShareDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

const VIEW_MODE_KEY = 'archive-view-mode'
type ViewMode = 'list' | 'grid'
type SortMode = 'recent' | 'oldest' | 'name'
const SORT_LABELS: Record<SortMode, string> = { recent: t('archive:sort.recent'), oldest: t('archive:sort.old'), name: 'A-Z' }

// Chrome desktop/Firefox n-au Web Share API — ascundem butonul în loc să-l arătăm mereu ca
// să eșueze la click. Pe nativ sheet-ul vine oricum din plugin-ul Capacitor. Verificare reală
// (fișier+MIME) tot se face la share (`canShare`), asta e doar gate-ul de randare.
const canShareFiles = isNative || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')

// Roșu peste 90% din plafonul gratuit R2 (10GB implicit, config.r2.freeTierLimitGb) — Stefan
// vede din timp înainte să treacă pe planul plătit fără să vrea.
function StorageUsageIndicator() {
  const usage = useQuery({
    queryKey: ['archive', 'storage'],
    queryFn: () => api.get<StorageUsage>('/api/archive/storage'),
    staleTime: 5 * 60 * 1000,
  })
  if (!usage.data) return null
  const ratio = usage.data.usedBytes / usage.data.limitBytes
  const tone = ratio >= 0.9 ? 'text-destructive' : ratio >= 0.7 ? 'text-warning' : 'text-muted-foreground'
  return (
    <span className={cn('text-sm', tone)} title={t('archive:storage.hint')}>
      {formatBytes(usage.data.usedBytes)} / {formatBytes(usage.data.limitBytes)}
    </span>
  )
}

// Miniatura reală (PDF: prima pagină randată la upload; imagini: fișierul propriu, scalat de
// browser) când previewUrl există, altfel o iconiță generică — evită să tragem thumbnail-uri
// pt. tipuri fără preview (xml, zip etc.).
function FileNameCell({ name, previewUrl }: { name: string; previewUrl: string | null }) {
  return (
    <div className="flex items-center gap-2">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="h-10 w-10 shrink-0 rounded border object-cover" />
      ) : (
        <FileIcon className="h-10 w-10 shrink-0 rounded border p-2 text-muted-foreground" />
      )}
      <span className="font-medium">{name}</span>
    </div>
  )
}

// Rândurile de fișiere/foldere se umpluseră de butoane individuale ("arată freaky",
// feedback Stefan) — un singur kebab pe rând, restul acțiunilor în meniu.
function RowActionsMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-card hover:bg-accent">
        <MoreVertical className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

// Card pt. modul grilă (view mode "grid") — thumbnail mare + kebab suprapus în colț, gen
// Google Drive. Butonul de deschidere (onOpen) și meniul de acțiuni sunt frați, nu unul
// în celălalt (nested <button> ar fi HTML invalid) — poziționarea absolute e ce le suprapune vizual.
function FolderCard({ folder, onOpen, actions }: { folder: ArchiveFolder; onOpen: () => void; actions: ReactNode }) {
  return (
    <div className="group relative rounded-lg border">
      <button type="button" className="flex w-full flex-col items-center gap-2 p-3 hover:bg-accent" onClick={onOpen}>
        <Folder className="h-16 w-16 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2 w-full break-words text-center text-sm font-medium">{folder.name}</span>
        <span className="text-xs text-muted-foreground">
          {t('common:count.files', { count: folder.fileCount })} · {t('common:count.folders', { count: folder.subfolderCount })}
        </span>
      </button>
      {actions ? (
        <div className="absolute right-1 top-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      ) : null}
    </div>
  )
}

function FileCard({
  file,
  onOpen,
  actions,
}: {
  file: { id: string; name: string; sizeBytes: number; previewUrl: string | null }
  onOpen: () => void
  actions: ReactNode
}) {
  return (
    <div className="group relative rounded-lg border">
      <button type="button" className="flex w-full flex-col items-center gap-2 p-3 hover:bg-accent" onClick={onOpen}>
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
          {file.previewUrl ? (
            <img src={file.previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <FileIcon className="h-8 w-8 text-muted-foreground" />
          )}
        </div>
        <span className="line-clamp-2 w-full break-words text-center text-sm font-medium">{file.name}</span>
        <span className="text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
      </button>
      <div className="absolute right-1 top-1" onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    </div>
  )
}

interface Crumb {
  id: string | null
  name: string
}

type SpacesView = 'shared' | 'all'

const LEVEL_LABEL: Record<AccessLevel, string> = { view: t('common:access.share.levelView'), edit: t('common:access.share.levelEdit') }

interface ShareTarget {
  id: string
  name: string
  ownerUserId: string
}

// Folderele partajate cu omul sau, pentru administrare, rădăcinile tuturor spațiilor. Proprietarul
// e scris pe rând, nu doar sugerat prin grupare: aceeași listă amestecă spațiile mai multor oameni.
function SpacesTable({ entries, onOpen }: { entries: ArchiveSpaceEntry[]; onOpen: (id: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('archive:labels.folder')}</TableHead>
          <TableHead>{t('archive:labels.owner')}</TableHead>
          <TableHead className="text-right">{t('archive:labels.access')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id} className="cursor-pointer" onClick={() => onOpen(entry.id)}>
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" /> {entry.name}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{entry.ownerName}</TableCell>
            <TableCell className="text-right">
              <Badge variant="secondary">{LEVEL_LABEL[entry.level]}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// Navigare tip breadcrumb (nu arbore expand/collapse) — mai simplu de implementat corect,
// suficient pt. un browser de fișiere personal. `folder` trăiește în URL (nu doar state local,
// pattern identic EmailPage/MailboxView) — altfel back-ul browserului sărea din pagină în loc
// să meargă un folder înapoi (bug real, Stefan, 2026-09-03). Breadcrumb-ul se reconstruiește din
// `/api/archive/folders/:id/path` — necesar la load direct/refresh/back pe un folder adânc,
// unde trail-ul de click-uri anterioare nu (mai) există.
export function ArchivePage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { session } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentFolderId = searchParams.get('folder')
  const viewParam = searchParams.get('view')
  const spacesView: SpacesView | null = viewParam === 'shared' || viewParam === 'all' ? viewParam : null
  // Lista de spații (partajate / toate) se vede doar la rădăcina tab-ului; un folder deschis din
  // ea se listează ca oricare altul.
  const listingSpaces = spacesView !== null && !currentFolderId

  function openSpacesView(next: SpacesView | null) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      params.delete('folder')
      if (next) params.set('view', next)
      else params.delete('view')
      return params
    })
  }

  function openFolder(id: string | null) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id) next.set('folder', id)
      else next.delete('folder')
      return next
    })
  }

  const spaces = useQuery({
    queryKey: ['archive', 'spaces'],
    queryFn: () => api.get<ArchiveSpaces>('/api/archive/spaces'),
    staleTime: 60 * 1000,
  })

  const folderPath = useQuery({
    queryKey: ['archive', 'folder-path', currentFolderId],
    queryFn: () => api.get<ArchiveFolderPath>(`/api/archive/folders/${currentFolderId}/path`),
    enabled: currentFolderId !== null,
    placeholderData: keepPreviousData,
  })
  const pathData = currentFolderId ? folderPath.data : undefined
  const ownRoot = spaces.data?.own ?? null
  // Rădăcina propriului spațiu nu apare în drum: „Arhivă" e deja spațiul omului.
  const pathEntries = (pathData?.path ?? []).filter((entry, i) => !(i === 0 && entry.id === ownRoot?.id))
  const rootLabel = spacesView === 'shared' ? t('archive:spaces.sharedWithMe') : spacesView === 'all' ? t('archive:spaces.all') : t('common:nav.archive')
  const trail: Crumb[] = [{ id: null, name: rootLabel }, ...pathEntries]
  const currentLevel: AccessLevel = pathData?.level ?? 'edit'
  const canWrite = !listingSpaces && currentLevel === 'edit'
  const othersFolder = pathData && session && pathData.ownerUserId !== session.user.id ? pathData : null
  const showSpacesTabs = Boolean(spaces.data && (spaces.data.shared.length > 0 || spaces.data.spaces))

  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const currentShareTarget: ShareTarget | null = listingSpaces
    ? null
    : currentFolderId
      ? pathData?.canShare
        ? { id: currentFolderId, name: pathData.path.at(-1)?.name ?? '', ownerUserId: pathData.ownerUserId }
        : null
      : ownRoot && session
        ? { id: ownRoot.id, name: t('archive:spaces.mine'), ownerUserId: session.user.id }
        : null
  const [q, setQ] = useState('')
  const [tagsFilter, setTagsFilter] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // dragenter/dragleave se declanșează și pe elementele copil (bordura animată nu trebuie să
  // clipească la fiecare hover intern) — numărăm intrările/ieșirile, nu doar ultimul eveniment.
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)
  // Persistat local — Stefan alege o dată ce vizualizare preferă, nu la fiecare vizită.
  const [viewMode, setViewModeState] = useState<ViewMode>(() => (localStorage.getItem(VIEW_MODE_KEY) === 'grid' ? 'grid' : 'list'))
  function setViewMode(mode: ViewMode) {
    setViewModeState(mode)
    localStorage.setItem(VIEW_MODE_KEY, mode)
  }
  const [sort, setSort] = useState<SortMode>('recent')

  // Debounce — fără el, fiecare tastă schimbă cheia query-ului și React Query trece prin
  // `pending` (fără date cache pt. cheia nouă), Skeleton-ul înlocuiește tabelul la fiecare
  // literă (bug raportat: "fac spazz out toate fișierele"). `q` nededuplicat rezolvă doar
  // jumătate din problemă — placeholderData mai jos ține datele vechi vizibile în timpul fetch-ului.
  const debouncedQ = useDebounced(q, 300)
  const isSearching = debouncedQ.trim().length > 0

  const folders = useQuery({
    queryKey: ['archive', 'folders', currentFolderId, sort],
    queryFn: () => {
      const params = new URLSearchParams({ sort })
      if (currentFolderId) params.set('parentId', currentFolderId)
      return api.get<ArchiveFolder[]>(`/api/archive/folders?${params.toString()}`)
    },
    enabled: !listingSpaces,
    placeholderData: keepPreviousData,
  })

  const files = useQuery({
    queryKey: ['archive', 'files', currentFolderId, tagsFilter, sort],
    queryFn: () => {
      const params = new URLSearchParams()
      if (currentFolderId) params.set('folderId', currentFolderId)
      if (tagsFilter) params.set('tags', tagsFilter)
      params.set('sort', sort)
      return api.get<ArchiveFile[]>(`/api/archive/files?${params.toString()}`)
    },
    enabled: !isSearching && !listingSpaces,
    placeholderData: keepPreviousData,
  })

  // Căutare pe toată arhiva (nu doar folderul curent), cu path-ul complet per rezultat —
  // altfel un fișier "pierdut" într-un subfolder nu apărea deloc la căutare din rădăcină.
  const search = useQuery({
    queryKey: ['archive', 'search', debouncedQ, tagsFilter],
    queryFn: () => {
      const params = new URLSearchParams({ q: debouncedQ })
      if (tagsFilter) params.set('tags', tagsFilter)
      return api.get<ArchiveSearchResult[]>(`/api/archive/search?${params.toString()}`)
    },
    enabled: isSearching,
    placeholderData: keepPreviousData,
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['archive'] })

  const shares = useQuery({
    queryKey: ['archive', 'shares', shareTarget?.id],
    queryFn: () => api.get<AccessShare[]>(`/api/archive/folders/${shareTarget!.id}/shares`),
    enabled: shareTarget !== null,
  })

  const setShare = useMutation({
    mutationFn: ({ userId, level }: { userId: string; level: AccessLevel }) =>
      api.post<AccessShare[]>(`/api/archive/folders/${shareTarget!.id}/shares`, { userId, level }),
    onSuccess: (data) => {
      queryClient.setQueryData(['archive', 'shares', shareTarget?.id], data)
      toast.success(t('archive:toasts.accessSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const removeShare = useMutation({
    mutationFn: (userId: string) => api.delete<AccessShare[]>(`/api/archive/folders/${shareTarget!.id}/shares/${userId}`),
    onSuccess: (data) => {
      queryClient.setQueryData(['archive', 'shares', shareTarget?.id], data)
      toast.success(t('archive:toasts.accessRemoved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleAutoMonthly = useMutation({
    mutationFn: ({ id, autoMonthlySubfolders }: { id: string; autoMonthlySubfolders: boolean }) =>
      api.patch<ArchiveFolder>(`/api/archive/folders/${id}`, { autoMonthlySubfolders }),
    onSuccess: (_data, vars) => {
      invalidate()
      toast.success(
        vars.autoMonthlySubfolders
          ? t('archive:toasts.monthlyOn')
          : t('archive:toasts.monthlyOff'),
      )
    },
    onError: (err) => toast.error(err.message),
  })

  function goToFolder(path: { id: string; name: string }[]) {
    openFolder(path.length ? path[path.length - 1]!.id : null)
    setQ('')
  }

  const createFolder = useMutation({
    mutationFn: (name: string) =>
      api.post<ArchiveFolder>('/api/archive/folders', { name, parentId: currentFolderId ?? undefined }),
    onSuccess: () => {
      invalidate()
      toast.success(t('archive:toasts.folderCreated'))
    },
    onError: (err) => toast.error(err.message),
  })

  const renameFolder = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<ArchiveFolder>(`/api/archive/folders/${id}`, { name }),
    onSuccess: () => {
      invalidate()
      toast.success(t('archive:toasts.folderRenamed'))
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteFolder = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/archive/folders/${id}`),
    onSuccess: () => {
      invalidate()
      toast.success(t('archive:toasts.folderDeleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  const renameFile = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<ArchiveFile>(`/api/archive/files/${id}`, { name }),
    onSuccess: () => {
      invalidate()
      toast.success(t('archive:toasts.fileRenamed'))
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteFile = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/archive/files/${id}`),
    onSuccess: () => {
      invalidate()
      toast.success(t('archive:toasts.fileDeleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  const [moveTarget, setMoveTarget] = useState<{ type: 'file' | 'folder'; id: string; name: string } | null>(null)

  const moveFile = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      api.patch<ArchiveFile>(`/api/archive/files/${id}`, { folderId }),
    onSuccess: () => {
      invalidate()
      toast.success(t('archive:toasts.fileMoved'))
      setMoveTarget(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const moveFolder = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      api.patch<ArchiveFolder>(`/api/archive/folders/${id}`, { parentId }),
    onSuccess: () => {
      invalidate()
      toast.success(t('archive:toasts.folderMoved'))
      setMoveTarget(null)
    },
    onError: (err) => toast.error(err.message),
  })

  function uploadOne(file: File) {
    const fd = new FormData()
    // folderId TREBUIE adăugat înainte de file (@fastify/multipart citește secvențial).
    if (currentFolderId) fd.append('folderId', currentFolderId)
    fd.append('file', file)
    return api.upload<ArchiveFile>('/api/archive/files', fd)
  }

  // Backend-ul acceptă un singur fișier per request (@fastify/multipart, files:1) — upload
  // multiplu = N request-uri de la client, `allSettled` (nu `all`) ca un fișier eșuat să nu
  // blocheze restul batch-ului. Un singur toast de sumar la final, nu unul per fișier.
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const results = await Promise.allSettled(files.map(uploadOne))
      const failed = results.filter((r) => r.status === 'rejected').length
      return { total: files.length, failed }
    },
    onSuccess: ({ total, failed }) => {
      invalidate()
      if (failed === 0) toast.success(total === 1 ? t('archive:toasts.fileUploaded') : t('archive:toasts.filesUploaded', { count: total }))
      else if (failed === total) toast.error(total === 1 ? t('archive:toasts.uploadFailed') : t('archive:toasts.allFailed', { count: total }))
      else toast.warning(t('archive:toasts.partlyUploaded', { done: total - failed, total, failed }))
    },
    onError: (err) => toast.error(err.message),
  })

  // Click pe rând/card — doar previzualizare (tab nou pe URL-ul presemnat R2, nesupus CORS).
  const previewFile = useMutation({
    mutationFn: (id: string) => api.get<ArchiveDownloadUrl>(`/api/archive/files/${id}/download-url`),
    onSuccess: (data) => window.open(data.url, '_blank'),
    onError: (err) => toast.error(err.message),
  })

  // "Descarcă" din meniu — găsit live 2026-08-18: pe Chrome Android, `window.open` pe URL-ul
  // presemnat R2 (cross-origin, deci atributul `download` de pe un `<a>` n-ar avea efect oricum)
  // deschide previzualizarea in-browser, nu un "Save As" real. Ruta same-origin de streaming
  // (deja folosită de ArchiveAttachPicker) + `api.download` (blob local, `<a download>`) dă
  // un download real, identic pe desktop și mobil.
  const downloadFile = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.download(`/api/archive/files/${id}/download`, name),
    onError: (err) => toast.error(err.message),
  })

  // Descărcare reală (zip), spre deosebire de preview-ul de fișier individual de mai sus —
  // un folder nu are cum să fie "previzualizat".
  const downloadFolder = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.download(`/api/archive/folders/${id}/download`, `${name}.zip`),
    onError: (err) => toast.error(err.message),
  })

  // Web Share API (sheet nativ Android — WhatsApp/Email/etc.) — fișierul e trimis ca atașament
  // real, nu link: URL-ul presemnat expiră în 15 min (archive/service.ts), inutilizabil odată
  // ajuns la destinatar. Pe nativ `navigator.share` nu e garantat în WebView — scriem fișierul
  // în cache și sheet-ul vine din plugin-ul Share. Fără suport pe web (`canShare` lipsă/false —
  // desktop, majoritatea browserelor non-mobile), butonul nici nu se randează.
  const shareFile = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { blob, filename } = await api.getBlob(`/api/archive/files/${id}/download`)
      const title = filename ?? name

      if (isNative) {
        const path = `share/${title}`
        await Filesystem.writeFile({
          path,
          data: await blobToBase64(blob),
          directory: Directory.Cache,
          recursive: true,
        })
        try {
          const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path })
          await Share.share({ title, url: uri })
        } finally {
          await Filesystem.deleteFile({ directory: Directory.Cache, path }).catch(() => {})
        }
        return
      }

      const shared = new File([blob], title, { type: blob.type })
      await navigator.share({ files: [shared], title })
    },
    onError: (err) => {
      if (err instanceof Error && err.name === 'AbortError') return // anulat din sheet-ul nativ
      toast.error(err.message)
    },
  })

  // Factorizat — folosit din tabelul de căutare, tabelul de listare ȘI grilă, ca cele 3
  // moduri de randare să nu diveargă (înainte de grilă, primele două deja duplicau meniul).
  // `writable` vine de la folderul curent; la căutare nivelul fiecărui rezultat nu e cunoscut,
  // deci acțiunile rămân, iar serverul refuză pe un folder doar de citit.
  function fileActionsMenu(file: { id: string; name: string }, writable = canWrite) {
    return (
      <RowActionsMenu>
        <DropdownMenuItem onClick={() => downloadFile.mutate({ id: file.id, name: file.name })}>
          <Download className="h-4 w-4" /> {t('common:actions.download')}
        </DropdownMenuItem>
        {canShareFiles ? (
          <DropdownMenuItem onClick={() => shareFile.mutate({ id: file.id, name: file.name })}>
            <Share2 className="h-4 w-4" /> {t('common:actions.send')}
          </DropdownMenuItem>
        ) : null}
        {writable ? (
          <>
            <DropdownMenuItem onClick={() => setMoveTarget({ type: 'file', id: file.id, name: file.name })}>
              <FolderInput className="h-4 w-4" /> {t('common:actions.move')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const name = window.prompt('Nume nou:', file.name)
                if (name?.trim() && name !== file.name) renameFile.mutate({ id: file.id, name: name.trim() })
              }}
            >
              <Pencil className="h-4 w-4" /> {t('common:actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              onClick={() => {
                void confirm({ title: t('archive:files.deleteTitle', { name: file.name }), confirmLabel: t('archive:files.deleteConfirm'), destructive: true }).then((ok) => ok && deleteFile.mutate(file.id))
              }}
            >
              <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </RowActionsMenu>
    )
  }

  function folderActionsMenu(f: ArchiveFolder) {
    const writable = f.level === 'edit'
    return (
      <RowActionsMenu>
        {f.canShare ? (
          <DropdownMenuItem onClick={() => setShareTarget({ id: f.id, name: f.name, ownerUserId: f.ownerUserId })}>
            <Users className="h-4 w-4" /> {t('common:actions.share')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => downloadFolder.mutate({ id: f.id, name: f.name })}>
          <Download className="h-4 w-4" /> {t('archive:actions.downloadZip')}
        </DropdownMenuItem>
        {writable ? (
          <>
            <DropdownMenuItem onClick={() => toggleAutoMonthly.mutate({ id: f.id, autoMonthlySubfolders: !f.autoMonthlySubfolders })}>
              <CalendarClock className="h-4 w-4" />
              {f.autoMonthlySubfolders ? t('archive:folders.monthlyDisable') : t('archive:folders.monthlyEnable')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMoveTarget({ type: 'folder', id: f.id, name: f.name })}>
              <FolderInput className="h-4 w-4" /> {t('common:actions.move')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const name = window.prompt('Nume nou:', f.name)
                if (name?.trim() && name !== f.name) renameFolder.mutate({ id: f.id, name: name.trim() })
              }}
            >
              <Pencil className="h-4 w-4" /> {t('common:actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              onClick={() => {
                void confirm({ title: t('archive:folders.deleteTitle', { name: f.name }), consequence: t('archive:folders.deleteBody'), confirmLabel: t('archive:folders.deleteConfirm'), destructive: true }).then((ok) => ok && deleteFolder.mutate(f.id))
              }}
            >
              <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </RowActionsMenu>
    )
  }

  const spaceEntries = (spacesView === 'shared' ? spaces.data?.shared : spaces.data?.spaces) ?? []

  const isEmpty = isSearching ? !search.data?.length : !folders.data?.length && !files.data?.length

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.archive')}
        description={
          <div className="flex flex-wrap items-center gap-1">
            {trail.map((crumb, i) => (
              <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
                {i > 0 ? <span>/</span> : null}
                <button
                  type="button"
                  className="hover:underline disabled:no-underline"
                  onClick={() => openFolder(crumb.id)}
                  disabled={i === trail.length - 1}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
            {othersFolder ? (
              <>
                <span className="mx-1">·</span>
                <span>
                  {t('archive:spaces.belongsTo')} {othersFolder.ownerName}
                  {othersFolder.level === 'view' ? t('archive:spaces.readOnly') : ''}
                </span>
              </>
            ) : null}
            <span className="mx-1">·</span>
            <StorageUsageIndicator />
          </div>
        }
        actions={
          <>
            {currentShareTarget ? (
              <Button variant="outline" onClick={() => setShareTarget(currentShareTarget)}>
                <Users className="h-4 w-4" /> {t('common:actions.share')}
              </Button>
            ) : null}
            {canWrite ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const name = window.prompt('Nume folder nou:')
                    if (name?.trim()) createFolder.mutate(name.trim())
                  }}
                >
                  <FolderPlus className="h-4 w-4" /> {t('archive:folders.new')}
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
                  <Upload className="h-4 w-4" /> {upload.isPending ? t('common:states.uploading') : t('archive:actions.upload')}
                </Button>
              </>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) upload.mutate(files)
                e.target.value = ''
              }}
            />
          </>
        }
      />

      {showSpacesTabs ? (
        <Tabs value={spacesView ?? 'own'} onValueChange={(v) => openSpacesView(v === 'own' ? null : (v as SpacesView))}>
          <TabsList>
            <TabsTrigger value="own">{t('archive:spaces.mine')}</TabsTrigger>
            <TabsTrigger value="shared">{t('archive:spaces.sharedWithMe')}</TabsTrigger>
            {spaces.data?.spaces ? <TabsTrigger value="all">{t('archive:spaces.all')}</TabsTrigger> : null}
          </TabsList>
        </Tabs>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t('archive:search.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder={t('archive:search.tagFilter')}
          value={tagsFilter}
          onChange={(e) => setTagsFilter(e.target.value)}
          className="max-w-xs"
        />
        {!isSearching ? (
          <Select
            className="w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            title={t('archive:view.sortFiles')}
          >
            {(Object.keys(SORT_LABELS) as SortMode[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="ml-auto flex items-center gap-1 rounded-md border border-input p-0.5">
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="icon-sm"
            title={t('archive:view.list')}
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="icon-sm"
            title={t('archive:view.grid')}
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card
        className="relative"
        onDragEnter={(e: DragEvent) => {
          e.preventDefault()
          dragCounter.current += 1
          if (canWrite && e.dataTransfer.types.includes('Files')) setIsDragOver(true)
        }}
        onDragLeave={(e: DragEvent) => {
          e.preventDefault()
          dragCounter.current -= 1
          if (dragCounter.current <= 0) {
            dragCounter.current = 0
            setIsDragOver(false)
          }
        }}
        onDragOver={(e: DragEvent) => e.preventDefault()}
        onDrop={(e: DragEvent) => {
          e.preventDefault()
          dragCounter.current = 0
          setIsDragOver(false)
          const files = Array.from(e.dataTransfer.files)
          if (files.length && canWrite) upload.mutate(files)
        }}
      >
        {isDragOver ? (
          <div className="pointer-events-none absolute inset-1 z-10 flex animate-pulse items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5">
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <Upload className="h-4 w-4" /> {t('archive:upload.dropHere')}
            </p>
          </div>
        ) : null}
        <CardContent className="px-2 pt-6 sm:px-6">
          {listingSpaces && !isSearching ? (
            spaces.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : spaceEntries.length ? (
              <SpacesTable entries={spaceEntries} onOpen={openFolder} />
            ) : (
              <EmptyState
                kind="new"
                title={spacesView === 'shared' ? t('archive:empty.nothingShared') : t('archive:empty.noSpace')}
                description={spacesView === 'shared' ? t('archive:empty.sharedHint') : undefined}
              />
            )
          ) : (isSearching ? search.isPending : folders.isPending || files.isPending) ? (
            <Skeleton className="h-32 w-full" />
          ) : isEmpty ? (
            <p className="text-sm text-muted-foreground">
              {isSearching ? t('archive:empty.noFileFound') : canWrite ? t('archive:empty.folderWithActions') : t('archive:empty.folder')}
            </p>
          ) : !isSearching && viewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {folders.data?.map((f) => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  onOpen={() => openFolder(f.id)}
                  actions={folderActionsMenu(f)}
                />
              ))}
              {files.data?.map((file) => (
                <FileCard key={file.id} file={file} onOpen={() => previewFile.mutate(file.id)} actions={fileActionsMenu(file)} />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.name')}</TableHead>
                  <TableHead>{isSearching ? t('archive:labels.location') : t('common:labels.details')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('archive:labels.tags')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isSearching &&
                  search.data?.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => previewFile.mutate(r.id)}>
                      <TableCell>
                        <FileNameCell name={r.name} previewUrl={r.previewUrl} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <button
                          type="button"
                          className="flex items-center gap-1 hover:underline"
                          title={t('archive:folders.open')}
                          onClick={(e) => {
                            e.stopPropagation()
                            goToFolder(r.folderPath)
                          }}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                          {r.folderPath.length ? r.folderPath.map((p) => p.name).join(' / ') : t('archive:folders.root')}
                        </button>
                        <div className="text-xs">
                          {r.mimeType} · {formatBytes(r.sizeBytes)}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {r.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {fileActionsMenu(r, true)}
                      </TableCell>
                    </TableRow>
                  ))}
                {!isSearching &&
                  folders.data?.map((f) => (
                    <TableRow
                      key={f.id}
                      className="cursor-pointer"
                      onClick={() => openFolder(f.id)}
                    >
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" /> {f.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t('common:count.files', { count: f.fileCount })} · {t('common:count.folders', { count: f.subfolderCount })}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell" />
                      <TableCell className="text-right">
                        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                          {folderActionsMenu(f)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                {!isSearching &&
                  files.data?.map((file) => (
                  <TableRow key={file.id} className="cursor-pointer" onClick={() => previewFile.mutate(file.id)}>
                    <TableCell>
                      <FileNameCell name={file.name} previewUrl={file.previewUrl} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {file.mimeType} · {formatBytes(file.sizeBytes)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {file.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {fileActionsMenu(file)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {moveTarget ? (
        <MoveDialog
          open
          onOpenChange={(o) => {
            if (!o) setMoveTarget(null)
          }}
          itemName={moveTarget.name}
          isPending={moveFile.isPending || moveFolder.isPending}
          onConfirm={(targetFolderId) =>
            moveTarget.type === 'file'
              ? moveFile.mutate({ id: moveTarget.id, folderId: targetFolderId })
              : moveFolder.mutate({ id: moveTarget.id, parentId: targetFolderId })
          }
        />
      ) : null}
      <SaveShareDialog />
      {shareTarget ? (
        <AccessShareDialog
          open
          onOpenChange={(open) => !open && setShareTarget(null)}
          title={t('archive:share.title', { name: shareTarget.name })}
          description={t('archive:share.description')}
          ownerUserId={shareTarget.ownerUserId}
          shares={shares.data}
          isLoading={shares.isPending}
          isPending={setShare.isPending || removeShare.isPending}
          onSet={(userId, level) => setShare.mutate({ userId, level })}
          onRemove={(userId) => removeShare.mutate(userId)}
        />
      ) : null}
    </div>
  )
}
