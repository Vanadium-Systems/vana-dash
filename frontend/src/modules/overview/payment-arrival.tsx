import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useMe } from '@/shared/hooks/use-me'
import { formatMoney } from '@/shared/lib/format'
import { haptic } from '@/shared/lib/haptics'
import { t } from '@/shared/lib/i18n'

/**
 * The payment chime: two short sine notes, made with WebAudio so there is no sound file and no
 * licence to track. Quiet on purpose; it only plays when the person turned sound on.
 */
function chime() {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return
  const audio = new AudioContextClass()
  const notes = [880, 1318.5]
  notes.forEach((frequency, i) => {
    const start = audio.currentTime + i * 0.12
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.08, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.55)
  })
  window.setTimeout(() => void audio.close(), 1200)
}

/**
 * The peak moment of Home (DESIGN.md "Two layers"): when the amount collected this month goes up
 * while Home is open, a payment came in, whichever way it was recorded (by hand or by bank
 * reconciliation: both mark the invoice paid). The tick draws itself, the horizon passes under the
 * toast, the phone vibrates, and the chime plays if the person turned sound on.
 */
export function usePaymentArrival(total: number | undefined, currency: string) {
  const { session } = useMe()
  const seen = useRef<number | null>(null)
  useEffect(() => {
    if (total === undefined) return
    const previous = seen.current
    seen.current = total
    if (previous === null || total <= previous) return
    toast.success(t('overview:payment.received'), {
      description: t('overview:payment.amount', { value: formatMoney(total - previous, currency) }),
      className: 'toast-peak',
      // Drawn from its outline, so the tick can draw itself; Sonner's own icon is a filled shape.
      icon: (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
      ),
      duration: 8000,
    })
    void haptic('success')
    if (session?.soundOn) chime()
  }, [total, currency, session?.soundOn])
}
