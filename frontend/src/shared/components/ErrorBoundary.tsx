import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/shared/components/ui/button'

const CHUNK_LOAD_RELOAD_KEY = 'chunkLoadReloadAttempted'

// Deploy nou (skipWaiting+clientsClaim, vite.config.ts) poate lăsa un tab deschis mid-sesiune
// pe hash-urile vechi ale bundle-ului — următorul chunk cerut pe hash vechi eșuează (404).
function isChunkLoadError(error: Error): boolean {
  return /failed to fetch dynamically imported module|loading chunk|importing a module script failed|failed to import/i.test(
    error.message,
  )
}

interface ErrorBoundaryState {
  error: Error | null
}

// Fără ErrorBoundary, orice excepție de randare făcea UNMOUNT la tot React tree-ul — pagină
// albă/"crăpată", fără recuperare (bug 1d). Montat o singură dată, la rădăcina router-ului.
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Un singur reload automat, gardat cu sessionStorage — dacă reload-ul nu rezolvă (eroare
    // reală de cod, nu chunk stale), nu bucleaza la infinit, cade pe UI-ul de recuperare.
    if (isChunkLoadError(error) && !sessionStorage.getItem(CHUNK_LOAD_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_LOAD_RELOAD_KEY, '1')
      window.location.reload()
      return
    }
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">Ceva nu a mers bine</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            A apărut o eroare neașteptată. Încearcă să reîncarci pagina — dacă problema persistă, revino mai târziu.
          </p>
          <Button onClick={() => window.location.reload()}>Reîncarcă pagina</Button>
        </div>
      )
    }
    return this.props.children
  }
}
