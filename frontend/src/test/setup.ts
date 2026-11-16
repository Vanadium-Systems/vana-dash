import roResources from '@/locales/ro'
import { setCompanyTimeZone } from '@/shared/lib/format'
import { initWithResources } from '@/shared/lib/i18n'

// Tests run in Romanian, the language every existing assertion was written in.
initWithResources('ro', roResources)

// The zone /api/auth/me gives in the app; the machine's own zone would make dates differ in CI.
setCompanyTimeZone('Europe/Bucharest')

// jsdom has no IntersectionObserver; components that only watch stickiness need a no-op.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
}
