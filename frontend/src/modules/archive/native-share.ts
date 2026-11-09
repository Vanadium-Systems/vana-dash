import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { api } from '@/shared/lib/api'
import { blobToBase64, isNative } from '@/shared/lib/native'

// Desktop Chrome and Firefox have no Web Share API: the button is hidden instead of failing on
// click. In the app the sheet comes from the Capacitor plugin. The real check (file + type) is
// still `navigator.canShare` at share time; this is only the gate for rendering.
export const canShareFiles = isNative || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')

// The file goes as a real attachment, not a link: the presigned URL expires in 15 minutes
// (archive/service.ts), useless by the time the recipient opens it. In the WebView `navigator.share`
// is not guaranteed, so the file is written to the cache and the plugin's sheet shares it.
export async function shareFileNatively(id: string, name: string): Promise<void> {
  const { blob, filename } = await api.getBlob(`/api/archive/files/${id}/download`)
  const title = filename ?? name

  if (isNative) {
    const path = `share/${title}`
    await Filesystem.writeFile({ path, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true })
    try {
      const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path })
      await Share.share({ title, url: uri })
    } finally {
      await Filesystem.deleteFile({ directory: Directory.Cache, path }).catch(() => {})
    }
    return
  }

  await navigator.share({ files: [new File([blob], title, { type: blob.type })], title })
}
