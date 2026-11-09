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
        ro: 'Fiecare mesaj e pe o linie, cu un fragment din text; cele necitite sunt îngroșate. Deschide unul din listă; se marchează citit doar pentru tine. La hover, acțiunile (arhivează, șterge, citit / necitit, amână) apar în locul datei.',
        en: 'Each message is on one line, with a preview of the text; unread ones are bold. Open one from the list; it is marked as read only for you. On hover, the actions (archive, delete, read / unread, snooze) replace the date.',
      },
      {
        ro: 'Într-un fir, mesajele vechi sunt restrânse sub „N mesaje mai vechi”; apasă ca să le vezi. ‹ › din antet te mută la emailul dinainte sau de după, fără să revii în listă.',
        en: 'In a thread, older messages are collapsed under “N older messages”; press to see them. ‹ › in the header move you to the previous or next email without going back to the list.',
      },
      {
        ro: 'Un email HTML lat se micșorează să încapă în ecran, mai ales pe telefon; „Mărime reală” îl arată cum a fost trimis.',
        en: 'A wide HTML email shrinks to fit the screen, mostly on a phone; “Actual size” shows it as it was sent.',
      },
      {
        ro: '„Trimise” arată ce ai trimis tu și tot ce a plecat de pe cutiile tale, inclusiv secvențele, cu starea fiecăruia (livrat, deschis, click). Pe o cutie comună, filtrul „Trimis de” arată doar ce ai trimis tu, ce a trimis un coleg sau ce a plecat automat. Cine are Trimitere Bulk vede toate trimiterile firmei.',
        en: '“Sent” lists what you sent and everything that left your mailboxes, sequences included, with the state of each (delivered, opened, clicked). On a shared mailbox, the “Sent by” filter shows only what you sent, what a colleague sent, or what went out automatically. Whoever has Bulk send sees every send of the company.',
      },
      {
        ro: 'Scrie în câmpul de căutare ca să cauți în subiect și în conținut. Apar sugestii (adrese și fire), iar filtrele De la, Necitit, Are atașament, Cu stea și Perioadă îngustează rezultatele.',
        en: 'Type in the search field to search the subject and the content. Suggestions appear (addresses and threads), and the filters From, Unread, Has attachment, Starred and Period narrow the results.',
      },
      {
        ro: 'Selectează mesaje cu bifa, cu Ctrl + click sau cu Shift + click pentru un interval; acțiunile apar în bara de jos. Esc golește selecția.',
        en: 'Select messages with the checkbox, Ctrl + click, or Shift + click for a range; the actions show in the bar at the bottom. Esc clears the selection.',
      },
      {
        ro: 'Click dreapta pe un mesaj deschide același meniu: arhivează, citit / necitit, spam, șterge. Pe telefon, glisează spre stânga ca să-l ștergi.',
        en: 'Right-click a message for the same menu: archive, read / unread, spam, delete. On a phone, swipe left to delete it.',
      },
      {
        ro: 'După arhivare, spam sau ștergere, „Anulează” din mesajul de jos pune firul înapoi unde era.',
        en: 'After archiving, spam or delete, “Undo” in the message at the bottom puts the thread back where it was.',
      },
      {
        ro: 'Atașamentele se deschid peste pagină; treci la următorul cu ← →, închizi cu Esc. „Descarcă tot” aduce atașamentele unui mesaj într-un zip.',
        en: 'Attachments open over the page; move to the next with ← →, close with Esc. “Download all” brings a message’s attachments as a zip.',
      },
      {
        ro: 'Scurtături în listă: j / k între mesaje, o sau Enter deschide, x selectează, s pune steaua, e arhivează, # șterge, ! marchează spam, Shift+I / Shift+U citit / necitit, / mută cursorul în căutare, c compune.',
        en: 'Shortcuts in the list: j / k between messages, o or Enter opens, x selects, s stars, e archives, # deletes, ! marks as spam, Shift+I / Shift+U read / unread, / moves to search, c composes.',
      },
      {
        ro: 'Scurtături în fir: r răspunde, a răspunde tuturor, f redirecționează, e arhivează, # șterge, j / k emailul următor sau anterior, u înapoi la listă. Apasă ? ca să le vezi pe toate.',
        en: 'Shortcuts in a thread: r replies, a replies to all, f forwards, e archives, # deletes, j / k next or previous email, u back to the list. Press ? to see them all.',
      },
      {
        ro: '„Amână” ascunde firul până la momentul ales; îl găsești între timp la „Amânate”.',
        en: '“Snooze” hides the thread until the time you pick; meanwhile it is under “Snoozed”.',
      },
      {
        ro: 'Un fir, sau doar un pasaj selectat din el, se trimite unui coleg cu „Trimite în Mesaje”.',
        en: 'A thread, or just a passage selected in it, goes to a colleague with “Send to Messages”.',
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
      ro: 'Mesajul pleacă de pe cutia pe care o alegi la expeditor, dintre cele pe care le ai. După „Trimite” mai ai 5 secunde să te răzgândești.',
      en: 'The message goes out from the mailbox you pick as sender, among the ones you have. After “Send” you have 5 seconds to change your mind.',
    },
    steps: [
      {
        ro: 'Apasă „Compune” (sau c) pentru un mesaj nou. Se deschide o fereastră în colț, pe care o poți minimiza ca să te uiți în altă parte; pe telefon se deschide pe tot ecranul.',
        en: 'Press “Compose” (or c) for a new message. A window opens in the corner, and you can minimize it to look elsewhere; on a phone it opens full screen.',
      },
      {
        ro: 'Răspunsul se scrie în pagina firului, deasupra mesajelor, nu într-o fereastră separată: „Răspunde” (r), „Răspunde tuturor” (a) sau „Redirecționează” (f). Destinatarii sunt chip-uri; poți adăuga și Cc.',
        en: 'A reply is written on the thread page, above the messages, not in a separate window: “Reply” (r), “Reply all” (a) or “Forward” (f). Recipients are chips; you can add Cc too.',
      },
      {
        ro: 'Ciorna se salvează singură pe măsură ce scrii. O găsești la „Draft-uri”, iar dacă o editezi în alt tab, aplicația te anunță și îți cere să o reîncarci.',
        en: 'The draft saves itself as you type. You find it under “Drafts”, and if you edit it in another tab, the app tells you and asks you to reload it.',
      },
      {
        ro: 'Verifică expeditorul: la un răspuns e deja cutia pe care a venit mesajul.',
        en: 'Check the sender: for a reply it is already the mailbox the message came to.',
      },
      {
        ro: 'Pentru un fișier, atașează-l de pe dispozitiv sau cu „Atașează din Arhivă”. La redirecționare, atașamentele mesajului original merg mereu cu el.',
        en: 'For a file, attach it from the device or with “Attach from the Archive”. When forwarding, the original message’s attachments always go with it.',
      },
      {
        ro: 'Trimite cu butonul sau cu Ctrl+Enter. Mesajul nu pleacă imediat: un mesaj jos spune „Se trimite” și are „Anulează”. Apăsat în 5 secunde, mesajul se întoarce în ciornă, deschis, ca să-l poți corecta.',
        en: 'Send with the button or Ctrl+Enter. The message does not leave at once: a message at the bottom says “Sending” and has “Undo”. Pressed within 5 seconds, the message goes back to a draft, open, so you can fix it.',
      },
      {
        ro: 'Dacă între timp a răspuns altcineva în fir, aplicația te anunță și nu trimite de două ori. Un mesaj către o adresă dezabonată este refuzat, indiferent pe ce cale pleacă.',
        en: 'If someone else replied in the thread meanwhile, the app tells you and does not send twice. A message to an unsubscribed address is refused, whichever way it goes out.',
      },
      {
        ro: 'Dacă trimiterea nu reușește, mesajul se întoarce în ciornă și poți încerca din nou.',
        en: 'If sending fails, the message goes back to a draft and you can try again.',
      },
    ],
  },
  {
    id: 'email-setarile-mele',
    route: '/email',
    feature: 'email.setari_proprii',
    title: {
      ro: 'Setările mele de email',
      en: 'My email settings',
    },
    summary: {
      ro: 'Ce e doar al tău în email: semnătura, plafonul de outreach, etichetele și regulile. Setările firmei rămân la cei care au acces la ele.',
      en: 'What is only yours in email: the signature, the outreach cap, the labels and the rules. The company’s settings stay with the people who have access to them.',
    },
    steps: [
      {
        ro: 'Deschide „Setările mele” din Email. Pentru fiecare cutie a ta poți scrie o semnătură proprie; goală, se folosește cea a cutiei.',
        en: 'Open “My settings” in Email. For each of your mailboxes you can write your own signature; left empty, the mailbox’s one is used.',
      },
      {
        ro: 'Plafonul zilnic de outreach îl poți coborî sub cel al firmei (scris lângă), niciodată peste el.',
        en: 'You can lower your daily outreach cap below the company’s (written next to it), never above it.',
      },
      {
        ro: 'Etichetele și regulile tale se văd doar de tine. O regulă proprie se aplică doar pe cutiile care sunt numai ale tale; pe o cutie comună n-ar avea cum să nu mute mesajul și pentru colegi.',
        en: 'Your labels and rules are visible only to you. A rule of your own applies only to mailboxes that are yours alone; on a shared mailbox it could not avoid moving the message for colleagues too.',
      },
      {
        ro: 'Dezabonările și lista de blocări se văd doar pentru citire; le schimbă cine are setările firmei.',
        en: 'Unsubscribes and the blocklist are read-only here; whoever has the company settings changes them.',
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
      ro: 'Mesajele ajung pe loc la cine are aplicația deschisă; ceilalți primesc notificare. Poți răspunde la un mesaj, reacționa și trimite obiecte din aplicație.',
      en: 'Messages reach whoever has the app open right away; the others get a notification. You can reply to a message, react and send objects from the app.',
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
        ro: 'Pe orice mesaj, al tău sau al altuia, ai „Răspunde” și reacțiile rapide: săgeata din colțul mesajului, care apare la trecerea mouse-ului, click dreapta (R răspunde, C copiază, E editează, Del șterge) sau, pe telefon, apăsare lungă. Tot pe telefon, glisezi mesajul spre dreapta ca să răspunzi.',
        en: 'On any message, yours or someone else’s, you get “Reply” and the quick reactions: the arrow in the message’s corner, which shows on hover, right-click (R reply, C copy, E edit, Del delete) or, on a phone, a long press. Also on a phone, swipe the message right to reply.',
      },
      {
        ro: 'Citatul din răspuns te duce la mesajul original și îl aprinde o clipă. Ștergerea nu mai cere confirmare: ai 6 secunde să apeși „Anulează”.',
        en: 'The quote in a reply takes you to the original message and lights it up for a moment. Deleting no longer asks to confirm: you have 6 seconds to press “Undo”.',
      },
      {
        ro: 'Data lipită sus e un meniu: de acolo sari la azi, la săptămâna trecută, la luna trecută sau la o dată aleasă. Linia „N mesaje noi” arată unde ai rămas, iar butonul rotund cu săgeată în jos te duce la capăt.',
        en: 'The date pinned at the top is a menu: jump to today, last week, last month or a date you pick. The “N new messages” line shows where you left off, and the round down arrow takes you to the end.',
      },
      {
        ro: 'Butoanele din antet deschid panoul conversației: membri, oprirea notificărilor, pozele și fișierele trimise și căutarea în conversație (găsește și fără diacritice). Cine a făcut grupul adaugă oameni din „Adaugă oameni” și îi scoate cu butonul de lângă nume. Bulina verde de pe inițiale arată cine e acum în aplicație.',
        en: 'The header buttons open the conversation panel: members, mute, photos and files sent, and search inside the conversation (it matches without diacritics too). Whoever made the group adds people with “Add people” and removes them with the button next to their name. The green dot on the initials shows who is in the app right now.',
      },
      {
        ro: 'Din câmpul de scris, ↑ te duce la ultimul mesaj; apoi ↑ ↓ mută, R, E, C și Del acționează, Esc te întoarce la câmp.',
        en: 'From the composer, ↑ takes you to the last message; then ↑ ↓ move, R, E, C and Del act, Esc returns to the composer.',
      },
      {
        ro: 'Un client, o factură, un fir de email, un eveniment, un fișier din Arhivă sau o notiță se trimite aici din meniul lui, la „Trimite în Mesaje”. În câmpul de scris, # caută obiecte ca Ctrl K, iar un link lipit din aplicație devine card.',
        en: 'A client, an invoice, an email thread, an event, an Archive file or a note is sent here from its menu, under “Send to Messages”. In the composer, # searches objects like Ctrl K, and a pasted link from the app becomes a card.',
      },
      {
        ro: 'Cardul unui client sau al unei facturi arată datele de acum, dacă ai acces la pagina lor. Emailul, evenimentul, fișierul și notița arată ce a văzut cel care le-a trimis, iar originalul se deschide doar pentru cine are deja acces. Dacă nu ai, cardul zice „N-ai acces”; „Cere acces” scrie în conversație un răspuns gata completat.',
        en: 'The card of a client or an invoice shows today’s data, if you have access to their page. An email, an event, a file and a note show what the sender saw, and the original opens only for whoever already has access. If you do not, the card says “No access”; “Ask for access” fills in a reply in the conversation.',
      },
      {
        ro: 'Din același meniu, un mesaj de-al tău se editează sau se șterge.',
        en: 'From the same menu, one of your messages is edited or deleted.',
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
      {
        ro: 'Deschis, un eveniment se poate trimite unui coleg cu „Trimite în Mesaje”.',
        en: 'An open event can be sent to a colleague with “Send to Messages”.',
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
    id: 'arhiva-fisiere',
    route: '/archive',
    feature: 'arhiva.view',
    title: {
      ro: 'Găsești, muți și ștergi fișiere în Arhivă',
      en: 'Finding, moving and deleting files in the Archive',
    },
    summary: {
      ro: 'Ce ștergi nu dispare pe loc: stă 30 de zile în Coș și îl poți aduce înapoi.',
      en: 'What you delete does not vanish at once: it stays in the Trash for 30 days and you can bring it back.',
    },
    steps: [
      {
        ro: 'Click pe un fișier îl deschide peste pagină, cu ← → între fișierele folderului. „Detalii” arată unde e, cine l-a creat și cine are acces.',
        en: 'Click a file to open it over the page, with ← → between the files of the folder. “Details” shows where it is, who created it and who has access.',
      },
      {
        ro: 'Ca să alegi mai multe, folosește Ctrl sau Shift + click (pe telefon, apasă lung). Bara de sus te lasă să le descarci, să le muți, să le pui o stea sau să le ștergi; le poți și trage peste un folder.',
        en: 'To pick several, use Ctrl or Shift + click (on a phone, long-press). The bar on top lets you download, move, star or delete them; you can also drag them onto a folder.',
      },
      {
        ro: 'După ștergere, mutare sau redenumire apare „Anulează” câteva secunde. Nu se cere confirmare.',
        en: 'After a delete, move or rename, “Undo” shows for a few seconds. Nothing asks for confirmation.',
      },
      {
        ro: 'Ce ai șters e în „Coș”: „Restaurează” îl pune înapoi în folderul lui, „Șterge definitiv” îl elimină pe loc. După 30 de zile dispare singur. Un folder șters se duce cu tot ce are în el. Fișierele șterse înainte de această actualizare sunt și ele în Coș, pentru 30 de zile.',
        en: 'What you deleted is in “Trash”: “Restore” puts it back in its folder, “Delete permanently” removes it at once. After 30 days it goes by itself. A deleted folder goes with everything in it. Files deleted before this update are in the Trash too, for 30 days.',
      },
      {
        ro: 'Fișierele încărcate apar într-un panou jos, cu progres pe fiecare; unul care a eșuat are „Reîncearcă”. Dacă Arhiva e plină, panoul spune asta.',
        en: 'Uploaded files show in a panel at the bottom, with progress on each; one that failed has “Retry”. If the Archive is full, the panel says so.',
      },
      {
        ro: 'Culoarea unui folder o schimbi din meniul lui. „Recente” arată ultimele 20 de fișiere, iar „Cu stea” ce ai marcat cu S.',
        en: 'You change a folder’s color from its menu. “Recent” shows the last 20 files, and “Starred” what you marked with S.',
      },
    ],
  },
  {
    id: 'notite-editor',
    route: '/notes',
    feature: 'notite.view',
    title: {
      ro: 'Scrii și organizezi notițe',
      en: 'Writing and organizing notes',
    },
    summary: {
      ro: 'Notițele sunt doar ale tale. Se salvează singure, deci nu există buton de salvare.',
      en: 'Notes are yours alone. They save on their own, so there is no Save button.',
    },
    steps: [
      {
        ro: 'Scrie în bara „Creează o notiță…”. Apasă / ca să alegi un bloc (titlu, listă, listă de bifat, citat, cod); selectează text ca să-l faci aldin, cursiv sau link. „Listă nouă” pornește direct cu o listă de bifat.',
        en: 'Write in the “Create a note…” bar. Press / to pick a block (heading, list, checklist, quote, code); select text to make it bold, italic or a link. “New list” starts straight with a checklist.',
      },
      {
        ro: 'Notița deschisă are linkul ei; „Copiază linkul” din ⋯ îl dă mai departe. O notiță goală, închisă, nu se păstrează.',
        en: 'An open note has its own link; “Copy link” in ⋯ hands it on. An empty note you close is not kept.',
      },
      {
        ro: 'Fixează notițele importante, dă-le o culoare și etichete, apoi filtrează după etichetă. „Gestionează etichetele” le redenumește sau le șterge pe toate notițele odată.',
        en: 'Pin the important notes, give them a color and labels, then filter by label. “Manage labels” renames or removes them on all notes at once.',
      },
      {
        ro: '„Arhivează” scoate notița din vedere fără s-o șteargă. Ștearsa stă 30 de zile în „Coș”, de unde o restaurezi. După fiecare acțiune apare „Anulează”.',
        en: '“Archive” takes a note out of sight without deleting it. A deleted one stays 30 days in “Trash”, from where you restore it. “Undo” appears after every action.',
      },
      {
        ro: 'Din ⋯ → „Versiuni” vezi cum arăta notița înainte și o restaurezi. Se păstrează o versiune la cel mult 10 minute de editare.',
        en: 'From ⋯ → “Versions” you see how the note looked before and restore it. One version is kept per 10 minutes of editing at most.',
      },
      {
        ro: 'Bifează mai multe notițe ca să le arhivezi, să le colorezi sau să le pui o etichetă deodată. Le găsești și cu Ctrl K.',
        en: 'Tick several notes to archive, color or label them at once. You also find them with Ctrl K.',
      },
    ],
  },
  {
    id: 'plan-obiective',
    route: '/notes',
    feature: 'notite.view',
    title: {
      ro: 'Muți obiectivele între niveluri în Plan',
      en: 'Moving goals between tiers in Plan',
    },
    summary: {
      ro: 'Planul e pe patru niveluri; un obiectiv poate trece dintr-unul în altul fără să-l scrii din nou.',
      en: 'The plan has four tiers; a goal can move from one to another without writing it again.',
    },
    steps: [
      {
        ro: 'Pe tabul „Plan”, ia obiectivul de mâner (apare când treci cu mouse-ul peste el; pe telefon, apasă lung) și lasă-l în alt nivel sau în alt loc din același nivel.',
        en: 'On the “Plan” tab, take the goal by its handle (it shows when you hover; on a phone, long-press) and drop it in another tier or another place in the same tier.',
      },
      {
        ro: 'Fără mouse: Space sau Enter pe mâner ca să iei obiectivul, săgețile îl mută, Space îl lasă jos, Esc anulează.',
        en: 'Without a mouse: Space or Enter on the handle to pick the goal up, arrows move it, Space drops it, Esc cancels.',
      },
      {
        ro: 'Într-un obiectiv deschis, Enter în titlu adaugă unul nou chiar sub el, în același nivel, ca să scrii mai multe la rând.',
        en: 'In an open goal, Enter in the title adds a new one right under it, in the same tier, so you can write several in a row.',
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
        ro: 'Din meniul rândului, „Trimite în Mesaje” dă prospectul unui coleg.',
        en: 'From the row menu, “Send to Messages” passes the prospect to a colleague.',
      },
      {
        ro: 'Când a devenit client, apasă „Promovează”.',
        en: 'When it has become a client, press “Promote”.',
      },
      {
        ro: '„Arhivează” din meniul rândului ascunde prospectul doar din lista ta; colegii îl văd în continuare. Îl găsești cu „Arată arhivate”.',
        en: '“Archive” in the row menu hides the prospect only from your list; your colleagues still see it. Find it again with “Show archived”.',
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
        ro: 'Pentru taxa de inițiere, scrie câte ore estimezi la client și, dacă vrei, altă marjă de eroare decât cea din Config preț. Gol înseamnă orele pachetului sau cele implicite.',
        en: 'For the setup fee, enter the hours you expect the client to take and, if you like, a different error margin from the one in Price config. Empty means the bundle’s hours or the default ones.',
      },
      {
        ro: 'Apasă Calculează: vezi prețul lunar, anual și taxa de inițiere, cu reducerea de campanie scăzută dacă e activă.',
        en: 'Press Calculate: you see the monthly and yearly price and the setup fee, with the campaign discount taken off if one is active.',
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
