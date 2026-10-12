import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { downloadApk, isAndroidBrowser } from '@/shared/lib/native'
import { t } from '@/shared/lib/i18n'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches,
  )

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      setDeferredPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  // Pe Android instalarea din browser dădea PWA-ul (varianta veche, cu logo-ul vechi), nu
  // APK-ul din Setări. Acolo butonul descarcă APK-ul; pe desktop rămâne promptul PWA.
  if (isAndroidBrowser) {
    return {
      canInstall: !installed,
      promptInstall: () =>
        downloadApk().then(
          () => toast.success(t('common:shell.apkDownloaded')),
          (err: Error) => toast.error(err.message),
        ),
    }
  }

  const promptInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  return { canInstall: !installed && deferredPrompt !== null, promptInstall }
}
