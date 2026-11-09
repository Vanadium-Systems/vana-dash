import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// The service worker takes over as soon as a new build is installed (skipWaiting + clientsClaim
// in vite.config.ts), but the open page keeps running the old bundle. Nothing reloads it on its
// own: the plain registerSW.js from vite-plugin-pwa only registers the worker. So the reload is
// ours, timed so it never throws away something being typed.

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const PRELOAD_RELOAD_KEY = 'app-update:preload-reload-at'

let updatePending = false
let interacted = false

function isEditing() {
  const el = document.activeElement
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

export function watchForUpdates() {
  const markInteracted = () => {
    interacted = true
  }
  window.addEventListener('pointerdown', markInteracted, { once: true, capture: true })
  window.addEventListener('keydown', markInteracted, { once: true, capture: true })

  let hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First install: the page was loaded from the network and is already current.
    if (!hadController) {
      hadController = true
      return
    }
    // A plain refresh got the old index.html from the precache and pulled the new worker in
    // the background. Nobody has touched the page yet, so reload straight away.
    if (!interacted) window.location.reload()
    else updatePending = true
  })

  navigator.serviceWorker.ready.then((registration) => {
    const check = () => registration.update().catch(() => undefined)
    setInterval(check, CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      if (updatePending && !isEditing()) window.location.reload()
      else void check()
    })
  })

  // A lazy page from the old build asks for a chunk the new deploy no longer has. Reload once;
  // the timestamp stops a loop if the chunk is missing for some other reason.
  window.addEventListener('vite:preloadError', (event) => {
    const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? 0)
    if (Date.now() - last < 10_000) return
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()))
    event.preventDefault()
    window.location.reload()
  })
}

// Moving to another page already drops whatever was on screen, so it is the safest moment to
// switch to the new build.
export function ReloadOnNavigate() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (updatePending) window.location.reload()
  }, [pathname])
  return null
}
