import { Check, ChevronDown, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { BottomSheet } from '@/shared/components/ui/responsive-menu'
import { useMediaQuery } from '@/shared/hooks/use-media-query'
import { t } from '@/shared/lib/i18n'
import type { CalendarLayer } from '@/shared/lib/types'
import { cn, normalizeForSearch } from '@/shared/lib/utils'
import { CalendarPopover } from './CalendarPopover'

/**
 * Which colleagues' calendars are shown: one button instead of a row of checkboxes, which did not
 * scale past a few people. A searchable list with "only mine" / "all"; your own calendar and the
 * events you attend always show.
 */
export function CalendarFilter({
  layers,
  shown,
  onChange,
}: {
  layers: CalendarLayer[]
  shown: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const phone = useMediaQuery('(max-width: 639px)')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [query, setQuery] = useState('')
  const others = layers.filter((l) => !l.owner)
  const shownCount = others.filter((l) => shown.has(l.userId)).length
  const matches = useMemo(() => {
    const q = normalizeForSearch(query.trim())
    return q ? others.filter((l) => normalizeForSearch(l.name).includes(q)) : others
  }, [others, query])

  if (others.length === 0) return null

  const toggle = (userId: string) => {
    const next = new Set(shown)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    onChange(next)
  }
  const close = () => {
    setAnchor(null)
    setQuery('')
  }

  const body = (
    <div className="space-y-2">
      {others.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus={!phone}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('calendar:filter.search')}
            aria-label={t('calendar:filter.search')}
            className="pl-8"
          />
        </div>
      ) : null}
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => onChange(new Set())} disabled={shownCount === 0}>
          {t('calendar:filter.onlyMine')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange(new Set(others.map((l) => l.userId)))} disabled={shownCount === others.length}>
          {t('calendar:filter.all')}
        </Button>
      </div>
      <ul className="max-h-72 overflow-y-auto" aria-label={t('calendar:layers.shown')}>
        {matches.map((layer) => {
          const checked = shown.has(layer.userId)
          return (
            <li key={layer.userId}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none max-sm:min-h-12"
                onClick={() => toggle(layer.userId)}
              >
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border', checked && 'border-primary bg-primary text-primary-foreground')}>
                  {checked ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                {layer.level === 'view' ? <span className="shrink-0 text-xs text-muted-foreground">{t('calendar:layers.viewOnly')}</span> : null}
              </button>
            </li>
          )
        })}
        {matches.length === 0 ? <li className="px-2 py-3 text-sm text-muted-foreground">{t('calendar:filter.noMatch')}</li> : null}
      </ul>
    </div>
  )

  return (
    <>
      <Button
        ref={triggerRef}
        variant="outline"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={() => (anchor ? close() : setAnchor(triggerRef.current?.getBoundingClientRect() ?? null))}
      >
        {shownCount > 0 ? t('calendar:filter.buttonCount', { count: shownCount }) : t('calendar:filter.button')}
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </Button>
      {phone ? (
        <BottomSheet open={Boolean(anchor)} onClose={close} title={t('calendar:filter.title')}>
          <div className="px-3 pb-2">{body}</div>
        </BottomSheet>
      ) : (
        <CalendarPopover anchor={anchor} placement="below" title={t('calendar:filter.title')} onClose={close}>
          {body}
        </CalendarPopover>
      )}
    </>
  )
}
