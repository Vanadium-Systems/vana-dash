import { App } from '@capacitor/app'
import { isNative } from './native'

// Android's Back button never reaches the WebView on its own, so without this it closes the app
// from any page. Order: an open dialog or menu closes first, then the previous page, and only on
// the home page does Back leave the app.
export function listenNativeBack(): () => void {
  if (!isNative) return () => {}
  const listener = App.addListener('backButton', ({ canGoBack }) => {
    if (document.querySelector('[role="dialog"], [role="menu"], [role="alertdialog"]')) {
      const target = document.activeElement ?? document.body
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    if (window.location.pathname !== '/' && canGoBack) window.history.back()
    else void App.exitApp()
  })
  return () => {
    void listener.then((handle) => handle.remove())
  }
}
