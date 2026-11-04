import { Users } from 'lucide-react'
import { chartColor } from '@/shared/lib/chart-colors'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

// A person's bubble in Mesaje: initials in their own colour, as in WhatsApp, so a group reads at a
// glance. The colour comes from the user id, so it is the same on every screen and every device.
// There are no profile photos yet; when there are, they go inside this circle.

/** The person's slot in the categorical palette; their name in a group uses it too. */
export function personColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0
  return chartColor(Math.abs(hash))
}

/** Two letters; a name that is only an email splits on its dots and @. */
export function initials(name: string): string {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

const SIZES = {
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-xs',
  lg: 'size-10 text-sm',
} as const

export function ChatAvatar({
  userId,
  name,
  online,
  group,
  size = 'md',
  className,
}: {
  /** Absent for a group, which has no colour of its own. */
  userId?: string
  name: string
  online?: boolean
  group?: boolean
  size?: keyof typeof SIZES
  className?: string
}) {
  const color = userId && !group ? personColor(userId) : undefined
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        aria-hidden="true"
        className={cn('flex items-center justify-center rounded-full font-semibold', SIZES[size], !color && 'bg-muted text-muted-foreground')}
        // The colour at a fifth for the disc, full for the letters: reads in light and dark.
        style={color ? { color, backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)` } : undefined}
      >
        {group ? <Users className="h-4 w-4" /> : initials(name)}
      </span>
      {online ? (
        <span
          className="absolute bottom-0 right-0 block size-2.5 rounded-full bg-success ring-2 ring-background"
          role="img"
          aria-label={t('messages:presence.activeNow')}
        />
      ) : null}
    </span>
  )
}
