import { Check, ChevronDown, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/lib/i18n'
import { cn, formatBytes } from '@/shared/lib/utils'
import { cancelUpload, clearFinishedUploads, retryUpload, useUploads, type UploadFailure, type UploadItem } from './uploads'

function failureText(failure: UploadFailure): string {
  if (failure.reason === 'storageFull') {
    return t('archive:uploadPanel.storageFull', { used: formatBytes(failure.usedBytes), limit: formatBytes(failure.limitBytes) })
  }
  if (failure.reason === 'tooLarge') return t('archive:uploadPanel.tooLarge')
  return failure.message
}

function UploadRow({ item }: { item: UploadItem }) {
  const active = item.status === 'queued' || item.status === 'uploading'
  const fraction = item.size > 0 ? item.loaded / item.size : item.status === 'done' ? 1 : 0
  return (
    <li className="space-y-1 px-3 py-2 text-sm" data-upload-status={item.status}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate" title={item.name}>
          {item.name}
        </span>
        {item.status === 'done' ? <Check className="h-4 w-4 shrink-0 text-success-text" aria-label={t('archive:uploadPanel.done')} /> : null}
        {item.status === 'canceled' ? <span className="shrink-0 text-xs text-muted-foreground">{t('archive:uploadPanel.canceled')}</span> : null}
        {item.status === 'error' ? (
          <Button variant="ghost" size="sm" onClick={() => retryUpload(item.id)}>
            <RotateCcw className="h-3.5 w-3.5" /> {t('common:actions.tryAgainShort')}
          </Button>
        ) : null}
        {active ? (
          <Button variant="ghost" size="icon-sm" title={t('common:actions.cancel')} aria-label={t('common:actions.cancel')} onClick={() => cancelUpload(item.id)}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {active ? (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {/* scaleX, not width: the bar moves on the compositor. */}
            <div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${fraction})` }} />
          </div>
          <p className="tnum text-xs text-muted-foreground">
            {item.status === 'queued'
              ? t('archive:uploadPanel.waiting')
              : t('archive:uploadPanel.progress', { loaded: formatBytes(item.loaded), size: formatBytes(item.size), percent: Math.round(fraction * 100) })}
          </p>
        </>
      ) : null}
      {item.status === 'error' && item.failure ? <p className="text-xs text-destructive-text">{failureText(item.failure)}</p> : null}
    </li>
  )
}

// Bottom right on a desktop, the full width above the bottom bar on a phone. It stays until it is
// closed, so a failed file can still be retried after the others finished.
export function UploadPanel() {
  const items = useUploads()
  const [collapsed, setCollapsed] = useState(false)
  if (items.length === 0) return null

  const active = items.filter((item) => item.status === 'queued' || item.status === 'uploading').length
  const failed = items.filter((item) => item.status === 'error').length
  const title = active > 0 ? t('archive:uploadPanel.uploading', { count: active }) : failed > 0 ? t('archive:uploadPanel.failed', { count: failed }) : t('archive:uploadPanel.finished', { count: items.length })

  return (
    <section
      aria-label={t('archive:uploadPanel.label')}
      className="glass float-in fixed inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-40 overflow-hidden rounded-lg border shadow-lg md:inset-x-auto md:bottom-4 md:right-4 md:w-96"
    >
      <div className="flex items-center gap-1 border-b py-1 pl-3 pr-1">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" role="status">
          {title}
        </h2>
        <Button variant="ghost" size="icon-sm" title={collapsed ? t('archive:uploadPanel.expand') : t('archive:uploadPanel.collapse')} aria-label={collapsed ? t('archive:uploadPanel.expand') : t('archive:uploadPanel.collapse')} aria-expanded={!collapsed} onClick={() => setCollapsed((current) => !current)}>
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-fast', collapsed && 'rotate-180')} />
        </Button>
        <Button variant="ghost" size="icon-sm" title={t('common:actions.close')} aria-label={t('common:actions.close')} disabled={active > 0} onClick={clearFinishedUploads}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {collapsed ? null : (
        <ul className="max-h-64 divide-y overflow-y-auto">
          {items.map((item) => (
            <UploadRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}
