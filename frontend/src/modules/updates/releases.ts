import type { FeatureKey } from '@/shared/lib/types'

// Noutățile sunt un fișier static, completat la fiecare `/ship` (PLAN.md C5). Cea mai nouă
// intrare stă sus. `features` spune cui îi e utilă: o intrare apare doar omului care are cel
// puțin una dintre ele; listă goală = pentru toată lumea.

export interface Release {
  /** Momentul publicării, ISO cu fus. Ce e după `updatesSeenAt` al omului e marcat „Nou”. */
  publishedAt: string
  title: string
  body: string
  features: FeatureKey[]
}

export const RELEASES: Release[] = [
  {
    publishedAt: '2026-10-12T23:30:00+03:00',
    title: 'Atașamentele din emailuri se descarcă',
    body: 'Un atașament primit pe email care nu e poză, PDF sau text se descarcă în loc să se deschidă în pagină. Un fișier HTML trimis de cineva din afară nu mai rulează în aplicație.',
    features: ['email.view'],
  },
  {
    publishedAt: '2026-10-12T23:00:00+03:00',
    title: 'Șabloanele de contract se salvează din nou',
    body: 'Salvarea unui șablon de contract era refuzată când textul folosea datele prestatorului sau preavizul de reziliere. Acum trece. „Restaurează originalul” spune că pune în loc textul de exemplu și că textul tău nu mai poate fi recuperat.',
    features: ['facturi.contracte'],
  },
  {
    publishedAt: '2026-10-12T11:00:00+03:00',
    title: 'Suport, ghiduri și noutăți',
    body: 'Din meniul contului poți deschide un tichet către Vanadium, citi ghidurile paginilor pe care le folosești și vedea ce s-a schimbat. Semnul „?” din antetul unei pagini duce la ghidurile ei.',
    features: [],
  },
  {
    publishedAt: '2026-10-12T10:00:00+03:00',
    title: 'Numere de contract rezervate',
    body: 'În Facturi, la Contracte, ții o listă cu numerele de contract ocupate în afara aplicației. Sugestia de la un client nou le sare, iar un număr rezervat scris de mână e semnalat sub câmp.',
    features: ['facturi.contracte'],
  },
  {
    publishedAt: '2026-10-02T18:00:00+03:00',
    title: 'Poze și videouri în Mesaje',
    body: 'Pozele și videourile se deschid peste conversație, cu galerie între ele. Mesajele tale stau pe dreapta, iar meniul „⋯” de lângă un mesaj îl editează sau îl șterge.',
    features: ['mesaje.view'],
  },
  {
    publishedAt: '2026-10-01T18:00:00+03:00',
    title: 'Arhivă și calendar pe om',
    body: 'Fiecare are spațiul lui în Arhivă și calendarul lui. Un folder sau un calendar se partajează cu un coleg, cu drept de a vedea sau de a edita. Un eveniment cu participanți apare în calendarul fiecăruia.',
    features: ['arhiva.view', 'calendar.view'],
  },
  {
    publishedAt: '2026-10-01T10:00:00+03:00',
    title: 'Mesaje',
    body: 'Conversații directe și de grup, în timp real, cu atașamente de până la 15 MB și notificări pe telefon.',
    features: ['mesaje.view'],
  },
]

export function visibleReleases(can: (feature: FeatureKey) => boolean): Release[] {
  return RELEASES.filter((release) => release.features.length === 0 || release.features.some(can))
}

export function isUnseen(release: Release, seenAt: string | null): boolean {
  return seenAt === null || Date.parse(release.publishedAt) > Date.parse(seenAt)
}
