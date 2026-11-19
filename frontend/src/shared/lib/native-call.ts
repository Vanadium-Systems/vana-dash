import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// The APK's call plugin (1.6+, android/.../NativeCallPlugin.java). Older APKs and browsers have
// none: every helper here is then a no-op, and the web app rings on its own.

export type AudioRoute = 'earpiece' | 'speaker' | 'headset' | 'phone-mic'

export interface AudioState {
  route: AudioRoute | null
  bluetooth: boolean
}

interface NativeCallPlugin {
  startRinging(): Promise<void>
  stopRinging(): Promise<void>
  startCall(options: { title: string; body: string; kind: 'audio' | 'video' }): Promise<AudioState>
  setRoute(options: { route: AudioRoute }): Promise<AudioState>
  endCall(): Promise<void>
  fullScreenStatus(): Promise<{ allowed: boolean }>
  openFullScreenSettings(): Promise<void>
  addListener(event: 'answer', listener: (answer: { callId: string; url: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'hangup', listener: () => void): Promise<PluginListenerHandle>
  addListener(event: 'audioState', listener: (state: AudioState) => void): Promise<PluginListenerHandle>
}

const NativeCall = registerPlugin<NativeCallPlugin>('NativeCall')

export const hasNativeCall = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeCall')

function listen(subscribe: () => Promise<PluginListenerHandle>): () => void {
  if (!hasNativeCall) return () => {}
  const handle = subscribe()
  return () => {
    void handle.then((h) => h.remove())
  }
}

/** Answer tapped on the call notification or the call screen. Returns the cleanup. */
export function onNativeCallAnswer(open: (path: string) => void): () => void {
  return listen(() => NativeCall.addListener('answer', ({ url }) => open(url)))
}

/** Hang up tapped on the ongoing call notification. */
export function onNativeCallHangup(hangup: () => void): () => void {
  return listen(() => NativeCall.addListener('hangup', hangup))
}

export function onNativeAudioState(update: (state: AudioState) => void): () => void {
  return listen(() => NativeCall.addListener('audioState', update))
}

export const nativeRing = {
  start: () => (hasNativeCall ? NativeCall.startRinging().catch(() => undefined) : Promise.resolve()),
  stop: () => (hasNativeCall ? NativeCall.stopRinging().catch(() => undefined) : Promise.resolve()),
}

export async function startNativeCall(options: { title: string; body: string; kind: 'audio' | 'video' }): Promise<AudioState | null> {
  if (!hasNativeCall) return null
  return NativeCall.startCall(options).catch(() => null)
}

export async function setNativeAudioRoute(route: AudioRoute): Promise<AudioState | null> {
  if (!hasNativeCall) return null
  return NativeCall.setRoute({ route }).catch(() => null)
}

export function endNativeCall(): void {
  if (hasNativeCall) void NativeCall.endCall().catch(() => undefined)
}

/** Android 14+ can withhold the full-screen call screen from a sideloaded app. */
export async function nativeFullScreenAllowed(): Promise<boolean> {
  if (!hasNativeCall) return true
  return NativeCall.fullScreenStatus()
    .then((status) => status.allowed)
    .catch(() => true)
}

export function openNativeFullScreenSettings(): void {
  if (hasNativeCall) void NativeCall.openFullScreenSettings().catch(() => undefined)
}
