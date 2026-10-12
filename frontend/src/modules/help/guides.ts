import type { FeatureKey } from '@/shared/lib/types'
import { normalizeForSearch } from '@/shared/lib/utils'

// Ghidurile sunt conținut static, în repo (PLAN.md C5): fără CMS, se schimbă odată cu ecranul
// pe care îl descriu. Fiecare e legat de o funcționalitate din catalog, deci omul vede doar
// ghidurile pentru ce are pornit. `route` e pagina din nav de care ține; „?” din antetul
// paginii deschide lista filtrată pe ea.

export interface Guide {
  id: string
  /** Ruta din nav a paginii (`/email`), aceeași ca în `nav-items.ts`. */
  route: string
  feature: FeatureKey
  title: string
  summary: string
  steps: string[]
  /** Opțional, unde există o înregistrare. */
  videoUrl?: string
}

export const GUIDES: Guide[] = [
  {
    id: 'email-citire',
    route: '/email',
    feature: 'email.view',
    title: 'Citești și cauți în email',
    summary: 'Vezi doar cutiile care ți-au fost atribuite. Necititele se țin pe om: ce ai citit tu rămâne necitit pentru colegul cu aceeași cutie.',
    steps: [
      'Alege cutia și folderul din coloana din stânga.',
      'Deschide un mesaj din listă; se marchează citit doar pentru tine.',
      'Scrie în câmpul de căutare ca să cauți în subiect și în conținut.',
      'Selectează unul sau mai multe mesaje ca să le arhivezi sau să le marchezi necitite.',
    ],
  },
  {
    id: 'email-raspuns',
    route: '/email',
    feature: 'email.trimitere',
    title: 'Scrii și răspunzi',
    summary: 'Mesajul pleacă de pe cutia pe care o alegi la expeditor, dintre cele pe care le ai.',
    steps: [
      'Apasă „Compune” pentru un mesaj nou, sau „Răspunde” într-un fir deschis.',
      'Verifică expeditorul: la un răspuns e deja cutia pe care a venit mesajul.',
      'Pentru un fișier, atașează-l de pe dispozitiv sau cu „Atașează din Arhivă”.',
      'Dacă trimiterea nu reușește, mesajul rămâne în fereastră, netrimis, și poți încerca din nou.',
    ],
  },
  {
    id: 'mesaje-conversatii',
    route: '/messages',
    feature: 'mesaje.view',
    title: 'Vorbești cu un coleg sau cu un grup',
    summary: 'Mesajele ajung pe loc la cine are aplicația deschisă; ceilalți primesc notificare.',
    steps: [
      'Apasă pe iconița de conversație nouă, apoi „Scrie cuiva” pentru un coleg sau „Grup nou” pentru mai mulți.',
      'Scrie în câmpul de jos și trimite. Un fișier de până la 15 MB se pune din „Atașează”.',
      'Meniul „⋯” de lângă un mesaj de-al tău (pe telefon, apăsare lungă) îl editează sau îl șterge.',
      'Câte notificări primești se alege în Profilul meu, la Notificări.',
    ],
  },
  {
    id: 'calendar-evenimente',
    route: '/calendar',
    feature: 'calendar.editare',
    title: 'Adaugi un eveniment',
    summary: 'Evenimentele sunt în calendarul tău. Altcineva le vede doar dacă i-ai partajat calendarul sau l-ai pus participant.',
    steps: [
      'Apasă „Eveniment nou” și completează titlul, începutul și sfârșitul.',
      'Alege un reminder dacă vrei notificare înainte, și o recurență dacă se repetă.',
      'Ca să muți un eveniment, trage-l pe altă zi în vederea pe săptămână, sau deschide-l și schimbă ora.',
      'Comută între „Lună” și „Săptămână”; „Astăzi” te aduce înapoi la ziua curentă.',
    ],
  },
  {
    id: 'calendar-partajare',
    route: '/calendar',
    feature: 'calendar.view',
    title: 'Vezi calendarul unui coleg',
    summary: 'La început e afișat doar calendarul tău. Al unui coleg apare după ce ți-l partajează.',
    steps: [
      'Bifează calendarele pe care vrei să le vezi la „Calendare afișate”.',
      'Evenimentul altcuiva are numele omului în titlu.',
      'Ca să-ți vadă cineva calendarul, apasă „Partajează calendarul” și alege „Vede” sau „Editează”.',
    ],
  },
  {
    id: 'clienti-prospecti',
    route: '/pricing',
    feature: 'clienti.prospectare',
    title: 'Lucrezi pe lista de prospecți',
    summary: 'Tab-ul Prospectare ține firmele de contactat, cu scor, prioritate și status.',
    steps: [
      'Caută după nume, CUI, telefon, email sau persoana de contact.',
      'Schimbă statusul unui prospect după fiecare discuție, ca lista să arate unde a rămas.',
      'Apasă „Calculează preț” pe rând ca să deschizi calculatorul cu datele lui.',
      'Când a devenit client, apasă „Promovează”.',
    ],
  },
  {
    id: 'clienti-calculator',
    route: '/pricing',
    feature: 'clienti.calculator',
    title: 'Calculezi un preț',
    summary: 'Calculatorul scoate prețul lunar din numărul de operatori, documente și modulele alese.',
    steps: [
      'Deschide tab-ul Calculator, sau vino din „Calculează preț” de pe un prospect.',
      'Completează operatorii, documentele pe lună și bifează modulele.',
      'Prețul se recalculează la fiecare schimbare și apare atât lunar, cât și anual.',
    ],
  },
]

export function visibleGuides(can: (feature: FeatureKey) => boolean): Guide[] {
  return GUIDES.filter((guide) => can(guide.feature))
}

/** Prima parte a căii, ca `/messages/abc` să găsească ghidurile de la `/messages`. */
export function guideRouteOf(pathname: string): string {
  return `/${pathname.split('/')[1] ?? ''}`
}

export function searchGuides(guides: Guide[], query: string): Guide[] {
  const q = normalizeForSearch(query.trim())
  if (!q) return guides
  return guides.filter((guide) => normalizeForSearch([guide.title, guide.summary, ...guide.steps].join(' ')).includes(q))
}
