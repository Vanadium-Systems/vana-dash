import { isNative } from './native'

// The plugin is imported on demand so the web bundle never loads it.
export async function haptic(kind: 'tap' | 'success'): Promise<void> {
  try {
    if (isNative) {
      const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')
      if (kind === 'tap') await Haptics.impact({ style: ImpactStyle.Light })
      else await Haptics.notification({ type: NotificationType.Success })
      return
    }
    if (window.matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(kind === 'tap' ? 10 : [10, 40, 10])
  } catch {
    // Haptics are a nicety; a device without the motor must not break the action.
  }
}
