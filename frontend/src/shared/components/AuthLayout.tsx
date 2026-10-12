import type { ReactNode } from 'react'
import { BrandMark } from '@/shared/components/BrandMark'

// Un singur cadru pentru toți pașii de autentificare (login, resetare, acceptarea
// invitației): panoul de brand pe ecran lat, formularul în dreapta, fără card în jurul
// lui. Panoul stă în `dark` intenționat (`dark` scopează token-urile), ca logoul de oțel
// să se citească la fel pe ambele teme.
//
// Textele sunt scurte de fiecare dată: primul lucru pe care îl spune omului e ce e
// aplicația, nu ce face contul.

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
          </div>
        </div>
      </main>
    </div>
  )
}
