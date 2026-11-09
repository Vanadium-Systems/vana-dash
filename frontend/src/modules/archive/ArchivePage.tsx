import { DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Download, FolderInput, FolderPlus, Info, MessageSquareShare, Palette, Pencil, Plus, Star, Trash2, Upload, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AccessShareDialog } from '@/shared/components/AccessShareDialog'
import { FileViewer, viewerButtonClass, type ViewerFile } from '@/shared/components/FileViewer'
import { useShareToMessages } from '@/shared/components/ShareToMessagesDialog'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/shared/components/ui/dropdown-menu'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Fab } from '@/shared/components/ui/fab'
import { SelectionBar } from '@/shared/components/ui/selection-bar'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useHotkeys } from '@/shared/hooks/use-hotkeys'
import { useMe } from '@/shared/hooks/use-me'
import { useSelection } from '@/shared/hooks/use-selection'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type {
  AccessLevel,
  AccessShare,
  ArchiveDetails,
  ArchiveDownloadUrl,
  ArchiveFilesPage,
  ArchiveFolder,
  ArchiveFolderPath,
  ArchiveRecentFile,
  ArchiveSearchHit,
  ArchiveSpaces,
  ArchiveStars,
} from '@/shared/lib/types'
import { formatBytes } from '@/shared/lib/utils'
import { PAGE_SIZES } from '@/shared/components/ui/table-pagination'
import { ArchiveGrid } from './ArchiveGrid'
import { ArchiveHeader, crumbDropId, type ArchiveView, type Crumb } from './ArchiveHeader'
import { ArchiveList } from './ArchiveList'
import { ArchiveToolbar, type SortMode, type ViewMode } from './ArchiveToolbar'
import { downloadItems, moveItems, renameItem, setStarred, trashItems } from './archive-actions'
import { ColorDialog } from './ColorDialog'
import { DetailsPeek } from './DetailsPeek'
import type { FilterValues } from './FilterChips'
import { isModifiedRange, isTypeFilter, modifiedAfterIso } from './filters'
import type { ItemActions } from './ItemMenu'
import { fileItem, folderItem, hitItem, starredFolderItem, type ArchiveItem } from './items'
import { carriesFiles, type ListEnv } from './list-env'
import { MoveDialog } from './MoveDialog'
import { NameDialog } from './NameDialog'
import { canShareFiles, shareFileNatively } from './native-share'
import { useRowActivation } from './row-activation'
import { SaveShareDialog } from './SaveShareDialog'
import { SpacesTable } from './SpacesTable'
import { TrashView } from './TrashView'
import { UploadPanel } from './UploadPanel'
import { enqueueUploads, useUploads } from './uploads'

const VIEW_MODE_KEY = 'archive-view-mode'
const VIEWS: ArchiveView[] = ['own', 'shared', 'all', 'recent', 'starred', 'trash']

function parseView(value: string | null): ArchiveView {
  return VIEWS.includes(value as ArchiveView) && value !== 'own' ? (value as ArchiveView) : 'own'
}

const matchesFinePointer = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false

// A press on a control inside a row (its name button, a menu item) already does its own thing on
// Enter or Space; the page-wide shortcut must not open the focused row a second time.
const fromControl = (e: KeyboardEvent) => e.target instanceof HTMLElement && Boolean(e.target.closest('button, a, input, select, [role="menuitem"]'))

interface ShareTarget {
  id: string
  name: string
  ownerUserId: string
}

type NameTarget = { type: 'new-folder' } | { type: 'rename'; item: ArchiveItem }

// Navigation is the URL: `folder`, `view`, `q` and the filter chips, `page`, `file` (the open
// preview), `details` (the side panel). `folder` lives there and not in state so Back goes up one
// folder instead of leaving the page (bug seen 2026-09-03), and the path is rebuilt from
// `/folders/:id/path` on a direct load, where no trail of earlier clicks exists.
export function ArchivePage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { session, can } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const { canShare: canShareToMessages, share: shareToMessages, dialog: shareDialog } = useShareToMessages()

  const currentFolderId = searchParams.get('folder')
  const view = parseView(searchParams.get('view'))
  const fileParam = searchParams.get('file') ?? ''
  const detailsParam = searchParams.get('details') ?? ''
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const requestedSize = Number.parseInt(searchParams.get('size') ?? '', 10)
  const pageSize = (PAGE_SIZES as readonly number[]).includes(requestedSize) ? requestedSize : 50

  const [q, setQ] = useUrlState('q')
  const [typeParam, setTypeParam] = useUrlState('type')
  const [modifiedParam, setModifiedParam] = useUrlState('modified')
  const [tagParam, setTagParam] = useUrlState('tag')
  const [sortParam, setSortParam] = useUrlState('sort', 'recent')
  const sort: SortMode = sortParam === 'oldest' || sortParam === 'name' ? sortParam : 'recent'
  const filters: FilterValues = {
    type: isTypeFilter(typeParam) ? typeParam : null,
    modified: isModifiedRange(modifiedParam) ? modifiedParam : null,
    tag: tagParam || null,
  }
  const hasFilters = filters.type !== null || filters.modified !== null || filters.tag !== null

  // The URL gets the search text 300ms after the last key, or every letter would refetch and swap
  // the table for a skeleton.
  const [searchDraft, setSearchDraft] = useState(q)
  const debouncedDraft = useDebounced(searchDraft, 300)
  useEffect(() => {
    if (debouncedDraft !== q) setQ(debouncedDraft)
    // `q` is left out on purpose: a change that came from the URL must not be overwritten by the older draft.
  }, [debouncedDraft])
  const searching = view !== 'recent' && view !== 'starred' && view !== 'trash' && q.trim().length > 0
  const searchRef = useRef<HTMLInputElement>(null)

  const [viewMode, setViewModeState] = useState<ViewMode>(() => (localStorage.getItem(VIEW_MODE_KEY) === 'grid' ? 'grid' : 'list'))
  function setViewMode(mode: ViewMode) {
    setViewModeState(mode)
    localStorage.setItem(VIEW_MODE_KEY, mode)
  }

  const canEdit = can('arhiva.editare')
  const browsing = view === 'own' || view === 'shared' || view === 'all'
  // The shared / all-spaces tabs list the spaces at their root; a folder opened from there lists like any other.
  const listingSpaces = (view === 'shared' || view === 'all') && !currentFolderId

  function setParam(key: string, value: string | null, options?: { replace?: boolean }) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: options?.replace },
    )
  }

  // Going elsewhere drops the search, the chips and the page; the sort stays.
  function navigateTo(folder: string | null, nextView: ArchiveView) {
    setSearchDraft('')
    setSearchParams((previous) => {
      const next = new URLSearchParams()
      const sortValue = previous.get('sort')
      if (sortValue) next.set('sort', sortValue)
      if (nextView !== 'own') next.set('view', nextView)
      if (folder) next.set('folder', folder)
      return next
    })
  }
  // A folder opened from Recent, Starred or the Trash is browsed in the person's own tab.
  const openFolder = (id: string | null) => navigateTo(id, view === 'recent' || view === 'starred' || view === 'trash' ? 'own' : view)

  const spaces = useQuery({
    queryKey: ['archive', 'spaces'],
    queryFn: () => api.get<ArchiveSpaces>('/api/archive/spaces'),
    staleTime: 60 * 1000,
  })
  const folderPath = useQuery({
    queryKey: ['archive', 'folder-path', currentFolderId],
    queryFn: () => api.get<ArchiveFolderPath>(`/api/archive/folders/${currentFolderId}/path`),
    enabled: currentFolderId !== null && browsing,
    placeholderData: keepPreviousData,
  })
  const pathData = currentFolderId && browsing ? folderPath.data : undefined
  const ownRoot = spaces.data?.own ?? null
  // The root of the person's own space is not in the path: "Arhivă" already stands for it.
  const pathEntries = (pathData?.path ?? []).filter((entry, i) => !(i === 0 && entry.id === ownRoot?.id))
  const currentLevel: AccessLevel = pathData?.level ?? 'edit'
  const canWriteHere = browsing && !listingSpaces && currentLevel === 'edit' && canEdit
  const uploadFolderId = currentFolderId ?? ownRoot?.id ?? null
  const currentName = pathEntries.at(-1)?.name ?? (view === 'shared' ? t('archive:spaces.sharedWithMe') : view === 'all' ? t('archive:spaces.all') : t('common:nav.archive'))

  const stars = useQuery({
    queryKey: ['archive', 'stars'],
    queryFn: () => api.get<ArchiveStars>('/api/archive/stars'),
    staleTime: 30 * 1000,
  })
  const starredIds = useMemo(() => new Set([...(stars.data?.files ?? []).map((file) => file.id), ...(stars.data?.folders ?? []).map((folder) => folder.id)]), [stars.data])

  const showFolders = browsing && !listingSpaces && !searching && !hasFilters
  const folders = useQuery({
    queryKey: ['archive', 'folders', currentFolderId, sort],
    queryFn: () => {
      const params = new URLSearchParams({ sort })
      if (currentFolderId) params.set('parentId', currentFolderId)
      return api.get<ArchiveFolder[]>(`/api/archive/folders?${params.toString()}`)
    },
    enabled: showFolders,
    placeholderData: keepPreviousData,
  })
  const files = useQuery({
    queryKey: ['archive', 'files', currentFolderId, page, pageSize, sort, filters.type, filters.modified, filters.tag],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort })
      if (currentFolderId) params.set('folderId', currentFolderId)
      if (filters.type) params.set('type', filters.type)
      if (filters.modified) params.set('modifiedAfter', modifiedAfterIso(filters.modified))
      if (filters.tag) params.set('tags', filters.tag)
      return api.get<ArchiveFilesPage>(`/api/archive/files?${params.toString()}`)
    },
    enabled: browsing && !listingSpaces && !searching,
    placeholderData: keepPreviousData,
  })
  // The search covers the whole Archive, not the open folder, and returns folders as well.
  const search = useQuery({
    queryKey: ['archive', 'search', q.trim(), filters.type, filters.modified, filters.tag],
    queryFn: () => {
      const params = new URLSearchParams({ q: q.trim() })
      if (filters.type) params.set('type', filters.type)
      if (filters.modified) params.set('modifiedAfter', modifiedAfterIso(filters.modified))
      if (filters.tag) params.set('tags', filters.tag)
      return api.get<ArchiveSearchHit[]>(`/api/archive/search?${params.toString()}`)
    },
    enabled: searching,
    placeholderData: keepPreviousData,
  })
  const recent = useQuery({
    queryKey: ['archive', 'recent'],
    queryFn: () => api.get<ArchiveRecentFile[]>('/api/archive/recent'),
    enabled: view === 'recent',
  })

  const invalidate = useCallback(() => void queryClient.invalidateQueries({ queryKey: ['archive'] }), [queryClient])

  const items = useMemo<ArchiveItem[]>(() => {
    let list: ArchiveItem[] = []
    if (view === 'recent') {
      list = (recent.data ?? []).map((file) => fileItem(file, { starred: starredIds.has(file.id), canWrite: canEdit && file.level === 'edit', location: file.folderPath }))
    } else if (view === 'starred') {
      list = [
        ...(stars.data?.folders ?? []).map((folder) => starredFolderItem(folder, canEdit && folder.level === 'edit')),
        ...(stars.data?.files ?? []).map((file) => fileItem(file, { starred: true, canWrite: canEdit && file.level === 'edit' })),
      ]
    } else if (searching) {
      list = (search.data ?? []).map((hit) => hitItem(hit, { starredIds, canWrite: canEdit && hit.level === 'edit' }))
    } else if (browsing && !listingSpaces) {
      const here = currentLevel === 'edit'
      list = [
        ...(page === 1 && showFolders ? (folders.data ?? []).map(folderItem) : []),
        ...(files.data?.items ?? []).map((file) => fileItem(file, { starred: starredIds.has(file.id), canWrite: here })),
      ]
    }
    // The feature gate applies on top of the folder level, wherever the row came from.
    return list.map((item) => (item.canWrite && !canEdit ? { ...item, canWrite: false } : item))
  }, [view, recent.data, stars.data, search.data, folders.data, files.data, starredIds, searching, browsing, listingSpaces, showFolders, page, currentLevel, canEdit])

  const itemIds = useMemo(() => items.map((item) => item.id), [items])
  const selection = useSelection(itemIds)
  const selectedItems = useMemo(() => items.filter((item) => selection.selected.has(item.id)), [items, selection.selected])
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.sizeBytes, 0)
  const targetsFor = (item: ArchiveItem) => (selection.selected.has(item.id) && selectedItems.length > 1 ? selectedItems : [item])

  const [focusId, setFocusId] = useState<string | null>(null)
  const focused = items.find((item) => item.id === focusId) ?? null

  // Tags offered by the "Etichetă" chip: the ones on the files in view.
  const tagOptions = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort(), [items])

  // After the last file of a page is deleted the page is gone: step back to the last one.
  useEffect(() => {
    const data = files.data
    if (!data || data.items.length > 0 || data.total === 0 || page === 1) return
    setParam('page', String(Math.ceil(data.total / pageSize)), { replace: true })
  })

  // --- dialogs ---
  const [nameTarget, setNameTarget] = useState<NameTarget | null>(null)
  const [moveTargets, setMoveTargets] = useState<ArchiveItem[] | null>(null)
  const [colorTarget, setColorTarget] = useState<ArchiveItem | null>(null)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const dialogOpen = nameTarget !== null || moveTargets !== null || colorTarget !== null || shareTarget !== null

  const shares = useQuery({
    queryKey: ['archive', 'shares', shareTarget?.id],
    queryFn: () => api.get<AccessShare[]>(`/api/archive/folders/${shareTarget!.id}/shares`),
    enabled: shareTarget !== null,
  })
  const setShare = useMutation({
    mutationFn: ({ userId, level }: { userId: string; level: AccessLevel }) => api.post<AccessShare[]>(`/api/archive/folders/${shareTarget!.id}/shares`, { userId, level }),
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

  async function guarded(work: () => Promise<unknown>) {
    setBusy(true)
    try {
      await work()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common:states.changeNotSaved'))
    } finally {
      setBusy(false)
    }
  }

  function openFile(id: string) {
    const next = new URLSearchParams(searchParams)
    next.set('file', id)
    // Marked so that closing the preview can step Back instead of stacking another entry.
    navigate({ search: next.toString() }, { state: { viewer: true } })
  }
  function closeViewer() {
    if ((location.state as { viewer?: boolean } | null)?.viewer) navigate(-1)
    else setParam('file', null, { replace: true })
  }

  const actions: ItemActions = {
    open: (item) => (item.kind === 'folder' ? openFolder(item.id) : openFile(item.id)),
    download: (targets) => void downloadItems(targets).catch((err: Error) => toast.error(err.message)),
    rename: (item) => setNameTarget({ type: 'rename', item }),
    move: (targets) => setMoveTargets(targets),
    toggleStar: (targets) => {
      const add = !targets.every((item) => item.starred)
      void setStarred(targets, add).then(
        () => {
          invalidate()
          toast.success(add ? t('archive:toasts.starred', { count: targets.length }) : t('archive:toasts.unstarred', { count: targets.length }))
        },
        (err: Error) => toast.error(err.message),
      )
    },
    trash: (targets) =>
      void trashItems(targets, invalidate).then((ok) => {
        if (!ok) return
        selection.clear()
        if (fileParam && targets.some((item) => item.id === fileParam)) closeViewer()
      }),
    details: (item) => setParam('details', item.id),
    share: (item) => setShareTarget({ id: item.id, name: item.name, ownerUserId: item.ownerUserId ?? '' }),
    sendToMessages: (item) => shareToMessages({ type: 'archive_file', id: item.id, title: item.name }),
    sendNative: (item) =>
      void shareFileNatively(item.id, item.name).catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return // closed from the system sheet
        toast.error(err instanceof Error ? err.message : t('common:errors.unknown'))
      }),
    toggleMonthly: (item) =>
      void guarded(async () => {
        const enable = !item.autoMonthlySubfolders
        await api.patch(`/api/archive/folders/${item.id}`, { autoMonthlySubfolders: enable })
        invalidate()
        toast.success(enable ? t('archive:toasts.monthlyOn') : t('archive:toasts.monthlyOff'))
      }),
    pickColor: (item) => setColorTarget(item),
    showLocation: (item) => navigateTo(item.location?.at(-1)?.id ?? null, 'own'),
    canSendToMessages: canShareToMessages,
    canSendNative: canShareFiles,
  }

  const activation = useRowActivation<ArchiveItem>(selection, actions.open)

  // --- uploads ---
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const uploads = useUploads()
  const finishedUploads = uploads.filter((upload) => upload.status === 'done').length
  useEffect(() => {
    if (finishedUploads > 0) invalidate()
  }, [finishedUploads, invalidate])

  function uploadFiles(list: File[], folderId: string | null, folderName: string) {
    if (list.length > 0) enqueueUploads(list, { folderId, folderName })
  }
  const pickFiles = () => fileInputRef.current?.click()
  const newFolder = () => setNameTarget({ type: 'new-folder' })

  // --- files dragged in from the desktop ---
  // dragenter/dragleave also fire for every child, so entries and exits are counted, not the last event.
  const dragDepth = useRef(0)
  const [osDragOver, setOsDragOver] = useState(false)
  const [osDropFolderId, setOsDropFolderId] = useState<string | null>(null)
  const osDropFolder = items.find((item) => item.id === osDropFolderId) ?? null
  const endOsDrag = () => {
    dragDepth.current = 0
    setOsDragOver(false)
    setOsDropFolderId(null)
  }
  const fileDrop = canWriteHere ? { over: setOsDropFolderId, drop: (list: File[], folderId: string) => { uploadFiles(list, folderId, items.find((item) => item.id === folderId)?.name ?? ''); endOsDrag() } } : null

  // --- dragging rows onto a folder or a segment of the path ---
  const [dragged, setDragged] = useState<ArchiveItem[] | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const suppressClick = useRef(false)

  const showSpacesTabs = Boolean(spaces.data && (spaces.data.shared.length > 0 || spaces.data.spaces))
  const tabs: { value: ArchiveView; label: string }[] = [
    { value: 'own', label: t('archive:spaces.mine') },
    ...(showSpacesTabs ? [{ value: 'shared' as const, label: t('archive:spaces.sharedWithMe') }] : []),
    ...(spaces.data?.spaces ? [{ value: 'all' as const, label: t('archive:spaces.all') }] : []),
    { value: 'recent', label: t('archive:tabs.recent') },
    { value: 'starred', label: t('archive:tabs.starred') },
    ...(canEdit ? [{ value: 'trash' as const, label: t('archive:tabs.trash') }] : []),
  ]

  const trail: Crumb[] = !browsing
    ? [{ id: null, name: tabs.find((tab) => tab.value === view)?.label ?? '' }]
    : [{ id: null, name: view === 'shared' ? t('archive:spaces.sharedWithMe') : view === 'all' ? t('archive:spaces.all') : t('common:nav.archive'), dropFolderId: view === 'own' ? (ownRoot?.id ?? undefined) : undefined }, ...pathEntries.map((entry) => ({ id: entry.id, name: entry.name, dropFolderId: entry.id }))]

  function dropTarget(id: string | null): { id: string; name: string } | null {
    if (!id) return null
    const crumb = trail.find((candidate) => crumbDropId(candidate) === id)
    if (crumb?.dropFolderId) return { id: crumb.dropFolderId, name: crumb.name }
    const folder = items.find((item) => item.kind === 'folder' && item.id === id && item.canWrite)
    return folder ? { id: folder.id, name: folder.name } : null
  }

  function onDragStart(event: DragStartEvent) {
    const item = items.find((candidate) => candidate.id === event.active.id)
    if (item) setDragged(targetsFor(item))
  }
  function onDragEnd(event: DragEndEvent) {
    const moving = dragged
    setDragged(null)
    setOverId(null)
    // The mouse-up after a drag is also a click on the row it ends over.
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 0)
    const target = dropTarget(event.over ? String(event.over.id) : null)
    const movable = moving?.filter((item) => item.id !== target?.id)
    if (!target || !movable?.length || target.id === currentFolderId) return
    void moveItems(movable, target, invalidate).then(() => selection.clear())
  }
  const overTarget = dropTarget(overId)

  // --- the preview ---
  const fileItems = useMemo(() => items.filter((item) => item.kind === 'file'), [items])
  const listedIndex = fileParam ? fileItems.findIndex((item) => item.id === fileParam) : -1
  const linked = useQuery({
    queryKey: ['archive', 'details', fileParam],
    queryFn: () => api.get<ArchiveDetails>(`/api/archive/files/${fileParam}/details`),
    enabled: fileParam !== '' && listedIndex === -1,
    retry: false,
  })
  // A link from Messages names no folder: land in the one the file is in.
  useEffect(() => {
    const folderId = linked.data?.folderId
    if (folderId && folderId !== currentFolderId && browsing && !searching) setParam('folder', folderId, { replace: true })
  }, [linked.data?.folderId])
  useEffect(() => {
    if (!linked.isError) return
    toast.error(t('archive:viewer.gone'))
    setParam('file', null, { replace: true })
  }, [linked.isError])

  const viewerList: { id: string; name: string; mimeType: string }[] =
    listedIndex >= 0
      ? fileItems
      : linked.data?.mimeType
        ? [{ id: linked.data.id, name: linked.data.name, mimeType: linked.data.mimeType }]
        : []
  const viewerIndex = listedIndex >= 0 ? listedIndex : 0
  // The presigned URL of the open file and its neighbours: ← → shows the next at once.
  const neighbourIds = [viewerIndex - 1, viewerIndex, viewerIndex + 1].map((i) => viewerList[i]?.id).filter((id): id is string => Boolean(id))
  const urlQueries = useQueries({
    queries: neighbourIds.map((id) => ({
      queryKey: ['archive', 'download-url', id],
      queryFn: () => api.get<ArchiveDownloadUrl>(`/api/archive/files/${id}/download-url`),
      staleTime: 10 * 60 * 1000,
      enabled: fileParam !== '',
    })),
  })
  const urlById = new Map(neighbourIds.map((id, i) => [id, urlQueries[i]?.data?.url ?? '']))
  const viewerFiles: ViewerFile[] = viewerList.map((file) => {
    const url = urlById.get(file.id) ?? ''
    // Until the URL arrives the viewer shows a plain file card, not a broken image.
    return { id: file.id, name: file.name, url, mimeType: url ? file.mimeType : 'application/octet-stream' }
  })
  const viewerCurrent = viewerList[viewerIndex]
  const viewerOpen = fileParam !== '' && viewerFiles.length > 0

  // --- shortcuts ---
  const moveFocus = (step: number) => {
    if (items.length === 0) return
    const index = focused ? items.indexOf(focused) : -1
    const next = items[Math.min(items.length - 1, Math.max(0, index + step))]
    if (!next) return
    setFocusId(next.id)
    document.querySelector(`[data-row-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const targetsNow = (): ArchiveItem[] => (selection.count > 0 ? selectedItems : focused ? [focused] : [])
  const onFocused = (run: (item: ArchiveItem) => void) => () => focused && run(focused)

  useHotkeys(
    [
      { keys: 'arrowdown', label: t('archive:shortcuts.next'), onKey: (e) => { e.preventDefault(); moveFocus(1) } },
      { keys: 'arrowup', label: t('archive:shortcuts.previous'), onKey: (e) => { e.preventDefault(); moveFocus(-1) } },
      { keys: 'enter', label: t('archive:shortcuts.open'), onKey: (e) => { if (!fromControl(e) && focused) actions.open(focused) } },
      { keys: 'space', label: t('archive:shortcuts.preview'), onKey: (e) => { if (fromControl(e) || focused?.kind !== 'file') return; e.preventDefault(); openFile(focused.id) } },
      { keys: 'f2', label: t('common:actions.rename'), onKey: onFocused((item) => item.canWrite && actions.rename(item)) },
      { keys: 'm', label: t('common:actions.move'), onKey: () => { const targets = targetsNow(); if (targets.length && targets.every((item) => item.canWrite)) actions.move(targets) } },
      { keys: 's', label: t('archive:menu.star'), onKey: () => { const targets = targetsNow(); if (targets.length) actions.toggleStar(targets) } },
      { keys: 'i', label: t('archive:menu.details'), onKey: onFocused(actions.details) },
      { keys: 'delete', label: t('common:actions.delete'), onKey: () => { const targets = targetsNow(); if (targets.length && targets.every((item) => item.canWrite)) actions.trash(targets) } },
      { keys: 'mod+a', label: t('common:selection.all'), onKey: (e) => { e.preventDefault(); selection.selectAll() } },
      { keys: '/', label: t('archive:shortcuts.search'), onKey: (e) => { e.preventDefault(); searchRef.current?.focus() } },
      { keys: 'u', label: t('archive:actions.upload'), onKey: () => canWriteHere && pickFiles() },
      { keys: 'shift+n', label: t('archive:folders.new'), onKey: () => canWriteHere && newFolder() },
    ],
    { enabled: view !== 'trash' && !listingSpaces && !viewerOpen && !dialogOpen },
  )

  const env: ListEnv = {
    actions,
    selectedIds: selection.selected,
    focusId,
    query: searching ? q : '',
    targetsFor,
    onActivate: (e, item) => {
      if (suppressClick.current) return
      setFocusId(item.id)
      activation.onActivate(e, item)
    },
    onToggle: selection.toggle,
    longPress: { start: activation.startLongPress, cancel: activation.cancelLongPress },
    draggable: matchesFinePointer(),
    osDropFolderId,
    fileDrop,
  }

  const currentFolderItem: ArchiveItem | null =
    browsing && !listingSpaces
      ? {
          kind: 'folder',
          id: currentFolderId ?? ownRoot?.id ?? '',
          name: currentName,
          mimeType: '',
          sizeBytes: 0,
          updatedAt: null,
          previewUrl: null,
          tags: [],
          color: null,
          starred: false,
          fileCount: 0,
          subfolderCount: 0,
          canWrite: canWriteHere,
          canShare: currentFolderId ? Boolean(pathData?.canShare) : Boolean(ownRoot),
          ownerUserId: currentFolderId ? (pathData?.ownerUserId ?? null) : (session?.user.id ?? null),
          autoMonthlySubfolders: false,
          location: null,
        }
      : null

  const folderMenu =
    currentFolderItem && currentFolderItem.id ? (
      <>
        {canWriteHere ? (
          <>
            <DropdownMenuItem onClick={newFolder}>
              <FolderPlus className="h-4 w-4" /> {t('archive:folders.new')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={pickFiles}>
              <Upload className="h-4 w-4" /> {t('archive:actions.upload')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {canWriteHere && currentFolderId ? (
          <>
            <DropdownMenuItem onClick={() => actions.rename(currentFolderItem)}>
              <Pencil className="h-4 w-4" /> {t('common:actions.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.pickColor(currentFolderItem)}>
              <Palette className="h-4 w-4" /> {t('archive:menu.color')}
            </DropdownMenuItem>
          </>
        ) : null}
        {currentFolderItem.canShare ? (
          <DropdownMenuItem onClick={() => actions.share(currentFolderItem)}>
            <Users className="h-4 w-4" /> {t('common:actions.share')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => actions.details(currentFolderItem)}>
          <Info className="h-4 w-4" /> {t('archive:menu.details')}
        </DropdownMenuItem>
      </>
    ) : null

  const pathOwner = pathData && session && pathData.ownerUserId !== session.user.id ? pathData : null
  const ownerNote = pathOwner ? `${t('archive:spaces.belongsTo')} ${pathOwner.ownerName}${pathOwner.level === 'view' ? t('archive:spaces.readOnly') : ''}` : null

  const spaceEntries = (view === 'shared' ? spaces.data?.shared : spaces.data?.spaces) ?? []
  const loading = listingSpaces
    ? spaces.isPending
    : view === 'recent'
      ? recent.isPending
      : view === 'starred'
        ? stars.isPending
        : searching
          ? search.isPending
          : files.isPending || (showFolders && folders.isPending)
  const failed = view === 'recent' ? recent.isError : view === 'starred' ? stars.isError : searching ? search.isError : files.isError
  const pagination =
    browsing && !listingSpaces && !searching && files.data
      ? {
          page,
          pageSize,
          total: files.data.total,
          onPage: (next: number) => setParam('page', next > 1 ? String(next) : null),
          onPageSize: (next: number) => setSearchParams((previous) => { const params = new URLSearchParams(previous); params.delete('page'); if (next === 50) params.delete('size'); else params.set('size', String(next)); return params }),
        }
      : undefined

  function resetFilters() {
    setSearchDraft('')
    setQ('')
    setTypeParam('')
    setModifiedParam('')
    setTagParam('')
  }
  function changeFilters(next: Partial<FilterValues>) {
    if ('type' in next) setTypeParam(next.type ?? '')
    if ('modified' in next) setModifiedParam(next.modified ?? '')
    if ('tag' in next) setTagParam(next.tag ?? '')
    setParam('page', null, { replace: true })
  }

  const selectionActions = (
    <>
      <span className="tnum whitespace-nowrap text-sm text-muted-foreground">{selectedBytes > 0 ? formatBytes(selectedBytes) : null}</span>
      <Button variant="ghost" size="sm" onClick={() => actions.download(selectedItems)}>
        <Download className="h-4 w-4" /> {t('common:actions.download')}
      </Button>
      {selectedItems.every((item) => item.canWrite) ? (
        <Button variant="ghost" size="sm" onClick={() => actions.move(selectedItems)}>
          <FolderInput className="h-4 w-4" /> {t('common:actions.move')}
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => actions.toggleStar(selectedItems)}>
        <Star className="h-4 w-4" /> {t('archive:menu.star')}
      </Button>
      {selectedItems.length === 1 && selectedItems[0]?.kind === 'file' && canShareToMessages ? (
        <Button variant="ghost" size="sm" onClick={() => actions.sendToMessages(selectedItems[0]!)}>
          <MessageSquareShare className="h-4 w-4" /> {t('messages:share.action')}
        </Button>
      ) : null}
      {selectedItems.every((item) => item.canWrite) ? (
        <Button variant="ghost" size="sm" onClick={() => actions.trash(selectedItems)}>
          <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
        </Button>
      ) : null}
    </>
  )
  const selectionBarProps = { count: selection.count, allSelected: selection.allSelected, onSelectAll: selection.selectAll, onClear: selection.clear, total: pagination?.total }

  function body() {
    if (view === 'trash') return <TrashView onOpenFolder={openFolder} />
    if (listingSpaces) {
      if (spaces.isPending) return <ListSkeleton rows={4} />
      return spaceEntries.length ? (
        <SpacesTable entries={spaceEntries} onOpen={openFolder} />
      ) : (
        <EmptyState
          kind="new"
          title={view === 'shared' ? t('archive:empty.nothingShared') : t('archive:empty.noSpace')}
          description={view === 'shared' ? t('archive:empty.sharedHint') : undefined}
        />
      )
    }
    if (loading) return <ListSkeleton rows={6} />
    if (failed) return <EmptyState kind="new" title={t('common:states.loadFailed')} />
    if (items.length === 0) {
      if (view === 'recent') return <EmptyState kind="new" title={t('archive:empty.recentTitle')} description={t('archive:empty.recentHint')} />
      if (view === 'starred') return <EmptyState kind="new" title={t('archive:empty.starredTitle')} description={t('archive:empty.starredHint')} />
      if (searching || hasFilters) return <EmptyState kind="filtered" title={t('archive:empty.noFileFound')} onReset={resetFilters} />
      return (
        <EmptyState
          kind="new"
          title={currentFolderId ? t('archive:empty.folderTitle') : t('archive:empty.spaceEmpty')}
          description={canWriteHere ? t('archive:empty.folderHint') : t('archive:empty.folder')}
          action={
            canWriteHere ? (
              <Button onClick={pickFiles}>
                <Upload className="h-4 w-4" /> {t('archive:actions.upload')}
              </Button>
            ) : undefined
          }
        />
      )
    }
    return viewMode === 'grid' ? <ArchiveGrid items={items} env={env} pagination={pagination} /> : <ArchiveList items={items} env={env} pagination={pagination} />
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragOver={(event) => setOverId(event.over ? String(event.over.id) : null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragged(null)
        setOverId(null)
      }}
    >
      <div className="space-y-4">
        <ArchiveHeader
          tabs={tabs}
          view={view}
          onView={(next) => navigateTo(null, next)}
          trail={trail}
          onNavigate={openFolder}
          folderMenu={folderMenu}
          ownerNote={ownerNote}
          actions={
            canWriteHere ? (
              <div className="hidden items-center gap-2 md:flex">
                <Button variant="outline" onClick={newFolder}>
                  <FolderPlus className="h-4 w-4" /> {t('archive:folders.new')}
                </Button>
                <Button onClick={pickFiles}>
                  <Upload className="h-4 w-4" /> {t('archive:actions.upload')}
                </Button>
              </div>
            ) : null
          }
        />

        {browsing && !listingSpaces ? (
          <>
            {selection.count > 0 ? (
              <div className="hidden md:block">
                <SelectionBar placement="toolbar" {...selectionBarProps}>
                  {selectionActions}
                </SelectionBar>
              </div>
            ) : null}
            <div className={selection.count > 0 ? 'md:hidden' : undefined}>
              <ArchiveToolbar
                searchRef={searchRef}
                search={searchDraft}
                onSearch={setSearchDraft}
                filters={filters}
                tagOptions={tagOptions}
                onFilters={changeFilters}
                sort={sort}
                onSort={(next) => {
                  setSortParam(next)
                  setParam('page', null, { replace: true })
                }}
                showSort={!searching}
                viewMode={viewMode}
                onViewMode={setViewMode}
              />
            </div>
          </>
        ) : selection.count > 0 ? (
          <SelectionBar placement="toolbar" {...selectionBarProps}>
            {selectionActions}
          </SelectionBar>
        ) : null}

        <Card
          className="relative"
          onDragEnter={(e: DragEvent) => {
            if (!canWriteHere || !carriesFiles(e)) return
            e.preventDefault()
            dragDepth.current += 1
            setOsDragOver(true)
          }}
          onDragLeave={(e: DragEvent) => {
            if (!carriesFiles(e)) return
            dragDepth.current -= 1
            if (dragDepth.current <= 0) endOsDrag()
          }}
          onDragOver={(e: DragEvent) => {
            if (!carriesFiles(e)) return
            e.preventDefault()
            setOsDropFolderId(null)
          }}
          onDrop={(e: DragEvent) => {
            if (!carriesFiles(e)) return
            e.preventDefault()
            const dropped = Array.from(e.dataTransfer.files)
            endOsDrag()
            if (canWriteHere) uploadFiles(dropped, uploadFolderId, currentName)
          }}
        >
          {osDragOver ? (
            <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/5">
              <p className="glass flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium">
                <Upload className="h-4 w-4" /> {t('archive:upload.dropTo', { folder: osDropFolder?.name ?? currentName })}
              </p>
            </div>
          ) : null}
          <CardContent className="px-2 pt-4 sm:px-4">{body()}</CardContent>
        </Card>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            uploadFiles(Array.from(e.target.files ?? []), uploadFolderId, currentName)
            e.target.value = ''
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            uploadFiles(Array.from(e.target.files ?? []), uploadFolderId, currentName)
            e.target.value = ''
          }}
        />

        {canWriteHere && selection.count === 0 ? (
          <Fab
            icon={<Plus className="h-6 w-6" />}
            label={t('archive:fab.label')}
            actions={[
              { key: 'folder', icon: <FolderPlus className="h-4 w-4" />, label: t('archive:folders.new'), onClick: newFolder },
              { key: 'upload', icon: <Upload className="h-4 w-4" />, label: t('archive:actions.upload'), onClick: pickFiles },
              { key: 'camera', icon: <Camera className="h-4 w-4" />, label: t('archive:fab.camera'), onClick: () => cameraInputRef.current?.click() },
            ]}
          />
        ) : null}

        <div className="md:hidden">
          <SelectionBar {...selectionBarProps}>{selectionActions}</SelectionBar>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="glass rounded-full border px-3 py-1.5 text-sm shadow-lg">
            {overTarget ? t('archive:drag.moveTo', { folder: overTarget.name }) : dragged.length === 1 ? dragged[0]!.name : t('archive:selection.count', { count: dragged.length })}
          </div>
        ) : null}
      </DragOverlay>

      {viewerOpen ? (
        <FileViewer
          files={viewerFiles}
          index={viewerIndex}
          onIndexChange={(index) => setParam('file', viewerFiles[index]?.id ?? null, { replace: true })}
          onClose={closeViewer}
          onDownload={(file) => void api.download(`/api/archive/files/${file.id}/download`, file.name).catch((err: Error) => toast.error(err.message))}
          toolbar={
            viewerCurrent ? (
              <>
                <button
                  type="button"
                  className={viewerButtonClass}
                  aria-label={starredIds.has(viewerCurrent.id) ? t('archive:menu.unstar') : t('archive:menu.star')}
                  onClick={() => {
                    const add = !starredIds.has(viewerCurrent.id)
                    void setStarred([{ kind: 'file', id: viewerCurrent.id }], add).then(invalidate, (err: Error) => toast.error(err.message))
                  }}
                >
                  <Star className={starredIds.has(viewerCurrent.id) ? 'h-5 w-5 fill-warning text-warning' : 'h-5 w-5'} />
                </button>
                <button type="button" className={viewerButtonClass} aria-label={t('archive:menu.details')} onClick={() => setParam('details', viewerCurrent.id)}>
                  <Info className="h-5 w-5" />
                </button>
                {canShareToMessages ? (
                  <button
                    type="button"
                    className={viewerButtonClass}
                    aria-label={t('messages:share.action')}
                    onClick={() => {
                      // The share dialog sits under the viewer, so the viewer steps aside first.
                      closeViewer()
                      shareToMessages({ type: 'archive_file', id: viewerCurrent.id, title: viewerCurrent.name })
                    }}
                  >
                    <MessageSquareShare className="h-5 w-5" />
                  </button>
                ) : null}
              </>
            ) : null
          }
        />
      ) : null}

      <DetailsPeek
        id={detailsParam || null}
        item={items.find((item) => item.id === detailsParam) ?? null}
        actions={actions}
        raised={viewerOpen}
        onClose={() => setParam('details', null, { replace: true })}
        onOpenFolder={openFolder}
      />

      <UploadPanel />

      {moveTargets ? (
        <MoveDialog
          open
          onOpenChange={(open) => !open && setMoveTargets(null)}
          itemName={moveTargets.length === 1 ? moveTargets[0]!.name : t('archive:selection.count', { count: moveTargets.length })}
          isPending={busy}
          onConfirm={(target) => {
            const targetId = target.id ?? ownRoot?.id
            if (!targetId) return toast.error(t('archive:move.noSpace'))
            void guarded(async () => {
              await moveItems(moveTargets, { id: targetId, name: target.name }, invalidate)
              setMoveTargets(null)
              selection.clear()
            })
          }}
        />
      ) : null}
      {nameTarget ? (
        <NameDialog
          title={nameTarget.type === 'new-folder' ? t('archive:nameDialog.newFolderTitle') : t('archive:nameDialog.renameTitle', { name: nameTarget.item.name })}
          initialName={nameTarget.type === 'new-folder' ? '' : nameTarget.item.name}
          submitLabel={nameTarget.type === 'new-folder' ? t('common:actions.create') : t('common:actions.rename')}
          isPending={busy}
          onClose={() => setNameTarget(null)}
          onSubmit={(name) =>
            void guarded(async () => {
              if (nameTarget.type === 'new-folder') {
                const folder = await api.post<ArchiveFolder>('/api/archive/folders', { name, parentId: currentFolderId ?? undefined })
                invalidate()
                toast.success(t('archive:toasts.folderCreated'), { action: { label: t('common:actions.view'), onClick: () => openFolder(folder.id) } })
              } else {
                await renameItem(nameTarget.item, name, invalidate)
              }
              setNameTarget(null)
            })
          }
        />
      ) : null}
      {colorTarget ? (
        <ColorDialog
          name={colorTarget.name}
          value={colorTarget.color}
          onClose={() => setColorTarget(null)}
          onPick={(color) => void guarded(async () => { await api.patch(`/api/archive/folders/${colorTarget.id}`, { color }); invalidate() })}
        />
      ) : null}
      <SaveShareDialog />
      {shareDialog}
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
    </DndContext>
  )
}
