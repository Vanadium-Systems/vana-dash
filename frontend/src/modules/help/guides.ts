import { localized, t, type Localized } from '@/shared/lib/i18n'
import { findNavItem } from '@/shared/lib/nav-items'
import type { FeatureKey } from '@/shared/lib/types'
import { normalizeForSearch } from '@/shared/lib/utils'

// Ghidurile sunt conținut static, în repo (PLAN.md C5): fără CMS, se schimbă odată cu ecranul
// pe care îl descriu. Fiecare e legat de o funcționalitate din catalog, deci omul vede doar
// ghidurile pentru ce are pornit. `route` e pagina din nav de care ține; „?” din antetul
// paginii deschide lista filtrată pe ea.

// Every text is written in each language, here, next to the screen it describes. `GUIDES`
// below is the list in the language of the interface.

interface GuideSource {
  id: string
  route: string
  /** Missing on a page every person has, such as My profile. */
  feature?: FeatureKey
  title: Localized
  summary: Localized
  steps: Localized[]
  videoUrl?: string
}

export interface Guide {
  id: string
  /** Ruta din nav a paginii (`/email`), aceeași ca în `nav-items.ts`. */
  route: string
  feature?: FeatureKey
  title: string
  summary: string
  steps: string[]
  /** Opțional, unde există o înregistrare. */
  videoUrl?: string
}

const SOURCES: GuideSource[] = [
  {
    id: 'apeluri-nou',
    route: '/calls',
    feature: 'apeluri.manage',
    title: {
      ro: 'Faci un apel video',
      en: 'Making a video call',
    },
    summary: {
      ro: 'Un apel are un link pe care îl trimiți oricui. Invitatul nu are nevoie de cont, intră din browser.',
      en: 'A call has a link you can send to anyone. The guest needs no account and joins from the browser.',
    },
    steps: [
      {
        ro: 'Apasă „Apel nou”, scrie un titlu și alege cât timp merge linkul.',
        en: 'Press “New call”, write a title and pick how long the link works for.',
      },
      {
        ro: '„Creează și copiază linkul” pune linkul în clipboard; trimite-l pe email sau pe chat.',
        en: '“Create and copy the link” puts the link on your clipboard; send it by email or chat.',
      },
      {
        ro: 'Intri și tu cu „Intră” din rândul apelului. Browserul îți cere camera și microfonul.',
        en: 'You join with “Join” on the call’s row. The browser asks for your camera and microphone.',
      },
      {
        ro: 'La final, „Încheie pentru toți” scoate pe toată lumea din apel, iar linkul nu mai merge.',
        en: 'When you are done, “End for everyone” takes everyone out of the call and the link stops working.',
      },
    ],
  },
  {
    id: 'email-citire',
    route: '/email',
    feature: 'email.view',
    title: {
      ro: 'Citești și cauți în email',
      en: 'Reading and searching email',
    },
    summary: {
      ro: 'Vezi doar cutiile care ți-au fost atribuite. Necititele se țin pe om: ce ai citit tu rămâne necitit pentru colegul cu aceeași cutie.',
      en: 'You see only the mailboxes assigned to you. Unread is kept per person: what you read stays unread for the colleague with the same mailbox.',
    },
    steps: [
      {
        ro: 'Alege cutia și folderul din coloana din stânga.',
        en: 'Pick the mailbox and the folder in the left column.',
      },
      {
        ro: 'Deschide un mesaj din listă; se marchează citit doar pentru tine.',
        en: 'Open a message from the list; it is marked as read only for you.',
      },
      {
        ro: 'Scrie în câmpul de căutare ca să cauți în subiect și în conținut.',
        en: 'Type in the search field to search the subject and the content.',
      },
      {
        ro: 'Selectează unul sau mai multe mesaje ca să le arhivezi sau să le marchezi necitite.',
        en: 'Select one or more messages to archive them or mark them as unread.',
      },
      {
        ro: '„Amână” ascunde firul până la momentul ales; îl găsești între timp la „Amânate”.',
        en: '“Snooze” hides the thread until the time you pick; meanwhile it is under “Snoozed”.',
      },
    ],
  },
  {
    id: 'email-raspuns',
    route: '/email',
    feature: 'email.trimitere',
    title: {
      ro: 'Scrii și răspunzi',
      en: 'Writing and replying',
    },
    summary: {
      ro: 'Mesajul pleacă de pe cutia pe care o alegi la expeditor, dintre cele pe care le ai.',
      en: 'The message goes out from the mailbox you pick as sender, among the ones you have.',
    },
    steps: [
      {
        ro: 'Apasă „Compune” pentru un mesaj nou, sau „Răspunde” într-un fir deschis.',
        en: 'Press “Compose” for a new message, or “Reply” in an open thread.',
      },
      {
        ro: 'Verifică expeditorul: la un răspuns e deja cutia pe care a venit mesajul.',
        en: 'Check the sender: for a reply it is already the mailbox the message came to.',
      },
      {
        ro: 'Pentru un fișier, atașează-l de pe dispozitiv sau cu „Atașează din Arhivă”.',
        en: 'For a file, attach it from the device or with “Attach from the Archive”.',
      },
      {
        ro: 'Dacă trimiterea nu reușește, mesajul rămâne în fereastră, netrimis, și poți încerca din nou.',
        en: 'If sending fails, the message stays in the window, not sent, and you can try again.',
      },
    ],
  },
  {
    id: 'mesaje-conversatii',
    route: '/messages',
    feature: 'mesaje.view',
    title: {
      ro: 'Vorbești cu un coleg sau cu un grup',
      en: 'Talking to a colleague or a group',
    },
    summary: {
      ro: 'Mesajele ajung pe loc la cine are aplicația deschisă; ceilalți primesc notificare.',
      en: 'Messages reach whoever has the app open right away; the others get a notification.',
    },
    steps: [
      {
        ro: 'Apasă pe iconița de conversație nouă, apoi „Scrie cuiva” pentru un coleg sau „Grup nou” pentru mai mulți.',
        en: 'Press the new conversation icon, then “Write to someone” for a colleague or “New group” for several.',
      },
      {
        ro: 'Scrie în câmpul de jos și trimite. Un fișier de până la 15 MB se pune din „Atașează”.',
        en: 'Type in the field at the bottom and send. A file of up to 15 MB is added with “Attach”.',
      },
      {
        ro: 'Meniul „⋯” de lângă un mesaj de-al tău (pe telefon, apăsare lungă) îl editează sau îl șterge.',
        en: 'The “⋯” menu next to one of your messages (on the phone, a long press) edits or deletes it.',
      },
      {
        ro: 'Câte notificări primești se alege în Profilul meu, la Notificări.',
        en: 'How many notifications you get is set in My profile, under Notifications.',
      },
    ],
  },
  {
    id: 'calendar-evenimente',
    route: '/calendar',
    feature: 'calendar.editare',
    title: {
      ro: 'Adaugi un eveniment',
      en: 'Adding an event',
    },
    summary: {
      ro: 'Evenimentele sunt în calendarul tău. Altcineva le vede doar dacă i-ai partajat calendarul sau l-ai pus participant.',
      en: 'Events are in your calendar. Someone else sees them only if you shared the calendar with them or added them as an attendee.',
    },
    steps: [
      {
        ro: 'Apasă „Eveniment nou” și completează titlul, începutul și sfârșitul.',
        en: 'Press “New event” and fill in the title, the start and the end.',
      },
      {
        ro: 'Alege un reminder dacă vrei notificare înainte, și o recurență dacă se repetă; „Repetă la fiecare” dă intervalul (din 2 în 2 săptămâni).',
        en: 'Pick a reminder if you want a notification beforehand, and a recurrence if it repeats; “Repeat every” sets the interval (every 2 weeks).',
      },
      {
        ro: 'Ca să muți un eveniment, trage-l pe altă zi în vederea pe săptămână, sau deschide-l și schimbă ora. La un eveniment care se repetă se mută toată seria.',
        en: 'To move an event, drag it to another day in the week view, or open it and change the time. For a repeating event the whole series moves.',
      },
      {
        ro: 'Comută între „Lună” și „Săptămână”; „Astăzi” te aduce înapoi la ziua curentă.',
        en: 'Switch between “Month” and “Week”; “Today” brings you back to the current day.',
      },
    ],
  },
  {
    id: 'calendar-partajare',
    route: '/calendar',
    feature: 'calendar.view',
    title: {
      ro: 'Vezi calendarul unui coleg',
      en: 'Seeing a colleague\'s calendar',
    },
    summary: {
      ro: 'La început e afișat doar calendarul tău. Al unui coleg apare după ce ți-l partajează.',
      en: 'At first only your calendar is shown. A colleague\'s shows up after they share it with you.',
    },
    steps: [
      {
        ro: 'Bifează calendarele pe care vrei să le vezi la „Calendare afișate”.',
        en: 'Tick the calendars you want to see under “Calendars shown”.',
      },
      {
        ro: 'Evenimentul altcuiva are numele omului în titlu.',
        en: 'Someone else\'s event has the person\'s name in the title.',
      },
      {
        ro: 'Ca să-ți vadă cineva calendarul, apasă „Partajează calendarul” și alege „Vede” sau „Editează”.',
        en: 'For someone to see your calendar, press “Share the calendar” and pick “Can view” or “Can edit”.',
      },
    ],
  },
  {
    id: 'clienti-prospecti',
    route: '/pricing',
    feature: 'clienti.prospectare',
    title: {
      ro: 'Lucrezi pe lista de prospecți',
      en: 'Working the prospect list',
    },
    summary: {
      ro: 'Tab-ul Prospectare ține firmele de contactat, cu scor, prioritate și status.',
      en: 'The Prospects tab holds the companies to contact, with score, priority and status.',
    },
    steps: [
      {
        ro: 'Caută după nume, CUI, telefon, email sau persoana de contact.',
        en: 'Search by name, CUI, phone, email or contact person.',
      },
      {
        ro: 'Schimbă statusul unui prospect după fiecare discuție, ca lista să arate unde a rămas.',
        en: 'Change the status of a prospect after each conversation, so the list shows where it stands.',
      },
      {
        ro: 'Apasă „Calculează preț” pe rând ca să deschizi calculatorul cu datele lui.',
        en: 'Press “Calculate price” on the row to open the calculator with its details.',
      },
      {
        ro: 'Când a devenit client, apasă „Promovează”.',
        en: 'When it has become a client, press “Promote”.',
      },
    ],
  },
  {
    id: 'clienti-calculator',
    route: '/pricing',
    feature: 'clienti.calculator',
    title: {
      ro: 'Calculezi un preț',
      en: 'Calculating a price',
    },
    summary: {
      ro: 'Calculatorul scoate prețul lunar din numărul de operatori, documente și modulele alese.',
      en: 'The calculator works out the monthly price from the number of operators, the documents and the modules picked.',
    },
    steps: [
      {
        ro: 'Deschide tab-ul Calculator, sau vino din „Calculează preț” de pe un prospect.',
        en: 'Open the Calculator tab, or come from “Calculate price” on a prospect.',
      },
      {
        ro: 'Completează operatorii, documentele pe lună și bifează modulele.',
        en: 'Fill in the operators, the documents per month and tick the modules.',
      },
      {
        ro: 'Prețul se recalculează la fiecare schimbare și apare atât lunar, cât și anual.',
        en: 'The price is recomputed on every change and is shown both monthly and yearly.',
      },
    ],
  },
  {
    id: 'declaratii-spv',
    route: '/accounting',
    feature: 'facturi.declaratii',
    title: {
      ro: 'Depui D301 și D390 în SPV',
      en: 'Filing D301 and D390 in SPV',
    },
    summary: {
      ro: 'Tabul Declarații din Facturi face formularele ANAF din achizițiile cu taxare inversă ale lunii. PDF-ul e cel care merge în SPV; XML-ul și CSV-ul sunt pentru contabilă.',
      en: 'The Declarations tab in Invoices builds the ANAF forms from the month’s reverse-charge purchases. The PDF is what goes to SPV; the XML and CSV are for the accountant.',
    },
    steps: [
      {
        ro: 'Alege luna și verifică liniile: D301 are toate serviciile, D390 doar furnizorii din UE, câte un rând pe furnizor.',
        en: 'Pick the month and check the lines: D301 has every service, D390 only the EU suppliers, one row per supplier.',
      },
      {
        ro: 'Abonamentele intră cu suma și data abonamentului, fără număr de factură. Cu creionul de pe rând copiezi numărul, data și suma de pe factura reală. Dacă furnizorul ți-a pus deja TVA pe factură, alege „Fără taxare inversă” și linia iese din declarații.',
        en: 'Subscriptions come in with the subscription’s amount and date and no invoice number. The pencil on the row lets you copy the number, date and amount from the real invoice. If the supplier already charged VAT on the invoice, pick “No reverse charge” and the line leaves the declarations.',
      },
      {
        ro: 'Apasă PDF și deschide fișierul în Adobe Acrobat Reader. Alte programe nu știu formularele ANAF.',
        en: 'Press PDF and open the file in Adobe Acrobat Reader. Other viewers cannot handle ANAF forms.',
      },
      {
        ro: 'Apasă Validare în formular. Dacă trece, formularul atașează singur XML-ul și apare câmpul de semnătură.',
        en: 'Press Validare in the form. If it passes, the form attaches the XML itself and the signature field shows up.',
      },
      {
        ro: 'Semnează cu certificatul calificat, salvează și încarcă PDF-ul în SPV, la Depunere declarații.',
        en: 'Sign with the qualified certificate, save and upload the PDF in SPV, under declaration filing.',
      },
    ],
  },
  {
    id: 'date-firma',
    route: '/settings',
    feature: 'setari.firma',
    title: {
      ro: 'Completezi datele firmei',
      en: 'Filling in the company details',
    },
    summary: {
      ro: 'Fișa din Setări → Date firmă e singurul loc din care facturile trimise la ANAF, declarațiile D301/D390 și contractele își iau datele firmei. Ce schimbi aici apare pe următorul document emis, nu pe cele vechi.',
      en: 'The sheet under Settings → Company details is the only place the invoices sent to ANAF, the D301/D390 declarations and the contracts take the company’s details from. A change shows on the next document issued, not on the old ones.',
    },
    steps: [
      {
        ro: 'Numele, CUI-ul și sediul (județ, localitate, stradă) sunt obligatorii pentru o factură. Fără ele, emiterea se oprește și îți spune ce lipsește.',
        en: 'The name, tax ID and registered office (county, city, street) are required for an invoice. Without them, issuing stops and says what is missing.',
      },
      {
        ro: 'La Facturi și declarații bifezi dacă firma e plătitoare de TVA și treci reprezentantul care semnează contractele și declarantul care semnează D301 și D390.',
        en: 'Under Invoices and declarations you tick whether the company is VAT registered and fill in the representative who signs the contracts and the declarant who signs D301 and D390.',
      },
      {
        ro: 'Fusul orar decide ora la care apar datele în toată aplicația, pentru toți colegii, și ora programărilor și a memento-urilor.',
        en: 'The time zone decides the time dates are shown at across the app, for every colleague, and the time of bookings and reminders.',
      },
    ],
  },
  {
    id: 'profil-meu',
    route: '/me',
    title: {
      ro: 'Îți reglezi contul',
      en: 'Adjusting your account',
    },
    summary: {
      ro: 'Profilul meu e doar al tău: numele cu care te văd colegii, limba, moneda totalurilor, parola și ce notificări primești. Emailul și rolul le schimbă adminul.',
      en: 'My profile is yours only: the name colleagues see, the language, the currency of totals, the password and which notifications you get. The email and the role are changed by the admin.',
    },
    steps: [
      {
        ro: 'Apasă pe numele tău, jos în bara din stânga (pe telefon, în „Mai mult”), și alege Profilul meu.',
        en: 'Click your name at the bottom of the left bar (on the phone, under “More”) and pick My profile.',
      },
      {
        ro: 'La Afișare alegi limba interfeței și moneda în care vezi totalurile. Pagina se reîncarcă în limba nouă.',
        en: 'Under Display you pick the interface language and the currency totals are shown in. The page reloads in the new language.',
      },
      {
        ro: 'La Parolă scrii parola de acum și una nouă, de minim 12 caractere. Celelalte dispozitive sunt delogate.',
        en: 'Under Password you type the current password and a new one of at least 12 characters. Your other devices are logged out.',
      },
      {
        ro: 'La Notificări alegi despre ce ești anunțat: mesajele (toate sau doar cele directe), emailul nou pe cutiile tale și alertele.',
        en: 'Under Notifications you choose what you are told about: messages (all or only direct ones), new email in your mailboxes and alerts.',
      },
    ],
  },
]

export const GUIDES: Guide[] = SOURCES.map((guide) => ({
  ...guide,
  title: localized(guide.title),
  summary: localized(guide.summary),
  steps: guide.steps.map(localized),
}))

export function visibleGuides(can: (feature: FeatureKey) => boolean): Guide[] {
  return GUIDES.filter((guide) => !guide.feature || can(guide.feature))
}

// Pages every person has, reached from the account menu rather than the nav.
const PAGES_OUTSIDE_NAV: Record<string, () => string> = {
  '/me': () => t('common:nav.myProfile'),
}

export function guidePageLabel(route: string): string | undefined {
  return findNavItem(route)?.label ?? PAGES_OUTSIDE_NAV[route]?.()
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
