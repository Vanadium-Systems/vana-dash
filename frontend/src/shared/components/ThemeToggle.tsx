import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { useTheme, type Theme } from '@/shared/hooks/use-theme'

const CYCLE: Theme[] = ['system', 'light', 'dark']
const LABEL: Record<Theme, string> = { system: 'Sistem', light: 'Luminos', dark: 'Întunecat' }
const ICON: Record<Theme, typeof Sun> = { system: Monitor, light: Sun, dark: Moon }

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon = ICON[theme]

  return (
    <Button
      variant="outline"
      className="w-full"
      title="Schimbă tema (sistem / luminos / întunecat)"
      onClick={() => {
        const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length] ?? 'system'
        setTheme(next)
      }}
    >
      <Icon className="h-4 w-4" />
      Temă: {LABEL[theme]}
    </Button>
  )
}
