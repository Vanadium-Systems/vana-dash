import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { useTheme, type Theme } from '@/shared/hooks/use-theme'
import { t } from '@/shared/lib/i18n'

const CYCLE: Theme[] = ['system', 'light', 'dark']
const LABEL: Record<Theme, string> = { system: t('common:labels.system'), light: t('common:theme.light'), dark: t('common:theme.dark') }
const ICON: Record<Theme, typeof Sun> = { system: Monitor, light: Sun, dark: Moon }

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme()
  const Icon = ICON[theme]

  return (
    <Button
      variant="outline"
      size={compact ? 'icon' : undefined}
      className={compact ? undefined : 'w-full'}
      title={t('common:theme.switch')}
      aria-label={compact ? `${t('common:theme.label')} ${LABEL[theme]}` : undefined}
      onClick={() => {
        const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length] ?? 'system'
        setTheme(next)
      }}
    >
      <Icon className="h-4 w-4" />
      {compact ? null : `${t('common:theme.label')} ${LABEL[theme]}`}
    </Button>
  )
}
