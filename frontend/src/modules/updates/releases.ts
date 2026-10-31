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
    publishedAt: '2026-10-31T20:00:00+02:00',
    title: {
      ro: 'Meniuri, selecție și scurtături ca într-o aplicație de pe calculator',
      en: 'Menus, selection and shortcuts like a desktop app',
    },
    body: {
      ro: 'În Email selectezi cu Shift + click un interval, iar acțiunile apar într-o bară plutitoare jos. Click dreapta pe un mesaj deschide meniul lui, iar după arhivare sau ștergere poți apăsa „Anulează”. Atașamentele se deschid peste pagină, cu ← → între ele. Apasă ? oriunde ca să vezi scurtăturile. Pe telefon, meniul ⋯ al unui rând urcă de jos, „Mai mult” la fel, mesajele de confirmare stau jos, lângă deget, și glisezi un mesaj spre stânga ca să-l ștergi. Paginile se deschid fără ecran gol: bara rămâne pe loc și conținutul apare când e gata. Pe un ecran îngust bara laterală arată doar iconițe, iar „Restrânge” de jos o strânge și pe monitor mare.',
      en: 'In Email, Shift + click selects a range and the actions show in a floating bar at the bottom. Right-click a message for its menu, and after archiving or deleting you can press “Undo”. Attachments open over the page, with ← → between them. Press ? anywhere to see the shortcuts. On a phone a row’s ⋯ menu rises from the bottom, so does “More”, confirmations sit at the bottom by your thumb, and you swipe a message left to delete it. Pages open with no blank screen: the bar stays put and the content shows when it is ready. On a narrow screen the sidebar shows icons only, and “Collapse” at its bottom folds it on a large monitor too.',
    },
    features: [],
  },
  {
    publishedAt: '2026-10-30T17:00:00+02:00',
    title: {
      ro: 'Contractele vin cu câmpuri de semnătură',
      en: 'Contracts come with signature fields',
    },
    body: {
      ro: 'Contractele, anexele și actele adiționale generate au deja câte un câmp gol de semnătură digitală deasupra fiecărei linii de semnătură. Deschizi PDF-ul în Adobe Reader, dai click pe câmp și alegi certificatul; cealaltă parte semnează la fel în câmpul ei.',
      en: 'Generated contracts, annexes and addenda now have an empty digital signature field above every signature line. Open the PDF in Adobe Reader, click the field and pick your certificate; the other party signs the same way in theirs.',
    },
    features: ['facturi.contracte'],
  },
  {
    publishedAt: '2026-10-30T15:00:00+02:00',
    title: {
      ro: 'Taxa de inițiere se calculează pe ore',
      en: 'The setup fee is worked out in hours',
    },
    body: {
      ro: 'În Calculator scrii câte ore estimezi pentru inițiere și o marjă de eroare; taxa e ore × tariful pe oră din Config preț. Un pachet costă acum suma modulelor lui minus un procent, iar în Config preț poți porni o reducere de campanie care se aplică la tot.',
      en: 'In the Calculator you enter the hours you expect setup to take and an error margin; the fee is hours × the hourly rate in Price config. A bundle now costs the sum of its modules minus a percentage, and Price config has a campaign discount that applies to everything.',
    },
    features: ['clienti.calculator', 'clienti.config-pret'],
  },
  {
    publishedAt: '2026-10-30T12:00:00+02:00',
    title: {
      ro: 'Niciun tabel nu mai iese din ecran',
      en: 'No table runs off the screen any more',
    },
    body: {
      ro: 'Toate tabelele încap pe telefon și pe tabletă, fără derulare în lateral: coloanele mai puțin importante se ascund, iar valorile lor apar sub titlul rândului. Pe ecran îngust, butoanele unui rând stau în meniul ⋯. Tab-urile trec pe al doilea rând, zilele din Calendar încap toate, pagina Module arată câte un rol pe telefon, iar în Email lista de foldere se deschide în locul listei de mesaje, nu lângă ea. Tabelele se potrivesc și la zoom în browser, cardurile cu cifre nu se mai strivesc, iar Licitații arată 10, 25 sau 50 pe pagină.',
      en: 'Every table fits a phone and a tablet with no sideways scrolling: the less important columns hide and their values show under the row title. On a narrow screen a row’s buttons sit in the ⋯ menu. Tabs wrap onto a second row, all the days in Calendar fit, the Modules page shows one role at a time on a phone, and in Email the folder list opens in place of the message list, not next to it. Tables also fit at browser zoom, number cards no longer get squeezed, and Tenders shows 10, 25 or 50 per page.',
    },
    features: [],
  },
  {
    publishedAt: '2026-10-30T10:00:00+02:00',
    title: {
      ro: 'Calendar, email și tabele mai bune pe telefon',
      en: 'Calendar, email and tables that work better on a phone',
    },
    body: {
      ro: 'Un eveniment care se repetă își păstrează regula când îl editezi, iar formularul are „Repetă la fiecare” (de exemplu, din 2 în 2 săptămâni). Când tragi o apariție, aplicația întreabă dacă muți toată seria. Vederea pe săptămână arată toate cele 24 de ore și pune evenimentele suprapuse unul lângă altul. Un email se poate amâna din fir sau din selecție, iar emailurile late se micșorează pe telefon. Tabelele încap pe ecran îngust: coloanele mai puțin importante se ascund, iar valorile lor apar pe un rând mic sub titlu. Pe Android, butonul Înapoi închide întâi dialogul, apoi revine la pagina anterioară (cere aplicația reinstalată), iar notificările pentru emailuri citite pe alt dispozitiv dispar când deschizi aplicația.',
      en: 'A repeating event keeps its rule when you edit it, and the form has “Repeat every” (for example, every 2 weeks). When you drag an occurrence, the app asks whether to move the whole series. The week view shows all 24 hours and puts overlapping events side by side. An email can be snoozed from the thread or from a selection, and wide emails shrink to fit a phone. Tables fit a narrow screen: the less important columns hide and their values show on a small line under the title. On Android, Back first closes the dialog, then goes to the previous page (needs the app reinstalled), and notifications for emails you read on another device go away when you open the app.',
    },
    features: [],
  },
  {
    publishedAt: '2026-10-29T20:00:00+02:00',
    title: {
      ro: 'Datele firmei se completează din Setări',
      en: 'The company details are set in Settings',
    },
    body: {
      ro: 'Facturile, declarațiile D301/D390 și contractele își iau acum datele firmei din Setări → Date firmă, nu din configurarea serverului. Fișa are câmpuri noi: plătitor de TVA, reprezentant, declarant, cod poștal, fus orar și monedă. Datele și orele din aplicație se arată în fusul firmei.',
      en: 'Invoices, the D301/D390 declarations and contracts now take the company details from Settings → Company details, not from the server configuration. The sheet has new fields: VAT registered, representative, declarant, postal code, time zone and currency. Dates and times in the app are shown in the company’s time zone.',
    },
    features: ['setari.firma'],
  },
  {
    publishedAt: '2026-10-26T20:00:00+02:00',
    title: {
      ro: 'Apeluri video din VanaDash',
      en: 'Video calls from VanaDash',
    },
    body: {
      ro: 'Pagina Apeluri creează un apel și îți copiază linkul. Cine primește linkul intră din browser, fără cont; tu intri din listă, cu „Intră”. Apelul se încheie pentru toți din pagina lui sau din rândul din listă.',
      en: 'The Calls page creates a call and copies its link. Whoever gets the link joins from the browser, with no account; you join from the list, with “Join”. You end the call for everyone from its page or from its row in the list.',
    },
    features: ['apeluri.view'],
  },
  {
    publishedAt: '2026-10-24T20:00:00+03:00',
    title: {
      ro: 'Emailurile ANAF despre SPV se sortează singure',
      en: 'ANAF emails about the SPV sort themselves',
    },
    body: {
      ro: 'Emailurile „Documente noi SPV” care conțin doar fișa rol sau duplicate se arhivează singure. Recipisele primesc eticheta ANAF, iar o recipisă D301 sau D390 apare în Declarații ca „Recipisă primită”. Orice alt document din SPV (decizii, notificări, erori) și răspunsurile la formularul 150 rămân necitite, cu eticheta ANAF, și îți vin ca alertă.',
      en: '“Documente noi SPV” emails that only carry the fiscal record or duplicates archive themselves. Receipts get the ANAF label, and a D301 or D390 receipt shows in Declarations as “Receipt received”. Any other SPV document (decisions, notices, errors) and the answers to form 150 stay unread, labelled ANAF, and reach you as an alert.',
    },
    features: ['facturi.declaratii'],
  },
  {
    publishedAt: '2026-10-24T18:00:00+03:00',
    title: {
      ro: 'Indexul din SPV se păstrează lângă declarație',
      en: 'The SPV index is kept next to the declaration',
    },
    body: {
      ro: 'Sub D301 și D390 e un câmp „Index SPV”. Pui acolo indexul primit după upload și luna apare ca depusă; din acel moment nu mai primești memento-ul de termen pentru ea.',
      en: 'D301 and D390 each have an “SPV index” field. Enter the index you get after the upload and the month shows as filed; the deadline reminder for it stops.',
    },
    features: ['facturi.declaratii'],
  },
  {
    publishedAt: '2026-10-24T16:00:00+03:00',
    title: {
      ro: 'Abonamentele nu mai intră singure în declarații',
      en: 'Subscriptions no longer go into declarations on their own',
    },
    body: {
      ro: 'Un abonament recurent apare în Declarații ca „fără factură” și nu intră în D301 sau D390 până nu îi pui cu creionul numărul, data și suma de pe factura reală. D301 se completează acum pe codul de TVA primit la înregistrarea pe art. 317, ca la contabilă.',
      en: 'A recurring subscription shows up in Declarations as “no invoice” and stays out of D301 and D390 until you use the pencil to set the number, date and amount from the real invoice. D301 is now filled in on the VAT code issued for the art. 317 registration, as the accountant does.',
    },
    features: ['facturi.declaratii'],
  },
  {
    publishedAt: '2026-10-24T14:00:00+03:00',
    title: {
      ro: 'Liniile din declarații se pot corecta pe loc',
      en: 'Declaration lines can be corrected in place',
    },
    body: {
      ro: 'În Facturi → Declarații, creionul de pe fiecare rând îți lasă să pui numărul facturii, data și suma de pe factura reală, sau să scoți linia când furnizorul a facturat deja TVA. Formularele ies acum cu majuscule, iar la D390 câmpul Luna apare completat.',
      en: 'In Invoices → Declarations, the pencil on each row lets you set the invoice number, date and amount from the real invoice, or take the line out when the supplier already charged VAT. The forms now come out in capitals, and the Month field in D390 is filled in.',
    },
    features: ['facturi.declaratii'],
  },
  {
    publishedAt: '2026-10-24T12:00:00+03:00',
    title: {
      ro: 'D301 și D390 se descarcă acum ca PDF pentru SPV',
      en: 'D301 and D390 now download as a PDF for SPV',
    },
    body: {
      ro: 'În Facturi → Declarații, butonul PDF îți dă formularul ANAF deja completat. Îl deschizi în Adobe Acrobat Reader, apeși Validare, semnezi și îl încarci în SPV. Am corectat și XML-ul după declarațiile depuse de contabilă: la D301 serviciile din UE apar și la secțiunea 4, nu doar la 4.1, iar la D390 sumele sunt în lei întregi, câte un rând pe furnizor.',
      en: 'In Invoices → Declarations, the PDF button gives you the ANAF form already filled in. Open it in Adobe Acrobat Reader, press Validare, sign and upload it to SPV. The XML is also fixed to match the returns the accountant filed: in D301 EU services now appear in section 4 as well, not only in 4.1, and D390 amounts are whole lei, one row per supplier.',
    },
    features: ['facturi.declaratii'],
  },
  {
    publishedAt: '2026-10-23T02:00:00+03:00',
    title: {
      ro: 'Asistentul poate folosi și modelele de pe serverul nostru',
      en: 'The assistant can also use the models on our own server',
    },
    body: {
      ro: 'În Setări → Asistent apare „Local (llama.cpp)”, oprit implicit. Pornit și cu adresa serverului completată, modelele lui apar în lista din Asistent. Nu primesc tool-uri și nici datele din aplicație, deci sunt bune pentru texte: emailuri, rezumate, liste pe care le lipești în mesaj. Răspund încet; dacă serverul e oprit, mesajul îți spune asta.',
      en: 'Settings → Assistant has a “Local (llama.cpp)” card, off by default. Switched on and given the server address, its models show up in the Assistant list. They get no tools and none of the app data, so they are good for text: emails, summaries, lists you paste into the message. They answer slowly; if the server is off, the message says so.',
    },
    features: ['setari.asistent'],
  },
  {
    publishedAt: '2026-10-19T11:40:00+03:00',
    title: {
      ro: 'Mesajele arată ca în WhatsApp',
      en: 'Messages look like WhatsApp',
    },
    body: {
      ro: 'Fiecare mesaj are bula lui, ale tale în dreapta, cu ora și bifele: una pentru trimis, două pentru livrat, două albastre pentru văzut. Conversația se deschide la ultimul mesaj și rămâne acolo cât se încarcă pozele. Pozele din fir se încarcă mici și rămân pe telefon; la deschidere vezi originalul.',
      en: 'Each message has its own bubble, yours on the right, with the time and the ticks: one for sent, two for delivered, two blue ones for seen. A conversation opens at the last message and stays there while the photos load. Photos in the thread load small and stay on the phone; opening one shows the original.',
    },
    features: ['mesaje.view'],
  },
  {
    publishedAt: '2026-10-19T09:30:00+03:00',
    title: {
      ro: 'Fiecare prospect are un responsabil',
      en: 'Every prospect has an owner',
    },
    body: {
      ro: 'În Clienți → Prospectare, coloana Responsabil spune care coleg lucrează pe firmă, ca să nu o sune doi oameni. „Ai mei” arată doar prospecții tăi. Schimbarea responsabilului apare în Istoric.',
      en: 'In Clients → Prospecting, the Owner column says which colleague works the company, so two people do not call it. “Mine” shows only your prospects. A change of owner shows up in History.',
    },
    features: ['clienti.view'],
  },
  {
    publishedAt: '2026-10-19T09:29:00+03:00',
    title: {
      ro: 'Ghid pentru Profilul meu și ecrane care încap pe telefon',
      en: 'A guide for My profile, and screens that fit the phone',
    },
    body: {
      ro: 'Profilul meu are „?” lângă titlu, cu pașii pentru limbă, parolă și notificări. Echipa și Modulele nu mai fug în lateral pe telefon: tabelul se derulează în cardul lui. Pe Investiții, când lipsesc cheile de date, pagina spune de ce nu apar prețurile.',
      en: 'My profile has a “?” next to the title, with the steps for language, password and notifications. Team and Modules no longer slide sideways on the phone: the table scrolls inside its card. On Investments, when the data keys are missing, the page says why prices do not show.',
    },
    features: [],
  },
  {
    publishedAt: '2026-10-19T07:30:00+03:00',
    title: {
      ro: 'Contractele se descarcă și goale',
      en: 'Contracts can be downloaded blank',
    },
    body: {
      ro: 'În Facturi → Contracte, cardul cu șabloane are trei butoane: contractul, anexa de prețuri și actul adițional, ca PDF fără un client anume. Datele firmei și termenii sunt completați, câmpurile clientului rămân linii punctate.',
      en: 'In Invoices → Contracts, the templates card has three buttons: the contract, the price annex and the addendum, as a PDF without a particular client. The company details and terms are filled in, the client\'s fields are dotted lines.',
    },
    features: ['facturi.contracte'],
  },
  {
    publishedAt: '2026-10-19T07:29:00+03:00',
    title: {
      ro: 'Token-ul ANAF se reînnoiește și la cerere',
      en: 'The ANAF token can be refreshed on demand',
    },
    body: {
      ro: 'Alerta „Token-ul ANAF expiră” apare doar dacă mai sunt sub 24 de ore, adică doar când reînnoirea automată de noapte n-a reușit. Până acum venea cu o săptămână înainte, deși nu era nimic de făcut. Pe cardul ANAF din Setări e și un buton „Reînnoiește acum”.',
      en: 'The “ANAF token expires” alert only appears with under 24 hours left, that is only when the automatic overnight refresh has failed. Until now it came a week ahead, with nothing to do. The ANAF card in Settings also has a “Refresh now” button.',
    },
    features: ['facturi.anaf'],
  },
  {
    publishedAt: '2026-10-13T08:20:00+03:00',
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
