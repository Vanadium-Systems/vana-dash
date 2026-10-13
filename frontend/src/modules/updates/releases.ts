import { localized, type Localized } from '@/shared/lib/i18n'
import type { FeatureKey } from '@/shared/lib/types'

// Noutățile sunt un fișier static, completat la fiecare `/ship` (PLAN.md C5). Cea mai nouă
// intrare stă sus. `features` spune cui îi e utilă: o intrare apare doar omului care are cel
// puțin una dintre ele; listă goală = pentru toată lumea.

// Every entry is written in each language. `RELEASES` below is the list in the language of
// the interface.

interface ReleaseSource {
  publishedAt: string
  title: Localized
  body: Localized
  features: FeatureKey[]
}

export interface Release {
  /** Momentul publicării, ISO cu fus. Ce e după `updatesSeenAt` al omului e marcat „Nou”. */
  publishedAt: string
  title: string
  body: string
  features: FeatureKey[]
}

const SOURCES: ReleaseSource[] = [
  {
    publishedAt: '2026-10-13T12:00:00+03:00',
    title: {
      ro: 'Aplicația e și în engleză',
      en: 'The app is also in English',
    },
    body: {
      ro: 'Din Profilul meu, la Afișare, alegi limba interfeței și moneda în care vezi totalurile (lei, euro sau dolari). Sumele convertite au „≈” în față și folosesc cursul BNR din ziua fiecărei înregistrări. Facturile și declarațiile rămân în lei și în română.',
      en: 'In My profile, under Display, you pick the interface language and the currency totals are shown in (lei, euros or dollars). Converted amounts have “≈” in front and use the BNR rate of each record\'s day. Invoices and declarations stay in lei and in Romanian.',
    },
    features: [],
  },
  {
    publishedAt: '2026-10-12T23:30:00+03:00',
    title: {
      ro: 'Atașamentele din emailuri se descarcă',
      en: 'Email attachments are downloaded',
    },
    body: {
      ro: 'Un atașament primit pe email care nu e poză, PDF sau text se descarcă în loc să se deschidă în pagină. Un fișier HTML trimis de cineva din afară nu mai rulează în aplicație.',
      en: 'An attachment received by email that is not an image, a PDF or text is downloaded instead of opening in the page. An HTML file sent by someone outside no longer runs in the app.',
    },
    features: ['email.view'],
  },
  {
    publishedAt: '2026-10-12T23:00:00+03:00',
    title: {
      ro: 'Șabloanele de contract se salvează din nou',
      en: 'Contract templates save again',
    },
    body: {
      ro: 'Salvarea unui șablon de contract era refuzată când textul folosea datele prestatorului sau preavizul de reziliere. Acum trece. „Restaurează originalul” spune că pune în loc textul de exemplu și că textul tău nu mai poate fi recuperat.',
      en: 'Saving a contract template was refused when the text used the provider\'s details or the termination notice. It now goes through. “Restore the original” says that it puts the example text in place and that your text cannot be recovered.',
    },
    features: ['facturi.contracte'],
  },
  {
    publishedAt: '2026-10-12T11:00:00+03:00',
    title: {
      ro: 'Suport, ghiduri și noutăți',
      en: 'Support, guides and updates',
    },
    body: {
      ro: 'Din meniul contului poți deschide un tichet către Vanadium, citi ghidurile paginilor pe care le folosești și vedea ce s-a schimbat. Semnul „?” din antetul unei pagini duce la ghidurile ei.',
      en: 'From the account menu you can open a ticket to Vanadium, read the guides of the pages you use and see what changed. The “?” in a page header leads to its guides.',
    },
    features: [],
  },
  {
    publishedAt: '2026-10-12T10:00:00+03:00',
    title: {
      ro: 'Numere de contract rezervate',
      en: 'Reserved contract numbers',
    },
    body: {
      ro: 'În Facturi, la Contracte, ții o listă cu numerele de contract ocupate în afara aplicației. Sugestia de la un client nou le sare, iar un număr rezervat scris de mână e semnalat sub câmp.',
      en: 'In Invoices, under Contracts, you keep a list of the contract numbers taken outside the app. The suggestion for a new client skips them, and a reserved number typed by hand is flagged below the field.',
    },
    features: ['facturi.contracte'],
  },
  {
    publishedAt: '2026-10-02T18:00:00+03:00',
    title: {
      ro: 'Poze și videouri în Mesaje',
      en: 'Photos and videos in Messages',
    },
    body: {
      ro: 'Pozele și videourile se deschid peste conversație, cu galerie între ele. Mesajele tale stau pe dreapta, iar meniul „⋯” de lângă un mesaj îl editează sau îl șterge.',
      en: 'Photos and videos open over the conversation, with a gallery between them. Your messages sit on the right, and the “⋯” menu next to a message edits or deletes it.',
    },
    features: ['mesaje.view'],
  },
  {
    publishedAt: '2026-10-01T18:00:00+03:00',
    title: {
      ro: 'Arhivă și calendar pe om',
      en: 'Archive and calendar per person',
    },
    body: {
      ro: 'Fiecare are spațiul lui în Arhivă și calendarul lui. Un folder sau un calendar se partajează cu un coleg, cu drept de a vedea sau de a edita. Un eveniment cu participanți apare în calendarul fiecăruia.',
      en: 'Everyone has their own space in the Archive and their own calendar. A folder or a calendar is shared with a colleague, with the right to view or to edit. An event with attendees shows up in each person\'s calendar.',
    },
    features: ['arhiva.view', 'calendar.view'],
  },
  {
    publishedAt: '2026-10-01T10:00:00+03:00',
    title: {
      ro: 'Mesaje',
      en: 'Messages',
    },
    body: {
      ro: 'Conversații directe și de grup, în timp real, cu atașamente de până la 15 MB și notificări pe telefon.',
      en: 'Direct and group conversations, in real time, with attachments of up to 15 MB and notifications on the phone.',
    },
    features: ['mesaje.view'],
  },
]

export const RELEASES: Release[] = SOURCES.map((release) => ({
  ...release,
  title: localized(release.title),
  body: localized(release.body),
}))

export function visibleReleases(can: (feature: FeatureKey) => boolean): Release[] {
  return RELEASES.filter((release) => release.features.length === 0 || release.features.some(can))
}

export function isUnseen(release: Release, seenAt: string | null): boolean {
  return seenAt === null || Date.parse(release.publishedAt) > Date.parse(seenAt)
}
