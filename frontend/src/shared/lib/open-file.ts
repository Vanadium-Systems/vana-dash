import { api } from './api'
import { isNative } from './native'

// `window.open` does nothing in the Android app: the WebView has no tabs. On the web a PDF still
// opens in a new tab; in the app the file is downloaded through `api.download`, which saves it with
// the native plugin. `path` is one of our own `/api/...` routes (it needs the session cookie).
export function openFile(path: string, fallbackFileName: string): void {
  if (isNative) {
    void api.download(path, fallbackFileName).catch(() => {})
    return
  }
  window.open(path, '_blank')
}

/** A URL the server handed back (a presigned storage URL, an external page): the system browser in the app. */
export function openExternal(url: string): void {
  if (url.startsWith('/')) return openFile(url, 'document')
  if (isNative) {
    // Capacitor hands navigation to a host outside the app to the system browser.
    window.location.assign(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
