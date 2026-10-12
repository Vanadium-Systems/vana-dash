import { Capacitor } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()

// Pe Android, „aplicația" e APK-ul (shell Capacitor), nu PWA-ul din browser.
export const isAndroidBrowser = !isNative && /Android/i.test(navigator.userAgent)

// Descărcare prin fetch+blob, nu link direct: navigarea către /vanadash.apk era interceptată
// de fallback-ul SW-ului (servea index.html → redirect la /). Un fetch nu e navigation request,
// deci trece neatinse de SW indiferent ce versiune are userul în cache.
export async function downloadApk() {
  const res = await fetch('/vanadash.apk')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'vanadash.apk'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Blob → base64 (fără prefixul data:) — Filesystem.writeFile acceptă doar string base64
// pentru conținut binar.
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('Blob read failed'))
    reader.readAsDataURL(blob)
  })
}
