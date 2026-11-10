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
    publishedAt: '2026-11-10T22:00:00+02:00',
    title: {
      ro: 'Clienți: fiecare prospect are un responsabil, iar lucrul pe ei e mai rapid',
      en: 'Clients: every prospect has an owner, and working them is faster',
    },
    body: {
      ro: 'Un prospect liber îl iei cu „Îl iau eu”; fără activitate, se eliberează singur. Transferi, ceri transfer sau acces, adaugi colaboratori. Fișa are oameni de contact, notițe cu @mențiuni, task-uri și pasul următor. Salvezi vederi filtrate, treci între listă, board și prognoză, aduni prospecți în liste și suni din sesiunea de apeluri. Importul și exportul merg din Excel, iar dublurile se unesc din Sănătate. Secvențele de email primesc pași de apel, task și LinkedIn, variante A/B și pauză la bounce.',
      en: 'You take a free prospect with “I’ll take it”; with no activity, it is released on its own. Transfer, ask for a transfer or access, add collaborators. The sheet has contact people, notes with @mentions, tasks and the next step. Save filtered views, switch between list, board and forecast, gather prospects in lists and call from the call session. Import and export run from Excel, and duplicates are merged from Health. Email sequences get call, task and LinkedIn steps, A/B variants and a pause on bounces.',
    },
    features: ['clienti.view', 'email.bulk'],
  },
  {
    publishedAt: '2026-11-09T21:00:00+02:00',
    title: {
      ro: 'Pe telefon, meniul „Mai mult” se derulează până jos',
      en: 'On the phone, the “More” menu scrolls all the way down',
    },
    body: {
      ro: 'Meniul deschis din „Mai mult” nu se derula când țineai degetul pe listă, așa că paginile de la final, ca Setările, nu se vedeau. Acum se derulează de oriunde.',
      en: 'The menu opened from “More” did not scroll with a finger on the list, so the pages at the end, such as Settings, were out of reach. It now scrolls from anywhere.',
    },
    features: [],
  },
  {
    publishedAt: '2026-11-09T20:02:00+02:00',
    title: {
      ro: 'Echipă: ștergi un om invitat sau dezactivat, vezi invitațiile expirate',
      en: 'Team: delete an invited or disabled person, see expired invitations',
    },
    body: {
      ro: 'Din meniul unui om invitat sau dezactivat ai acum Șterge: dispare din echipă, iar adresa lui poate fi invitată din nou. Un om activ se dezactivează întâi. Cine n-a intrat la timp apare cu „Invitație expirată” și primește alt link din „Retrimite invitația”.',
      en: 'The menu of an invited or disabled person now has Delete: they leave the team and their address can be invited again. An active person is disabled first. Someone who did not sign in in time shows as “Invitation expired” and gets a new link from “Resend invitation”.',
    },
    features: ['echipa.administrare'],
  },
  {
    publishedAt: '2026-11-09T20:01:00+02:00',
    title: {
      ro: 'Email: fiecare vede doar mesajele de pe cutiile lui, chiar dacă subiectul e același',
      en: 'Email: everyone sees only the messages on their own mailboxes, even with the same subject',
    },
    body: {
      ro: 'Două emailuri de la același expeditor, cu același subiect, trimise pe cutiile a doi colegi, ajungeau în același fir și fiecare îl vedea și pe al celuilalt. Acum sunt fire separate, iar un fir deschis arată doar mesajele de pe cutiile tale.',
      en: 'Two emails from the same sender with the same subject, sent to two colleagues\' mailboxes, ended up in one thread and each saw the other\'s. They are now separate threads, and an open thread shows only the messages on your mailboxes.',
    },
    features: ['email.view'],
  },
  {
    publishedAt: '2026-11-09T20:00:00+02:00',
    title: {
      ro: 'Aplicația Android se actualizează din Setări',
      en: 'The Android app updates from Settings',
    },
    body: {
      ro: 'În aplicație, Setări are acum cardul Aplicație Android cu versiunea instalată și butonul „Actualizează aplicația”, care descarcă versiunea nouă în browser. Nu mai trebuie să deschizi site-ul separat.',
      en: 'In the app, Settings now has the Android app card with the installed version and an “Update the app” button that downloads the new version in the browser. No need to open the site separately anymore.',
    },
    features: ['setari.view'],
  },
  {
    publishedAt: '2026-11-09T18:00:00+02:00',
    title: {
      ro: 'Calendar: vederi Zi și Program, tragi ca să muți sau să creezi, o ocurență a unei serii se mută sau se anulează singură',
      en: 'Calendar: Day and Schedule views, drag to move or create, one occurrence of a series can be moved or canceled on its own',
    },
    body: {
      ro: 'Calendarul are acum vederile Zi, Săptămână, Lună și Program. Tragi un eveniment ca să-l muți, tragi de marginea de jos ca să-i schimbi durata și tragi un interval gol ca să creezi unul; pe telefon ții apăsat. La un eveniment care se repetă alegi dacă schimbi doar acea zi, aceasta și următoarele sau toată seria. După orice schimbare apare „Anulează”, iar cât e mesajul pe ecran merge și Ctrl+Z. Poți pune până la 5 notificări și repetări lunare („a patra joi”) sau anuale, iar sub formular vezi regula scrisă în cuvinte. Evenimentul se deschide întâi la citit, cu Editează, Duplică și Șterge; ai și căutare în calendar (tasta /) și scurtături (c, t, n, p, d, w, m, a). Calendarele colegilor se aleg dintr-un singur buton, „Calendare”, iar programările de pe site au butoanele „Intră în apel” și „Copiază linkul”. Întâlnirile care se repetă create înainte de 25 octombrie apar din nou la ora la care le-ai creat (se mutaseră cu o oră). Plățile recurente apar în calendar doar la cei care văd cheltuielile. Fiecare om are culoarea lui, aceeași ca în Mesaje, iar un eveniment o ia implicit; din formular poți alege una din 8 culori.',
      en: 'The calendar now has Day, Week, Month and Schedule views. Drag an event to move it, drag its bottom edge to change the length, and draw over an empty range to create one; on a phone, press and hold. For a repeating event you choose whether to change just that day, this and the following ones, or the whole series. After any change “Undo” appears, and Ctrl+Z works while the message is on screen. You can add up to 5 notifications and monthly (“fourth Thursday”) or yearly repeats, and under the form you see the rule written out. An event opens for reading first, with Edit, Duplicate and Delete; there is also calendar search (the / key) and shortcuts (c, t, n, p, d, w, m, a). Colleagues\' calendars are picked from a single “Calendars” button, and bookings from the site have “Join call” and “Copy link”. Recurring meetings created before 25 October show again at the hour they were created (they had drifted an hour). Recurring payments appear in the calendar only for people who see expenses. Each person has their own colour, the same as in Messages, and events take it by default; the form offers 8 colours to pick from.',
    },
    features: ['calendar.view'],
  },
  {
    publishedAt: '2026-11-09T12:00:00+02:00',
    title: {
      ro: 'Notițe: editor cu formatare, liste de bifat, culori, versiuni; în Plan tragi obiectivele între niveluri',
      en: 'Notes: editor with formatting, checklists, colors, versions; in Plan you drag goals between tiers',
    },
    body: {
      ro: 'Notița se scrie într-un editor cu titluri, liste, liste de bifat, citate și cod. Apeși / ca să alegi un bloc, selectezi text ca să-l faci aldin sau link, iar salvarea se face singură, fără buton. Notițele vechi se deschid ca până acum și nu pierd nimic. Fiecare notiță poate avea o culoare și etichete, se poate fixa, arhiva sau muta în Coș, unde stă 30 de zile și o poți restaura. După orice acțiune apare „Anulează”. Din ⋯ vezi versiunile mai vechi ale notiței și o aduci înapoi pe cea dorită. Notițele apar și în căutarea Ctrl K, doar ale tale. Bifezi mai multe notițe odată ca să le arhivezi, să le colorezi sau să le pui o etichetă. În Plan tragi un obiectiv dintr-un nivel în altul, iar Enter în titlul unui obiectiv deschis adaugă unul nou sub el. În Wishlist, Personal / Firmă și Necesități / Plăceri sunt acum în butonul Filtru.',
      en: 'A note is written in an editor with headings, lists, checklists, quotes and code. Press / to pick a block, select text to make it bold or a link, and saving happens on its own, with no button. Old notes open as before and lose nothing. Each note can have a color and labels, and can be pinned, archived or moved to the Trash, where it stays for 30 days and can be restored. “Undo” appears after any action. From ⋯ you see the older versions of a note and bring back the one you want. Notes also show up in Ctrl K search, yours only. Tick several notes at once to archive them, color them or add a label. In Plan you drag a goal from one tier to another, and Enter in the title of an open goal adds a new one under it. In Wishlist, Personal / Company and Needs / Wants are now under the Filter button.',
    },
    features: ['notite.view'],
  },
  {
    publishedAt: '2026-11-09T11:30:00+02:00',
    title: {
      ro: 'Arhivă: Coș cu restaurare, anulare, previzualizare cu săgeți, selecție multiplă și tragere',
      en: 'Archive: Trash with restore, undo, preview with arrows, multi-select and drag',
    },
    body: {
      ro: 'Ștergerea nu mai cere confirmare: elementul trece în Coș, unde stă 30 de zile și îl restaurezi, iar un folder se șterge cu tot ce are în el. Fișierele șterse înainte de această actualizare apar acum în Coș pentru 30 de zile, apoi dispar definitiv. După ștergere, mutare sau redenumire apare „Anulează”. Un fișier se deschide peste pagină, cu ← → între fișierele folderului, iar „Detalii” arată locul lui, cine l-a creat și cine are acces. Bifezi mai multe elemente (Ctrl sau Shift + click, pe telefon apăsare lungă) și le muți, le ștergi sau le descarci, ori le tragi peste un folder. Fișierele încărcate apar într-un panou cu progres pe fiecare, iar unul eșuat se reîncearcă. Lista arată acum toate fișierele folderului, pe pagini, nu doar primele 50. Folderele pot avea culoare, ai „Recente” și „Cu stea”, iar căutarea găsește și foldere, fără să conteze diacriticele.',
      en: 'Deleting no longer asks for confirmation: the item goes to the Trash, where it stays for 30 days and can be restored, and a folder is deleted with everything in it. Files deleted before this update now appear in the Trash for 30 days, then disappear for good. After a delete, move or rename, “Undo” appears. A file opens over the page, with ← → between the files of the folder, and “Details” shows where it is, who created it and who has access. Tick several items (Ctrl or Shift + click, long press on a phone) to move, delete or download them, or drag them onto a folder. Uploaded files appear in a panel with progress on each, and a failed one can be retried. The list now shows every file in the folder, in pages, not only the first 50. Folders can have a color, there are “Recent” and “Starred”, and search finds folders too, whatever the diacritics.',
    },
    features: ['arhiva.view'],
  },
  {
    publishedAt: '2026-11-06T12:30:00+02:00',
    title: {
      ro: 'Email: „Trimise” arată și cutiile comune, cu filtrul „Trimis de”',
      en: 'Email: “Sent” covers shared mailboxes, with a “Sent by” filter',
    },
    body: {
      ro: 'În „Trimise” vezi tot ce a plecat de pe cutiile tale, nu doar ce ai trimis tu: pe o cutie comună, ca outreach, apar și emailurile colegilor și ale secvențelor. Sub adresă scrie cine a trimis, iar filtrul „Trimis de” te lasă să vezi doar ce ai trimis tu, ce a trimis un coleg sau ce a plecat automat.',
      en: 'In “Sent” you see everything that left your mailboxes, not only what you sent: on a shared mailbox such as outreach, colleagues’ and sequences’ emails show up too. Under the address it says who sent it, and the “Sent by” filter shows only what you sent, what a colleague sent, or what went out automatically.',
    },
    features: ['email.trimitere'],
  },
  {
    publishedAt: '2026-11-06T11:30:00+02:00',
    title: {
      ro: 'Email: „Trimise” se deschide pentru toți cei care trimit',
      en: 'Email: “Sent” opens for everyone who sends',
    },
    body: {
      ro: 'Folderul „Trimise” dădea eroare la încărcarea istoricului pentru cine nu avea Trimitere Bulk. Acum îți arată emailurile trimise de tine, cu starea lor; campaniile și trimiterile colegilor rămân la cei cu Trimitere Bulk.',
      en: 'The “Sent” folder failed to load its history for anyone without Bulk send. It now shows the emails you sent, with their state; campaigns and colleagues’ sends stay with whoever has Bulk send.',
    },
    features: ['email.trimitere'],
  },
  {
    publishedAt: '2026-11-04T17:30:00+02:00',
    title: {
      ro: 'Secvențe: înscrierile în ordine, pașii numărați corect',
      en: 'Sequences: enrollments in order, steps counted right',
    },
    body: {
      ro: 'Lista de înscrieri începe cu cei neîncepuți, apoi activii, completații și opriții, iar în fiecare grup pasul crește de sus în jos. Bara unui pas arată câți l-au primit, nu doar câți au rămas la el, deci Pas 1 nu mai scade când oamenii trec la Pas 2. O adresă cu bounce, spam sau dezabonare trece pe Oprit la următoarea rulare a secvenței, nu abia când i-ar fi venit rândul; oricum nu primea nimic.',
      en: 'The enrollments list starts with those not started, then active, completed and stopped, and inside each group the step goes up from top to bottom. A step’s bar shows how many received it, not only how many are still on it, so Step 1 no longer drops when people move on to Step 2. An address that bounced, complained or unsubscribed moves to Stopped on the sequence’s next run instead of when its turn would have come; it was not getting anything either way.',
    },
    features: ['email.view'],
  },
  {
    publishedAt: '2026-11-04T15:00:00+02:00',
    title: {
      ro: 'Mesaje: la zi pe toate device-urile, inițiale cu bulină, membri în grupuri',
      en: 'Messages: current on every device, initials with a dot, group members',
    },
    body: {
      ro: 'Ce scrii de pe telefon apare pe dash fără reîncărcare, și invers, chiar dacă tab-ul a stat în fundal. Când citești sau răspunzi pe dash, notificarea conversației dispare de pe telefon la următoarea deschidere a aplicației, la fel când mesajul necitit e șters. O conversație lungă se deschide la capăt, iar ziua de sus nu se mai adună una sub alta: Ieri lasă locul lui Azi. Fiecare om are inițialele în culoarea lui, cu bulină verde când e în aplicație; în grupuri le vezi lângă primul mesaj din serie. Acțiunile unui mesaj stau sub săgeata din colțul lui, ca în WhatsApp, nu într-o bară peste conversație. Cine a făcut grupul adaugă și scoate oameni din panoul conversației.',
      en: 'What you write on the phone shows on the dash without a reload, and the other way round, even after the tab sat in the background. When you read or reply on the dash, the conversation’s notification leaves the phone the next time you open the app, and so it does when the unread message is deleted. A long conversation opens at its end, and the day at the top no longer piles up: Yesterday makes room for Today. Everyone has their initials in their own colour, with a green dot while they are in the app; in groups you see them beside the first message of a series. A message’s actions sit under the arrow in its corner, as in WhatsApp, not in a bar over the conversation. Whoever made a group adds and removes people from the conversation panel.',
    },
    features: ['mesaje.view'],
  },
  {
    publishedAt: '2026-11-04T12:30:00Z',
    title: {
      ro: 'Clienți: notițele se văd la orice zoom, arhiva e a fiecăruia',
      en: 'Clients: notes show at any zoom, the archive is your own',
    },
    body: {
      ro: 'Coloana Notițe din Prospectare nu mai dispare când ecranul e mai îngust sau zoom-ul mai mare: pe un tabel îngust, notița și statusul trec sub numele firmei. Scorul stă sub prioritate, responsabilul sub status, iar angajații și cifra de afaceri într-o singură coloană, ca să încapă mai mult pe rând. Arhivarea e acum a fiecăruia: un prospect pe care îl arhivezi dispare doar din lista ta, colegii îl văd în continuare.',
      en: 'The Notes column in Prospects no longer disappears on a narrower screen or a larger zoom: on a narrow table, the note and the status move under the company name. The score sits under the priority, the owner under the status, and employees and turnover share one column, so more fits on a row. Archiving is now personal: a prospect you archive disappears only from your list, your colleagues still see it.',
    },
    features: ['clienti.prospectare'],
  },
  {
    publishedAt: '2026-11-04T09:40:00Z',
    title: {
      ro: 'Email: trimitere anulabilă, ciorne automate și setările mele',
      en: 'Email: undoable send, automatic drafts and my settings',
    },
    body: {
      ro: 'Fiecare mesaj stă acum pe o singură linie, cu un fragment din text, iar acțiunile apar la hover. După „Trimite” ai 5 secunde să dai „Anulează”, iar mesajul se întoarce în ciornă. Ferestrele de compunere salvează ciorna singure, se pot minimiza, iar răspunsul se scrie în pagina firului; Ctrl+Enter trimite. În fir, cel mai nou mesaj e sus și cele vechi sunt restrânse, iar ‹ › te mută între emailuri. Căutarea are filtre (De la, Necitit, perioadă) și sugestii, iar „Descarcă tot” aduce atașamentele unui mesaj într-un zip. Un email HTML lat se micșorează să încapă pe ecranul telefonului. În „Setările mele” ai semnătura ta pe fiecare cutie, un plafon propriu de outreach, mai mic decât al firmei, și etichetele și regulile tale. Un mesaj către o adresă dezabonată e refuzat acum pe orice cale de trimitere, iar chip-ul adresei se face roșu încă de când o scrii. La Trimise, cifrele de sus sunt și filtre (click pe Deschideri arată doar emailurile deschise), iar sursa, reacția, starea și perioada stau într-un singur buton Filtre.',
      en: 'Each message is now a single line with a preview of the text, and the actions show on hover. After “Send” you have 5 seconds to press “Undo”, and the message goes back to a draft. Compose windows save the draft by themselves and can be minimized, and a reply is written on the thread page; Ctrl+Enter sends. In a thread, the newest message is on top and older ones are collapsed, and ‹ › move you between emails. Search has filters (From, Unread, period) and suggestions, and “Download all” brings a message’s attachments as a zip. A wide HTML email shrinks to fit a phone screen. In “My settings” you have your own signature per mailbox, your own outreach cap, lower than the company’s, and your own labels and rules. A message to an unsubscribed address is now refused on every way of sending, and its chip turns red as soon as you type it. In Sent, the numbers on top are filters too (click Opens to see only opened emails), and source, reaction, status and period sit in one Filters button.',
    },
    features: ['email.view', 'email.trimitere', 'email.setari_proprii'],
  },
  {
    publishedAt: '2026-11-03T12:00:00+02:00',
    title: {
      ro: 'Mesaje: răspunsuri, reacții și obiecte trimise din aplicație',
      en: 'Messages: replies, reactions and objects sent from the app',
    },
    body: {
      ro: 'Poți răspunde la un mesaj (citatul te duce la original) și reacționa cu un emoji; pe telefon glisezi mesajul spre dreapta ca să răspunzi, iar apăsarea lungă deschide acțiunile. La ștergere ai 6 secunde să dai „Anulează”. Data de sus te lasă să sari la azi, la săptămâna trecută sau la o dată aleasă, iar linia „mesaje noi” arată unde ai rămas. Panoul conversației are membri, notificări oprite, poze, fișiere și căutare. Un client, o factură, un fir de email, un eveniment, un fișier din Arhivă sau o notiță se trimit în Mesaje din meniul lor, iar cine nu are acces la original poate apăsa „Cere acces”. În Profilul meu, la Afișare, apar „Mișcare” și „Ascunde sumele”.',
      en: 'You can reply to a message (the quote takes you to the original) and react with an emoji; on a phone you swipe a message right to reply, and a long press opens its actions. When you delete, you have 6 seconds to press “Undo”. The date at the top lets you jump to today, last week or a date you pick, and the “new messages” line shows where you left off. The conversation panel has members, mute, photos, files and search. A client, an invoice, an email thread, an event, an Archive file or a note can be sent to Messages from its menu, and whoever cannot open the original can press “Ask for access”. In My profile, under Display, you find “Motion” and “Hide amounts”.',
    },
    features: ['mesaje.view'],
  },
  {
    publishedAt: '2026-11-01T08:49:00+02:00',
    title: {
      ro: 'Filtrele goale se resetează dintr-un click',
      en: 'Empty filters reset in one click',
    },
    body: {
      ro: 'La Licitații, la istoricul Alertelor filtrat pe o regulă și la piața din Investiții, când filtrul nu lasă nimic pe ecran ai un buton care îl resetează. După ce adaugi un eveniment în Calendar, „Vezi” din mesajul de confirmare te duce la ziua lui, iar după ce transformi un prospect în client, te duce la Clienți.',
      en: 'In Tenders, in the Alerts history filtered by a rule and in the Investments market, when the filter leaves nothing on screen a button resets it. After you add a Calendar event, “View” in the confirmation takes you to its day, and after you turn a prospect into a client it takes you to Clients.',
    },
    features: [],
  },
  {
    publishedAt: '2026-11-01T08:38:00+02:00',
    title: {
      ro: 'Paginile se încarcă din meniu, înainte de click',
      en: 'Pages start loading from the menu, before you click',
    },
    body: {
      ro: 'Când treci cu mouse-ul peste o pagină din meniu, primele ei date se cer deja, așa că la click apar aproape imediat. Listele goale arată acum la fel peste tot, iar la Notițe, când căutarea nu găsește nimic, ai un buton care o golește. În Arhivă, după ce creezi un folder, „Vezi” din mesajul de confirmare te duce direct în el.',
      en: 'When you hover a page in the menu, its first data is already requested, so it shows almost at once when you click. Empty lists now look the same everywhere, and in Notes, when a search finds nothing, a button clears it. In Archive, after you create a folder, “View” in the confirmation takes you straight into it.',
    },
    features: [],
  },
  {
    publishedAt: '2026-10-31T12:05:00+02:00',
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
