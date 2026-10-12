import { Bell, Calendar, FileText, FolderOpen, Link2, Mail, Server, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// Maparea tipurilor de entități citate de asistent ([[type:id|etichetă]], Contract A) pe
// rutele existente ale dashboard-ului — deep-link cu parametrii de deschidere a detaliului.
const REF_ROUTES: Record<string, (id: string) => string> = {
  invoice: (id) => `/accounting?invoice=${encodeURIComponent(id)}`,
  email: (id) => `/email?thread=${encodeURIComponent(id)}`,
  archive: (id) => `/archive?folder=${encodeURIComponent(id)}`,
  alert: (id) => `/alerts?rule=${encodeURIComponent(id)}`,
  client: (id) => `/accounting?client=${encodeURIComponent(id)}`,
  platform: (id) => `/platforms?id=${encodeURIComponent(id)}`,
  reminder: () => '/calendar',
}

const REF_ICONS: Record<string, LucideIcon> = {
  invoice: FileText,
  email: Mail,
  archive: FolderOpen,
  alert: Bell,
  client: User,
  platform: Server,
  reminder: Calendar,
}

export function EntityChip({ type, id, label }: { type: string; id: string; label: string }) {
  const navigate = useNavigate()
  // page:[[page:/ruta|Etichetă]] — id-ul e chiar ruta destinație
  const to = type === 'page' ? id : REF_ROUTES[type]?.(id)
  if (!to) return null

  const Icon = REF_ICONS[type] ?? Link2
  return (
    <button
      type="button"
      data-testid="assistant-entity-ref"
      onClick={(e) => {
        e.preventDefault()
        void navigate(to)
      }}
      className="mx-0.5 inline-flex max-w-64 items-center gap-1 rounded-md border bg-card px-1.5 py-0 align-baseline font-normal text-xs transition-colors hover:bg-accent"
      title={to}
    >
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  )
}
