import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrandMark } from '@/shared/components/BrandMark'
import { api } from '@/shared/lib/api'
import { changeLocale, getLocale, t } from '@/shared/lib/i18n'
import { LOCALE_NAMES, type Locale } from '@/shared/lib/locale'

// Un singur cadru pentru toți pașii de autentificare (login, resetare, acceptarea
// invitației): panoul de brand pe ecran lat, formularul în dreapta, fără card în jurul
// lui. Panoul stă în `dark` intenționat (`dark` scopează token-urile), ca logoul de oțel
// să se citească la fel pe ambele teme.
//
// Textele sunt scurte de fiecare dată: primul lucru pe care îl spune omului e ce e
// aplicația, nu ce face contul.

/** Before login there is no profile to set the language in; the choice stays in this browser. */
function LanguageSwitch() {
  const locales = useQuery({
    queryKey: ['auth', 'locale'],
    queryFn: () => api.get<{ defaultLocale: Locale; enabledLocales: Locale[] }>('/api/auth/locale'),
    staleTime: Infinity,
  })
  const enabled = locales.data?.enabledLocales ?? []
  if (enabled.length < 2) return null
  return (
    <div className="mt-8 flex gap-3 text-sm" role="group" aria-label={t('auth:languageSwitch')}>
      {enabled.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          aria-pressed={locale === getLocale()}
          onClick={() => void changeLocale(locale)}
          className="rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:font-medium aria-pressed:text-foreground"
        >
          {LOCALE_NAMES[locale]}
        </button>
      ))}
    </div>
  )
}

export function AuthLayout({ title, subline, children }: { title: string; subline: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="dark hidden flex-col justify-between bg-background p-10 text-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-9 w-9" />
          <span className="text-lg font-semibold">VanaDash</span>
        </div>
        <div className="max-w-sm space-y-3">
          <p className="text-2xl font-semibold leading-snug">{title}</p>
          <p className="text-sm text-muted-foreground">{subline}</p>
        </div>
        <p className="text-xs text-muted-foreground">© 2026 Vanadium Systems SRL</p>
      </aside>
      <main className="flex min-w-0 flex-col [&>div]:min-h-0 [&>div]:flex-1">
        <div className="flex flex-1 flex-col justify-center px-4 py-10 sm:px-8">
          <div className="mx-auto w-full max-w-sm" data-density="comfortable">
            <div className="mb-8 flex items-center gap-2.5 lg:hidden">
              <BrandMark className="h-8 w-8" />
              <span className="text-base font-semibold">VanaDash</span>
            </div>
            {children}
            <LanguageSwitch />
          </div>
        </div>
      </main>
    </div>
  )
}
