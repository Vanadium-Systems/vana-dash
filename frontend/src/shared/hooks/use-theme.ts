import { useEffect, useState } from 'react'
import { StatusBar, Style } from '@capacitor/status-bar'
import { isNative } from '@/shared/lib/native'

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'vana-dash-theme'

// Aplicată sincron și din scriptul inline din index.html (înainte de primul paint, ca să evite
// flash-ul de temă greșită) — logica de aici trebuie ținută identică cu aceea.
function applyTheme(theme: Theme) {
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
  // `color-scheme` spune browserului că pagina ASUMĂ explicit tema curentă — fără el, Android
  // (Chrome/Samsung Internet "Force Dark") re-colorează algoritmic o pagină pe care o crede
  // "doar light", producând un negru spălăcit/inversat în loc de tema dark reală a aplicației.
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  // theme-color = fundalul temei (alb / grafit 6%), nu primary — bara browserului/PWA se
  // topește în pagină; valoarea statică din index.html e doar fallback pre-JS.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0f0f0f' : '#ffffff')
  return isDark
}

// Barele de status/nav urmări tema APLICĂȚIEI, nu pe cea de sistem (Stefan poate suprascrie-o
// din toggle). Style.Dark = iconițe deschise pe fundal întunecat. Fix pt. bug-ul TWA "bară
// verde" — culoarea implicită Samsung aplicată când nimeni nu setează stilul explicit.
function syncNativeBars(isDark: boolean) {
  if (!isNative) return
  StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {})
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system')

  useEffect(() => {
    syncNativeBars(applyTheme(theme))
    if (theme !== 'system') return
    // Doar în modul "system" urmărim schimbarea live a preferinței SO (ex. telefonul trece
    // automat noaptea) — în light/dark explicit alegerea lui Stefan rămâne fixă.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => syncNativeBars(applyTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }

  return { theme, setTheme }
}
