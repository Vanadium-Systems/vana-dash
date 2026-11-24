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
    id: 'acasa',
    route: '/',
    title: {
      ro: 'Acasă: cifrele lunii și widget-urile tale',
      en: 'Home: the month’s figures and your widgets',
    },
    summary: {
      ro: 'Acasă îți spune într-o propoziție cum stă firma, ce cere atenția acum și cum arată luna față de cea trecută. Restul paginii sunt widget-uri pe care le aranjezi tu.',
      en: 'Home tells you in one sentence how the company is doing, what needs attention now and how the month compares with the last one. The rest of the page is widgets you arrange yourself.',
    },
    steps: [
      {
        ro: 'Sus, fereastra cu fotografie se schimbă după ora firmei: răsărit, zi, apus, noapte. Sub ea, butonul cu ce cere atenție te duce direct la lucrul respectiv.',
        en: 'At the top, the photo window changes with the company’s time: sunrise, day, sunset, night. Under it, the button for what needs attention takes you straight to it.',
      },
      {
        ro: 'Fiecare cifră a lunii are lângă ea schimbarea față de luna trecută, în procente. La luna curentă se compară aceleași zile. Un click pe cifră arată de unde vine.',
        en: 'Each figure of the month shows the change from last month, in percent. For the current month the same days are compared. A click on a figure shows where it comes from.',
      },
      {
        ro: 'Apasă Editează ca să muți widget-uri prin tragere, să le schimbi mărimea sau să adaugi altele din catalog, cu previzualizare. Așezarea e doar a ta.',
        en: 'Press Edit to move widgets by dragging, resize them or add more from the catalog, with a preview. The layout is yours alone.',
      },
      {
        ro: '„Revino la așezarea firmei” șterge așezarea ta și te întoarce la cea stabilită de admin.',
        en: '“Back to the company layout” drops yours and returns to the one the admin set.',
      },
      {
        ro: 'La o plată primită apare un mesaj, iar pe telefon vibrează. Sunetul e oprit; îl pornești din Profilul meu, la „Sunet la o plată primită”.',
        en: 'When a payment arrives you get a message, and the phone vibrates. The sound is off; turn it on in My profile, under “Sound on a received payment”.',
      },
    ],
  },
  {
    id: 'financiar',
    route: '/financials',
    feature: 'financiar.view',
    title: {
      ro: 'Financiar: venit, cheltuieli, profit',
      en: 'Financials: revenue, expenses, profit',
    },
    summary: {
      ro: 'Alegi Venit, Cheltuieli sau Profit și vezi cifra perioadei cu schimbarea față de perioada anterioară. Orice rând din pagină poate deveni filtru.',
      en: 'You pick Revenue, Expenses or Profit and see the period’s figure with the change from the previous period. Any row on the page can become a filter.',
    },
    steps: [
      {
        ro: 'Delta de lângă cifră e în procente și în lei, față de perioada anterioară de aceeași lungime. La luna curentă se compară aceleași zile din luna trecută, nu luna întreagă.',
        en: 'The delta next to the figure is in percent and in money, against the previous period of the same length. For the current month, the same days of last month are compared, not the whole month.',
      },
      {
        ro: 'Încasările pe zile arată ziua de azi și vârful aprinse, media și, hașurat, cât se estimează până la sfârșitul lunii. Linia subțire e perioada anterioară.',
        en: 'Collections by day highlight today and the peak, show the average and, hatched, the estimate up to the end of the month. The thin line is the previous period.',
      },
      {
        ro: 'Bara împărțită arată din ce sunt făcute cheltuielile. Clienții, categoriile și platformele sunt bare ordonate după valoare.',
        en: 'The split bar shows what the expenses are made of. Clients, categories and platforms are bars ordered by value.',
      },
      {
        ro: 'Un click pe un rând filtrează toată pagina. Filtrul apare ca etichetă sus și e în adresă, deci îl poți trimite unui coleg. Îl scoți cu × de pe etichetă.',
        en: 'A click on a row filters the whole page. The filter shows as a tag at the top and is in the address, so you can send it to a colleague. Remove it with the × on the tag.',
      },
      {
        ro: 'Jos pe pagină, dosarul Rapoarte are câte un card pentru fiecare raport: MRR și clienți, două perioade, cheltuieli pe categorii și raportul lunar. Un click te duce direct la raport, în tab-ul Rapoarte.',
        en: 'At the bottom of the page, the Reports folder has a card for each report: MRR and clients, two periods, expenses by category and the monthly report. A click takes you straight to the report, in the Reports tab.',
      },
    ],
  },
  {
    id: 'facturi-emise',
    route: '/accounting',
    feature: 'facturi.view',
    title: {
      ro: 'Facturile emise: listă, pagină și încasări',
      en: 'Issued invoices: list, page and payments',
    },
    summary: {
      ro: 'Tab-ul Emise arată ce ai de încasat, iar fiecare factură are pagina ei, cu plățile și cronologia.',
      en: 'The Issued tab shows what you still have to collect, and every invoice has its own page with its payments and timeline.',
    },
    steps: [
      {
        ro: 'Tab-urile de deasupra au număr: Toate, Ciorne, De încasat, Restante, Încasate, Respinse ANAF. Suma e prima pe rând, iar la o factură în valută, echivalentul în lei stă dedesubt. Banda de totaluri se schimbă odată cu filtrele și căutarea.',
        en: 'The tabs above the list have counts: All, Drafts, To collect, Overdue, Paid, ANAF rejected. The amount comes first on the row, and for a foreign-currency invoice the RON equivalent sits under it. The totals band changes with the filters and the search.',
      },
      {
        ro: 'Un click pe rând deschide pagina facturii. Ctrl K găsește o factură după număr sau client și o deschide tot acolo. Sus vezi starea (emisă, trimisă la ANAF, încasată), iar butoanele sunt cele care au sens pentru starea de acum: o ciornă se editează sau se emite, o factură emisă se trimite la ANAF, se încasează sau se stornează.',
        en: 'A click on a row opens the invoice page. Ctrl K finds an invoice by number or client and opens it there. At the top you see the state (issued, sent to ANAF, paid), and the buttons are the ones that make sense in that state: a draft is edited or issued, an issued invoice is sent to ANAF, collected or reversed.',
      },
      {
        ro: 'Pagina arată liniile și totalurile, plățile, cronologia (creată, editată, emisă, trimisă, plăți, storno), totalul facturat aceluiași client și conversațiile din Mesaje în care apare factura.',
        en: 'The page shows the lines and totals, the payments, the timeline (created, edited, issued, sent, payments, reversal), the total invoiced to the same client and the Messages conversations where the invoice appears.',
      },
      {
        ro: '„Înregistrează încasare” cere suma (implicit restul), data, metoda și o referință. Sub câmpuri vezi ce se întâmplă, de exemplu „Neîncasată → Parțial · Rest: 400,00 lei”. Poți înregistra mai multe plăți pe aceeași factură; o plată greșită o ștergi din lista de plăți.',
        en: '“Record payment” asks for the amount (the balance by default), the date, the method and a reference. Under the fields you see what will happen, for example “Unpaid → Partial · Left: 400.00”. You can record several payments on one invoice; a wrong one is deleted from the payments list.',
      },
      {
        ro: 'Dacă extrasul bancar are o plată pentru factură, Reconcilierea o leagă și creează plata ea. Potrivirea automată merge doar când suma din bancă e egală cu ce a rămas de plătit; pentru o plată parțială o potrivești tu. O ciornă nu poate fi marcată plătită.',
        en: 'If the bank statement has a payment for the invoice, Reconciliation links it and creates the payment itself. Automatic matching only works when the bank amount equals what is left to pay; a partial payment you match by hand. A draft cannot be marked paid.',
      },
    ],
  },
  {
    id: 'facturi-editor',
    route: '/accounting',
    feature: 'facturi.emitere',
    title: {
      ro: 'Emiți o factură, un storno sau o proformă',
      en: 'Issuing an invoice, a storno or a proforma',
    },
    summary: {
      ro: 'Editorul arată documentul real pe măsură ce scrii. Ciorna se salvează singură, iar numărul se alocă abia la emitere.',
      en: 'The editor shows the real document as you type. The draft saves itself, and the number is only allocated when you issue.',
    },
    steps: [
      {
        ro: '„Factură nouă” deschide editorul. Alegi clientul sau îl creezi pe loc din CIF (datele vin de la ANAF; ai nevoie de funcționalitatea Clienți), adaugi liniile și vezi totalul fiecărei linii lângă câmpuri. Termenul de plată are valori gata (7, 15, 30, 60, 90 de zile) și arată data calculată.',
        en: '“New invoice” opens the editor. You pick the client or create one on the spot from the tax ID (the data comes from ANAF; you need the Clients feature), add the lines and see each line’s total next to the fields. The payment term has ready values (7, 15, 30, 60, 90 days) and shows the computed date.',
      },
      {
        ro: 'Documentul din dreapta se actualizează la câteva clipe după ultima tastă. Sub 1280 de pixeli e într-un tab separat. Sus scrie când a fost salvată ciorna. Dacă altcineva a modificat-o între timp, editorul te anunță în loc să-i scrie peste.',
        en: 'The document on the right updates a moment after the last keystroke. Below 1280 pixels it sits in a separate tab. At the top it says when the draft was saved. If someone else changed it meanwhile, the editor tells you instead of writing over it.',
      },
      {
        ro: '„Emite” deschide un pas de verificare cu numărul care se va aloca, clientul și totalul. „Emite și trimite la ANAF” face ambele; „Doar emite” lasă trimiterea pe mai târziu. Un număr dat nu se mai schimbă.',
        en: '“Issue” opens a check step with the number that will be allocated, the client and the total. “Issue and send to ANAF” does both; “Issue only” leaves the sending for later. A number once given does not change.',
      },
      {
        ro: 'Pentru o factură emisă, „Stornează” propune stornarea integrală sau pe linii, cu cantitatea de stornat. Stornoul e o factură în aceeași serie, cu cantități negative și trimitere la factura inițială; pe pagina inițială apare „Stornată de” sau „Stornată parțial de”, iar pe storno „Stornează”. Nu poți storna mai mult decât a rămas.',
        en: 'For an issued invoice, “Credit note” offers a full reversal or one by lines, with the quantity to reverse. A storno is an invoice in the same series, with negative quantities and a reference to the original; the original page then says “Reversed by” or “Partly reversed by”, and the storno says “Reverses”. You cannot reverse more than what is left.',
      },
      {
        ro: 'Proforma are tab-ul ei, seria PRO și mențiunea „Proformă · nu este factură fiscală”. Nu se trimite la ANAF și nu intră în încasări, declarații, rapoarte sau reconciliere. „Factură din proformă” deschide editorul cu liniile copiate; „Anulează” o scoate din lucru. Avansurile încasate pe o proformă se facturează tot de mână.',
        en: 'A proforma has its own tab, the PRO series and the note “Proforma · not a tax invoice”. It does not go to ANAF and counts in no payments, declarations, reports or reconciliation. “Invoice from proforma” opens the editor with the lines copied; “Cancel” takes it out of play. Advances collected on a proforma are still invoiced by hand.',
      },
    ],
  },
  {
    id: 'facturi-luna-email',
    route: '/accounting',
    feature: 'facturi.view',
    title: {
      ro: 'Închiderea lunii (tab-ul Luna) și facturi primite pe email',
      en: 'Monthly close (Month tab) and supplier invoices by email',
    },
    summary: {
      ro: 'Verifici toate facturile lunii, completezi documentele lipsă, arhivezi totul și descarci pachetul pentru contabilă.',
      en: 'Review every invoice in the month, upload missing PDFs, archive everything and download the accountant package.',
    },
    steps: [
      {
        ro: 'Tab-ul Luna deschide implicit luna anterioară până pe 25 ale lunii (sau luna curentă după 26). Filtrele de sus arată rapid facturile emise, primite din e-Factura, primite pe email/manual, așteptatele lipsă și cele nearhivate.',
        en: 'The Month tab opens the previous month by default until the 25th (or the current month from the 26th). The top filters show issued, e-Factura received, email/manual received, expected missing, and unarchived documents.',
      },
      {
        ro: 'Facturile aduse automat din email apar cu badge-ul „De verificat” și nu intră în D301/D390 până nu apeși „Confirmă” și verifici numărul, data și suma extrase din PDF.',
        en: 'Invoices auto-ingested from email show a “Needs review” badge and stay out of D301/D390 until you click “Confirm” and verify the extracted number, date, and amount.',
      },
      {
        ro: 'Pentru furnizorii recurenți fără factură încărcată, poți încărca PDF-ul direct pe rând sau poți căuta în Email după expeditor. La final apeși „Arhivează tot ce lipsește”, descarci pachetul .zip și marchezi luna completă.',
        en: 'For recurring suppliers without an uploaded invoice, you can upload the PDF directly on the row or search in Email by sender. At the end, click “Archive all missing”, download the .zip package, and mark the month complete.',
      },
      {
        ro: 'În Facturi → Setări configurezi regulile „Facturi furnizori din email” (inclusiv preseturi Anthropic / Hetzner și scanare pe ultimele 3 luni). În Email, pe orice atașament PDF primit ai butonul „Adaugă ca factură primită”.',
        en: 'In Invoices → Settings you configure “Supplier invoices from email” rules (including Anthropic / Hetzner presets and a 3-month scan). In Email, every received PDF attachment has an “Import as received invoice” button.',
      },
    ],
  },
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
        ro: 'Apasă „Apel nou”, scrie un titlu, alege tipul (Video + audio sau Doar audio) și cât timp merge linkul. Poți porni același dialog și din meniul unui prospect sau bifând linkul video E2EE când programezi o întâlnire.',
        en: 'Press “New call”, write a title, pick video or audio only, and choose how long the link works for. You can also open this dialog from a prospect’s menu or tick the E2EE video link option when scheduling a meeting.',
      },
      {
        ro: '„Creează și copiază linkul” pune în clipboard linkul complet cu cheia de criptare (`#k=...`, care nu ajunge la server); trimite-l pe email sau pe chat.',
        en: '“Create and copy the link” copies the full link including the `#k=` encryption key (which never goes to the server); send it by email or chat.',
      },
      {
        ro: 'Intri și tu cu „Intră” din rândul apelului. Browserul îți cere camera și microfonul; pe telefon în APK, dacă WebView-ul nu suportă criptarea media, apare butonul „Deschide în Chrome”.',
        en: 'Join with “Join” on the call’s row. The browser asks for your camera and microphone; in the Android APK, if the WebView lacks media encryption support, an “Open in Chrome” button appears.',
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
    id: 'email-secvente',
    route: '/clients',
    feature: 'email.bulk',
    title: {
      ro: 'Secvențe de outreach',
      en: 'Outreach sequences',
    },
    summary: {
      ro: 'O secvență trimite singură o serie de pași către destinatari: emailuri și, între ele, task-uri pentru tine.',
      en: 'A sequence sends a series of steps to recipients on its own: emails and, between them, tasks for you.',
    },
    steps: [
      {
        ro: 'În Email → Secvențe, creează o secvență: alege cutia de pe care pleacă și adaugă pașii, fiecare cu întârzierea lui în zile. Ordinea se schimbă prin tragere.',
        en: 'In Email → Sequences, create a sequence: pick the mailbox it sends from and add the steps, each with its delay in days. The order changes by dragging.',
      },
      {
        ro: 'Un pas poate fi Email (cu un șablon) sau Apel, Task ori unul de LinkedIn (conectare, mesaj, vizitare profil, apreciere). Pașii care nu sunt email devin task-uri pe prospect, în pagina Task-uri, și secvența așteaptă până le faci sau până trec 7 zile.',
        en: 'A step can be an Email (with a template) or a Call, a Task or a LinkedIn one (connect, message, view profile, like a post). The steps that are not email become tasks on the prospect, in the Tasks page, and the sequence waits until you do them or 7 days pass.',
      },
      {
        ro: 'La un pas de email poți pune un al doilea șablon, B: destinatarii se împart între A și B, iar statisticile le arată separat.',
        en: 'On an email step you can add a second template, B: recipients are split between A and B, and the statistics show them separately.',
      },
      {
        ro: '„La răspuns”, „La întâlnire programată” și „La câștigat sau pierdut” spun când se oprește secvența pentru un destinatar. Un răspuns o oprește mereu.',
        en: '“On reply”, “On scheduled meeting” and “On won or lost” say when the sequence stops for a recipient. A reply always stops it.',
      },
      {
        ro: 'Înscrie destinatari din Prospectare (selecția de pe rânduri) sau o listă întreagă. Cine are emailul respins sau s-a dezabonat nu primește nimic.',
        en: 'Enroll recipients from Prospects (the selection on the rows) or a whole list. Anyone whose address bounced or who unsubscribed gets nothing.',
      },
      {
        ro: 'Dacă prea multe emailuri se întorc (bounce), secvența se pune singură pe pauză, iar Diagnosticul arată de ce și de când. O repornești cu „Repornește” după ce ai verificat lista; o poți pune pe pauză și manual.',
        en: 'If too many emails bounce, the sequence pauses itself, and Diagnostics shows why and since when. You restart it with “Resume” after checking the list; you can also pause it by hand.',
      },
      {
        ro: 'Când există cutii de outreach configurate în Setările firmei, secvențele și trimiterile în masă de pe identitatea Outreach rotesc automat între cutiile active și arată câte mesaje mai pot pleca azi din fiecare.',
        en: 'When outreach mailboxes are configured in Company settings, sequences and bulk sends from the Outreach identity rotate automatically across active mailboxes and show how many messages remain today for each.',
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
      ro: 'Mesajele sunt criptate de la un capăt la altul: le citesc doar dispozitivele celor din conversație. Ajung pe loc la cine are aplicația deschisă; ceilalți primesc notificare. Poți răspunde la un mesaj, reacționa și trimite obiecte din aplicație.',
      en: 'Messages are end-to-end encrypted: only the devices of the people in the conversation read them. They reach whoever has the app open right away; the others get a notification. You can reply to a message, react and send objects from the app.',
    },
    steps: [
      {
        ro: 'Prima dată când deschizi Mesaje faci o cheie de recuperare: o vezi o singură dată, așa că păstreaz-o într-un manager de parole. Pe un dispozitiv nou (alt browser, telefonul) îl aprobi de pe unul deja logat, după ce compari codul de 6 cifre de pe cele două ecrane, sau scrii cheia de recuperare. Fără ea și fără alt dispozitiv logat, mesajele vechi se pierd: nici adminul nu le poate recupera. La logout, cheile de pe acel dispozitiv se șterg.',
        en: 'The first time you open Messages you make a recovery key: you see it once, so keep it in a password manager. A new device (another browser, your phone) is approved from one where you are already signed in, after comparing the 6-digit code on both screens, or with the recovery key. Without it and without another signed-in device, old messages are lost: an admin cannot recover them either. Signing out removes the keys from that device.',
      },
      {
        ro: 'Ce vede serverul: cine scrie, cui, când și cât de mare e un mesaj sau un fișier, plus reacțiile și obiectele trimise din aplicație (acestea vin din pagini necriptate). Ce nu vede: textul și fișierele. Notificarea spune doar „Mesaj nou”. Limita oricărei aplicații web: codul vine de la server, deci criptarea apără de cine citește baza de date, copiile de siguranță sau traficul, nu de un server compromis care ar servi alt cod.',
        en: 'What the server sees: who writes, to whom, when and how big a message or file is, plus reactions and objects sent from the app (those come from pages that are not encrypted). What it does not see: text and files. The notification only says “New message”. The limit of any web app: the code comes from the server, so encryption protects against whoever reads the database, the backups or the traffic, not against a compromised server serving other code.',
      },
      {
        ro: 'Apasă pe iconița de conversație nouă, apoi „Scrie cuiva” pentru un coleg sau „Grup nou” pentru mai mulți. Din antetul conversației poți porni direct un apel audio sau video criptat E2EE: colegii primesc alertă în aplicație și notificare push.',
        en: 'Press the new conversation icon, then “Write to someone” for a colleague or “New group” for several. From the conversation header you can also start an E2EE audio or video call: colleagues get an in-app ring alert and a push notification.',
      },
      {
        ro: 'Un apel primit sună ca la telefon. În aplicația de pe telefon (versiunea 1.6, din Setări) apare ecranul de apel, și pe ecranul blocat, cu „Răspunde” și „Respinge”; la „Răspunde” deblochezi telefonul și intri în apel. În browser apare sus o fereastră cu cele două butoane, iar cu tab-ul în fundal primești și o notificare cu ele. Dacă răspunzi pe un dispozitiv, pe celelalte nu mai sună.',
        en: 'An incoming call rings like a phone call. In the phone app (version 1.6, from Settings) the call screen shows, also on the lock screen, with Answer and Decline; Answer unlocks the phone and takes you into the call. In a browser a window with both buttons opens at the top, and with the tab in the background you also get a notification with them. Answer on one device and the others stop ringing.',
      },
      {
        ro: 'În aplicația de pe telefon, un apel audio pornește în cască și ecranul se stinge când duci telefonul la ureche; „Difuzor” comută pe difuzor. Apelul merge mai departe cu ecranul stins. Cu căști Bluetooth, „Microfon: căști” e modul de apel obișnuit, iar „Microfon: telefon” lasă căștile pe sunetul de muzică și înregistrează cu microfonul telefonului.',
        en: 'In the phone app an audio call starts in the earpiece and the screen goes dark when you hold the phone to your ear; Speaker switches to the loudspeaker. The call goes on with the screen off. With Bluetooth headphones, “Mic: headset” is the usual call mode, while “Mic: phone” keeps the headphones on music-quality sound and records with the phone’s microphone.',
      },
      {
        ro: 'În apel, un click pe o imagine o mărește, iar ceilalți se strâng pe margine; „Înapoi la toți” (sau încă un click) reface grila. Ecranul partajat de un coleg se mărește singur. Se partajează un singur ecran odată: cine pornește partajarea o preia, iar a celui dinainte se oprește.',
        en: 'In a call, a click on a picture makes it big and the others move to the side; “Back to everyone” (or another click) brings the grid back. A colleague’s shared screen gets big on its own. One screen is shared at a time: whoever starts sharing takes over, and the previous share stops.',
      },
      {
        ro: 'Ecranul îl partajează gazda apelului (cine l-a pornit) și adminii. Gazda le dă voie altora din butonul „Lasă-l să partajeze” de pe imaginea fiecăruia, sau tuturor cu „Oricine poate partaja”; invitații din link pot primi voie la fel. Dacă pleci de pe pagina apelului, apelul rămâne deschis într-o fereastră mică în colț; „Mărește apelul” te duce înapoi.',
        en: 'The screen is shared by the call’s host (whoever started it) and by admins. The host lets someone share with “Let them share” on their picture, or everyone with “Anyone can share”; link guests can be let in the same way. If you leave the call page, the call stays open in a small window in the corner; “Open the call” takes you back.',
      },
      {
        ro: 'Ceasul de lângă numărul de participanți arată de cât timp ține apelul. Apelul e deschis cât ai ales la „The link works for”, numărat de la creare; cu 10 minute înainte de final apare un avertisment, iar gazda sau un admin apasă „Prelungește cu o oră”.',
        en: 'The clock next to the participant count shows how long the call has run. A call stays open for the time picked under “The link works for”, counted from when it was made; ten minutes before the end a warning shows, and the host or an admin presses “Extend by an hour”.',
      },
      {
        ro: 'Scrie în câmpul de jos și trimite. Un fișier de până la 50 MB se pune din „Atașează”. Emoji: după două puncte și două litere (:so) apar emoji-urile cu numele acela, Enter alege; sau iconița de lângă câmp.',
        en: 'Type in the field at the bottom and send. A file of up to 50 MB is added with “Attach”. Emoji: a colon and two letters (:so) list the emoji with that name, Enter picks; or the icon next to the field.',
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
        ro: 'Butoanele din antet deschid panoul conversației: membri, oprirea notificărilor, pozele și fișierele trimise și căutarea în conversație (găsește și fără diacritice, doar în mesajele deschise deja pe dispozitivul tău). Cine a făcut grupul adaugă oameni din „Adaugă oameni” și îi scoate cu butonul de lângă nume. Bulina verde de pe inițiale arată cine e acum în aplicație.',
        en: 'The header buttons open the conversation panel: members, mute, photos and files sent, and search inside the conversation (it matches without diacritics too, only in messages already opened on your device). Whoever made the group adds people with “Add people” and removes them with the button next to their name. The green dot on the initials shows who is in the app right now.',
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
        ro: 'Din același meniu, un mesaj de-al tău se editează sau se șterge, iar „Info” arată cine l-a văzut și când.',
        en: 'From the same menu, one of your messages is edited or deleted, and “Info” shows who has seen it and when.',
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
        ro: 'Sau trage un interval direct în calendar (pe telefon, ține apăsat), scrie titlul și apasă Enter.',
        en: 'Or draw a range straight in the calendar (on a phone, press and hold), type the title and press Enter.',
      },
      {
        ro: 'Poți pune până la 5 notificări înainte de eveniment și o recurență: zilnic, în zilele lucrătoare, săptămânal, lunar (după dată sau „a patra joi”) sau anual. Sub formular vezi regula scrisă în cuvinte.',
        en: 'You can add up to 5 notifications before the event and a recurrence: daily, on weekdays, weekly, monthly (by date or “fourth Thursday”) or yearly. Under the form you see the rule written out.',
      },
      {
        ro: 'Ca să muți un eveniment, trage-l pe altă zi sau oră; trage de marginea de jos ca să-i schimbi durata. La un eveniment care se repetă alegi „Doar acest eveniment”, „Acesta și următoarele” sau „Toate evenimentele”.',
        en: 'To move an event, drag it to another day or time; drag its bottom edge to change the length. For a repeating event you pick “This event”, “This and following events” or “All events”.',
      },
      {
        ro: 'Apasă un eveniment ca să-l citești; de acolo îl editezi, duplici sau ștergi, iar din ⋯ îl trimiți în Mesaje sau copiezi linkul. După orice schimbare apare „Anulează”, iar cât e mesajul pe ecran merge și Ctrl+Z.',
        en: 'Click an event to read it; from there you edit, duplicate or delete it, and from ⋯ you send it to Messages or copy the link. After any change “Undo” appears, and Ctrl+Z works while the message is on screen.',
      },
      {
        ro: 'Comută între „Zi”, „Săptămână”, „Lună” și „Program” (lista a ce urmează); „Astăzi” te aduce la ziua curentă. Caută cu căsuța de căutare sau cu /.',
        en: 'Switch between “Day”, “Week”, “Month” and “Schedule” (the list of what comes next); “Today” brings you back to the current day. Search with the search box or with /.',
      },
      {
        ro: 'Scurtături: c eveniment nou, t azi, n / p înainte și înapoi, d / w / m / a pentru vedere, e editează, Delete șterge.',
        en: 'Shortcuts: c new event, t today, n / p forward and back, d / w / m / a for the view, e edit, Delete delete.',
      },
      {
        ro: 'Dacă nu poți adăuga participanți, evenimentul rămâne doar în calendarul tău.',
        en: 'If you cannot add attendees, the event stays only in your calendar.',
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
        ro: 'Apasă „Calendare”, caută colegul și bifează calendarele pe care vrei să le vezi.',
        en: 'Press “Calendars”, find the colleague and tick the calendars you want to see.',
      },
      {
        ro: 'Evenimentul altcuiva are numele omului în titlu.',
        en: 'Someone else\'s event has the person\'s name in the title.',
      },
      {
        ro: 'Ca să-ți vadă cineva calendarul, deschide meniul ⋯ de lângă „Eveniment nou”, apasă „Partajează” și alege „Vede” sau „Editează”. Tot acolo sunt și Programările.',
        en: 'For someone to see your calendar, open the ⋯ menu next to “New event”, press “Share” and pick “Can view” or “Can edit”. Bookings are in the same menu.',
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
      {
        ro: 'Limita de spațiu e a firmei și numără Arhiva, notele vocale de pe prospecți și fișierele din Mesaje; Coșul ocupă spațiu până îl golești. Cine are „Vede spațiul de stocare ocupat de fiecare” vede tab-ul „Spațiu de stocare”: cât e folosit, pe surse, pe oameni și cele mai mari foldere.',
        en: 'The storage limit is the company’s and counts the Archive, the voice notes on prospects and the files in Messages; the Trash takes up space until you empty it. Whoever has “Sees the storage each person uses” gets the “Storage” tab: how much is used, by source, by person and the largest folders.',
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
    route: '/clients',
    feature: 'clienti.prospectare',
    title: {
      ro: 'Lucrezi pe lista de prospecți',
      en: 'Working the prospect list',
    },
    summary: {
      ro: 'Tab-ul Prospectare ține firmele de contactat, cu scor, prioritate, status și responsabil. Vezi doar ce e al tău, ce e liber și unde ești colaborator; cu „Vede prospecții tuturor” în rol vezi toată lista.',
      en: 'The Prospects tab holds the companies to contact, with score, priority, status and owner. You see what is yours, what is free and where you collaborate; with “Sees everyone’s prospects” in your role you see the whole list.',
    },
    steps: [
      {
        ro: 'Scorul (0–100) arată cât de bine se potrivește firma: buget, nevoie și deschidere spre tehnologie, plus punctele criteriilor bifate din Setări (un criteriu nebifat nu scade nimic). Ce nu știm despre o firmă nu se socotește zero. O firmă cu bilanț depus, dar fără cifră de afaceri și fără angajați, rămâne SKIP; una fără bilanț rămâne cel mult NURTURE; una cu capital propriu negativ mare față de cifra de afaceri, în pierdere sau cu prea puține date cunoscute rămâne cel mult WARM, oricâte criterii ar bifa. Doar firmele radiate primesc 0. Dacă ai cum s-o contactezi nu intră în scor: filtrul „Contact” desparte firmele cu telefon sau email (de sunat) de cele de completat. În fișa firmei, secțiunea „Cercetare” ține ce s-a aflat despre ea (amenzi, știri, semne de creștere, o soluție similară); în Setări pui puncte pe ele, și negative, prin criterii cu filtrele din grupul „Cercetare”.',
        en: 'The score (0–100) shows how well the company fits: budget, need and openness to technology, plus the points of the criteria it matches in Settings (an unmatched criterion takes nothing away). What we do not know about a company does not count as zero. A company with a filed balance sheet but no turnover and no employees stays SKIP; one without a balance sheet stays NURTURE at most; one with negative equity that is large for its turnover, losing money or with too little known stays WARM at most, whatever criteria it matches. Only struck-off companies get 0. Whether you can reach it is not in the score: the “Contact” filter splits the companies with a phone or email (to call) from those to research. On the company sheet, the “Research” section holds what was found about it (fines, news, growth signs, a similar product); in Settings you give them points, negative too, through criteria with the filters in the “Research” group.',
      },
      {
        ro: 'Caută după nume, CUI, telefon, email sau persoana de contact. Pentru o căutare mai fină apasă „Filtre” și alege câmpul, sau scrie o frază în câmpul de căutare, de pildă „firme active din Cluj fără responsabil”, și filtrele apar ca chip-uri pe care le poți corecta.',
        en: 'Search by name, CUI, phone, email or contact person. For a finer search press “Filters” and pick the field, or write a phrase in the search box, for example “active companies in Cluj with no owner”, and the filters appear as chips you can correct.',
      },
      {
        ro: 'Cu „Firme” și „Oameni” treci între lista de firme și cea de oameni de contact. Coloanele, sortarea și calculele din subsol (sumă, medie, minim, maxim) se aleg din antetul tabelului.',
        en: '“Companies” and “People” switch between the list of companies and the list of contact people. The columns, the sorting and the footer calculations (sum, average, minimum, maximum) are picked from the table header.',
      },
      {
        ro: '„Salvează vederea curentă” păstrează filtrele, coloanele și sortarea sub un nume. Pune o stea pe vederile pe care le folosești des, ca să-ți apară sus, și bifează „Anunță-mă când apar rezultate noi” pentru cele pe care vrei să le urmărești. O vedere partajată o văd și colegii.',
        en: '“Save current view” keeps the filters, columns and sorting under a name. Star the views you use often so they show up on top, and tick “Notify me when new results appear” for the ones you want to follow. A shared view is seen by your colleagues too.',
      },
      {
        ro: 'Schimbă statusul unui prospect după fiecare discuție. Editezi direct în celulă, iar săgețile te mută între rânduri. Bifează mai multe rânduri (Shift+click pentru un interval) ca să schimbi statusul, să arhivezi, să transferi sau să le pui într-o listă dintr-o dată; „Selectează toate cele N” ia tot ce se potrivește filtrelor.',
        en: 'Change the status of a prospect after each conversation. You edit right in the cell, and the arrow keys move between rows. Tick several rows (Shift+click for a range) to change the status, archive, transfer or add them to a list in one go; “Select all N” takes everything that matches the filters.',
      },
      {
        ro: '„Prospect nou” cere întâi CUI-ul și aduce datele firmei de la ANAF; dacă firma există deja, te duce la fișa ei în loc să facă o dublură.',
        en: '“New prospect” asks for the CUI first and brings the company data from ANAF; if the company already exists, it takes you to its sheet instead of making a duplicate.',
      },
      {
        ro: 'Apasă „Calculează preț” pe rând ca să deschizi calculatorul cu datele lui. Când a devenit client, apasă „Promovează”: oferta salvată pe prospect trece pe client.',
        en: 'Press “Calculate price” on the row to open the calculator with its details. When it has become a client, press “Promote”: the offer saved on the prospect moves to the client.',
      },
      {
        ro: 'Din meniul rândului, „Trimite în Mesaje” dă prospectul unui coleg. „Arhivează” îl ascunde doar din lista ta; îl găsești cu „Arată arhivate”.',
        en: 'From the row menu, “Send to Messages” passes the prospect to a colleague. “Archive” hides it only from your list; find it again with “Show archived”.',
      },
    ],
  },
  {
    id: 'clienti-fisa',
    route: '/clients',
    feature: 'clienti.prospectare',
    title: {
      ro: 'Fișa prospectului și echipa',
      en: 'The prospect sheet and the team',
    },
    summary: {
      ro: 'Un click pe un prospect deschide fișa: cine e responsabil, ce urmează și tot ce s-a întâmplat cu el.',
      en: 'A click on a prospect opens its sheet: who owns it, what comes next and everything that happened to it.',
    },
    steps: [
      {
        ro: 'Bara etapelor arată unde e prospectul. „Câștigat” și „Pierdut” îl închid (la Pierdut te întreabă motivul), iar „Redeschide” îl aduce înapoi. Săgețile sau tastele j și k trec la prospectul următor din lista ta.',
        en: 'The stage bar shows where the prospect stands. “Won” and “Lost” close it (Lost asks for the reason), and “Reopen” brings it back. The arrows or the j and k keys move to the next prospect in your list.',
      },
      {
        ro: '„Pasul următor” e cel mai apropiat task nefăcut. „Programează” alege un apel, un email sau altceva pentru o zi anume și îl pune și în calendarul tău.',
        en: '“Next step” is the nearest task not done. “Schedule” picks a call, an email or something else for a given day and puts it in your calendar too.',
      },
      {
        ro: 'Adaugă oameni de contact, fiecare cu telefoanele și emailurile lui, și marchează cine nu mai e de contactat. În Notițe poți scrie @nume ca să anunți un coleg; „Fixează” ține o notiță sus.',
        en: 'Add contact people, each with their phones and emails, and mark who is no longer to be contacted. In Notes you can write @name to notify a colleague; “Pin” keeps a note on top.',
      },
      {
        ro: 'Un prospect liber îl iei cu „Îl iau eu”. „Eliberează” îl dă înapoi; dacă nu faci nimic pe el, se eliberează singur după numărul de zile din Setări → Clienți și primești un avertisment înainte.',
        en: 'You take a free prospect with “I’ll take it”. “Release” gives it back; if you do nothing on it, it is released on its own after the number of days in Settings → Clients, and you get a warning before.',
      },
      {
        ro: '„Transferă” îl dă unui coleg, cu o notiță, iar colegul e anunțat. Dacă prospectul e al altcuiva, „Cere transfer” sau „Cere acces” trimite o cerere; responsabilul o primește la notificări și o acceptă sau o refuză. Transferul către alții, fără cerere, cere „Repartizează prospecți și setează regulile” în rol.',
        en: '“Transfer” gives it to a colleague, with a note, and the colleague is notified. If the prospect is someone else’s, “Ask for transfer” or “Ask for access” sends a request; the owner gets it in notifications and accepts or refuses. Transferring other people’s prospects without a request needs “Assigns prospects and sets the rules” in your role.',
      },
      {
        ro: '„Colaboratori” dă acces de citire sau de editare unui coleg, fără să schimbe responsabilul.',
        en: '“Collaborators” gives a colleague view or edit access without changing the owner.',
      },
      {
        ro: '„Meet” programează o întâlnire: ziua, ora, durata și locul. Bifezi oamenii de contact care primesc invitația pe email, cu fișierul de calendar atașat, de pe cutia ta. Colegii aleși apar în calendarul lor. Pe rândul întâlnirii din Task-uri, „Mută” și „Anulează” îi întreabă dacă trimit invitaților actualizarea sau anularea.',
        en: '“Meet” schedules a meeting: day, time, length and place. You tick the contact people who get the invitation by email, with the calendar file attached, from your mailbox. The colleagues you pick see it in their calendar. On the meeting row in Tasks, “Move” and “Cancel” ask whether to send the invitees the update or the cancellation.',
      },
      {
        ro: 'În Notițe, „Notă vocală” înregistrează direct din aplicație, iar „Încarcă fișiere” ia una sau mai multe înregistrări pe care le ai deja (până la 25 MB și 15 minute fiecare). Le asculți pe loc. Le șterge autorul sau adminul.',
        en: 'In Notes, “Voice note” records straight from the app, and “Upload files” takes one or more recordings you already have (up to 25 MB and 15 minutes each). You play them right there. The author or the admin can delete them.',
      },
    ],
  },
  {
    id: 'clienti-apeluri',
    route: '/clients',
    feature: 'clienti.prospectare',
    title: {
      ro: 'Task-uri și sesiunea de apeluri',
      en: 'Tasks and the call session',
    },
    summary: {
      ro: 'Pagina Task-uri strânge ce ai de făcut pe prospecți, iar sesiunea de apeluri te duce prin ele unul câte unul.',
      en: 'The Tasks page gathers what you have to do on prospects, and the call session takes you through them one by one.',
    },
    steps: [
      {
        ro: 'Deschide tab-ul Task-uri. Filtrează după tip (Apeluri, Email, LinkedIn) sau după Azi și Restante; „Ale mele” și „Ale echipei” schimbă cine apare. Numărul de lângă Clienți din meniu arată ce ai de făcut azi.',
        en: 'Open the Tasks tab. Filter by type (Calls, Email, LinkedIn) or by Today and Overdue; “Mine” and “The team’s” change who shows. The number next to Clients in the menu shows what you have to do today.',
      },
      {
        ro: '„Marchează făcut” cere rezultatul la un apel (Răspuns, Nu răspunde, Mesaj vocal, Număr greșit, Revino) și, dacă vrei, următorul pas: revii peste 2 zile, suni peste o săptămână sau trimiți oferta. Pasul următor se creează singur.',
        en: '“Mark done” asks for the outcome of a call (Answered, No answer, Voicemail, Wrong number, Call back) and, if you like, the next step: call back in 2 days, call in a week or send the offer. The next step is created for you.',
      },
      {
        ro: '„Pornește sesiunea” deschide apelurile de azi pe tot ecranul: vezi telefoanele, notițele fixate și ultimele activități ale prospectului. Tastele 1-5 aleg rezultatul, Enter trece la următorul, S sare peste, Esc închide.',
        en: '“Start session” opens today’s calls full screen: you see the phones, the pinned notes and the latest activity of the prospect. Keys 1-5 pick the outcome, Enter moves on, S skips, Esc closes.',
      },
      {
        ro: 'Un prospect marcat „Nu contacta” apare cu avertisment în sesiune; nu-l suna. La final vezi sumarul sesiunii.',
        en: 'A prospect marked “Do not contact” shows a warning in the session; do not call it. At the end you see the session summary.',
      },
      {
        ro: 'Scrie / într-o notiță, o descriere de task sau un email ca să inserezi un snippet; le gestionezi din butonul „Snippet-uri”.',
        en: 'Write / in a note, a task description or an email to insert a snippet; you manage them from the “Snippets” button.',
      },
    ],
  },
  {
    id: 'clienti-pipeline',
    route: '/clients',
    feature: 'clienti.view',
    title: {
      ro: 'Board, prognoză, liste și rapoarte',
      en: 'Board, forecast, lists and reports',
    },
    summary: {
      ro: 'Aceiași prospecți, văzuți ca etape de vânzare, ca bani așteptați într-o lună sau ca liste de lucru.',
      en: 'The same prospects, seen as sales stages, as money expected in a month or as working lists.',
    },
    steps: [
      {
        ro: 'Cu „Afișare” treci de la Listă la Board sau Prognoză. Pe Board tragi un prospect dintr-o etapă în alta (doar cele pe care le poți edita); pe telefon vezi o etapă pe rând, glisezi lateral și folosești „Mută în etapa”.',
        en: 'With “View” you switch from List to Board or Forecast. On the Board you drag a prospect from one stage to another (only the ones you can edit); on a phone you see one stage at a time, swipe sideways and use “Move to stage”.',
      },
      {
        ro: 'Prognoza adună valoarea prospecților deschiși pe luna închiderii estimate; fără dată, ajung la „Fără dată”. Filtrele și vederea salvată se aplică și aici.',
        en: 'The forecast adds up the value of open prospects by the month of the expected close; without a date, they land in “No date”. The filters and the saved view apply here too.',
      },
      {
        ro: 'În tab-ul Liste faci liste și dosare pentru o campanie sau o rundă de apeluri. „Adaugă în listă” din selecția de pe rânduri sau „Listă din căutare” pune în listă tot ce se potrivește căutării de acum; poți sări peste cei fără telefon, cei marcați „Nu contacta” sau cei deja în alte liste din dosar.',
        en: 'In the Lists tab you make lists and folders for a campaign or a round of calls. “Add to list” from the selection on the rows, or “List from search”, puts in a list everything that matches the current search; you can skip those without a phone, those marked “Do not contact” or those already in other lists in the folder.',
      },
      {
        ro: 'Rapoarte arată pâlnia de vânzare pe un interval și numerele fiecărui agent (cu „Repartizează prospecți și setează regulile” le vezi pe toți).',
        en: 'Reports shows the sales funnel over a period and each agent’s numbers (with “Assigns prospects and sets the rules” you see everyone’s).',
      },
    ],
  },
  {
    id: 'clienti-import',
    route: '/clients',
    feature: 'clienti.prospectare',
    title: {
      ro: 'Import, export și sănătatea datelor',
      en: 'Import, export and data health',
    },
    summary: {
      ro: 'Aduci prospecți dintr-un fișier, îi scoți în Excel și cureți dublurile.',
      en: 'You bring prospects from a file, take them out in Excel and clean up duplicates.',
    },
    steps: [
      {
        ro: 'La „Import” descarcă modelul, completează-l și încarcă fișierul .xlsx sau .csv (până la 5.000 de rânduri). Previzualizarea arată ce e nou, ce completează un prospect existent, ce are erori și ce e sărit; nu se scrie nimic până nu apeși „Importă”.',
        en: 'Under “Import”, download the template, fill it in and upload the .xlsx or .csv file (up to 5,000 rows). The preview shows what is new, what fills in an existing prospect, what has errors and what is skipped; nothing is written until you press “Import”.',
      },
      {
        ro: 'Alegi cui revin prospecții noi: ție, unui coleg sau pe rând între mai mulți (ultimele două cer „Repartizează prospecți și setează regulile”). Un prospect găsit după CUI rămâne al responsabilului lui, iar fișierul îi completează doar câmpurile goale.',
        en: 'You choose who gets the new prospects: you, a colleague or in turn among several (the last two need “Assigns prospects and sets the rules”). A prospect found by CUI stays with its owner, and the file fills in only its empty fields.',
      },
      {
        ro: 'Rândurile cu erori se descarcă într-o listă, ca să le corectezi și să le încarci din nou.',
        en: 'Rows with errors download as a list, so you can fix them and upload them again.',
      },
      {
        ro: '„Exportă” scoate în .xlsx sau .csv exact ce vezi cu filtrele de acum (cel mult 10.000 de rânduri). Cere „Exportă prospecți” în rol, iar fiecare export se înregistrează în Istoric.',
        en: '“Export” writes to .xlsx or .csv exactly what you see with the current filters (at most 10,000 rows). It needs “Exports prospects” in your role, and every export is recorded in History.',
      },
      {
        ro: 'Tab-ul Sănătate numără prospecții fără telefon sau email, contactele invalide sau cu bounce, firmele radiate și dublurile; un click pe card filtrează lista.',
        en: 'The Health tab counts prospects without a phone or email, invalid or bounced contacts, struck-off companies and duplicates; a click on a card filters the list.',
      },
      {
        ro: 'La o pereche de dubluri, „Unește” te lasă să alegi, câmp cu câmp, ce valoare rămâne; oamenii, notițele, task-urile și listele se mută pe fișa păstrată. Unirea nu se poate desface, iar linkurile vechi duc la fișa păstrată.',
        en: 'For a pair of duplicates, “Merge” lets you pick, field by field, which value stays; the people, notes, tasks and lists move to the kept sheet. A merge cannot be undone, and old links lead to the kept sheet.',
      },
    ],
  },
  {
    id: 'clienti-contracte',
    route: '/clients',
    feature: 'facturi.contracte',
    title: {
      ro: 'Registrul de contracte',
      en: 'The contracts register',
    },
    summary: {
      ro: 'Tab-ul Contracte ține toate contractele firmei, cu termenul, responsabilul și starea lor, ca să nu pierzi un preaviz.',
      en: 'The Contracts tab holds all the company’s contracts, with their term, owner and state, so you do not miss a notice period.',
    },
    steps: [
      {
        ro: 'Lista cuprinde contractele SaaS cu clienții, colaborările, NDA-urile și contractele de la furnizori. Filtrezi după stare (ciornă, de semnat, semnat, expirat, reziliat) și cauți după nume sau număr.',
        en: 'The list covers SaaS contracts with clients, collaborations, NDAs and supplier contracts. Filter by state (draft, to sign, signed, expired, terminated) and search by name or number.',
      },
      {
        ro: 'Un click pe rând deschide pagina contractului: termenul (început, sfârșit, reînnoire automată în luni, preaviz în zile), responsabilul, documentele și istoricul.',
        en: 'A click on a row opens the contract page: the term (start, end, automatic renewal in months, notice in days), the owner, the documents and the history.',
      },
      {
        ro: '„Contract nou” pornește dintr-un șablon al firmei: formularul se face din câmpurile șablonului, iar numărul propus vine din serie. Un număr ocupat nu se poate refolosi.',
        en: '“New contract” starts from a company template: the form is built from the template’s fields, and the proposed number comes from the series. A number already taken cannot be reused.',
      },
      {
        ro: '„Încarcă semnat” adaugă un contract venit din afară, cu numărul nostru sau cu al celeilalte părți.',
        en: '“Upload signed” adds a contract that came from outside, with our number or the other party’s.',
      },
      {
        ro: 'Lista „Numere” arată golurile libere din serie și te lasă să rezervi un număr pentru un contract făcut în afara aplicației.',
        en: 'The “Numbers” list shows the free gaps in the series and lets you reserve a number for a contract made outside the app.',
      },
      {
        ro: 'La salvare, termenul preavizului intră ca eveniment în calendarul responsabilului. În fiecare zi la 08:00 vine o alertă cu 14 zile înainte (sau cât ai setat). Contractele cu reînnoire automată își mută singure data de sfârșit, cele fără reînnoire trec în „expirat”.',
        en: 'On save, the notice deadline becomes an event in the owner’s calendar. Every day at 08:00 an alert comes 14 days ahead (or as many as you set). Contracts with automatic renewal move their end date on their own; those without renewal become “expired”.',
      },
      {
        ro: 'Contractele sunt confidențiale: le vede doar adminul și responsabilul, iar pentru oricine altcineva contractul „nu există”.',
        en: 'Contracts are confidential: only the admin and the owner see them, and for anyone else the contract “does not exist”.',
      },
      {
        ro: 'Contractul SaaS al unui client se generează în continuare din fișa lui, iar când aplici o ofertă din calculator pe un client cu contract semnat, aplicația propune și actul adițional.',
        en: 'A client’s SaaS contract is still generated from the client sheet, and when you apply an offer from the calculator to a client with a signed contract, the app also offers the addendum.',
      },
    ],
  },
  {
    id: 'clienti-calculator',
    route: '/clients',
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
      {
        ro: 'Pe un prospect, „Salvează oferta pe prospect” păstrează intrările calculatorului; la promovare, oferta trece pe client. Pe un client, „Aplică la client” arată ce se schimbă (abonament, plan, module, operatori, puncte de lucru, taxă) și cere confirmarea.',
        en: 'On a prospect, “Save offer on prospect” keeps the calculator inputs; on promotion, the offer moves to the client. On a client, “Apply to client” shows what changes (subscription, plan, modules, operators, work sites, fee) and asks for confirmation.',
      },
      {
        ro: 'Dacă clientul are contract semnat și se schimbă prețul sau modulele, „Aplică și generează act adițional” face și actul. „Deschide în calculator” de pe fișa clientului reia intrările; apasă „Calculează” din nou.',
        en: 'If the client has a signed contract and the price or modules change, “Apply and generate addendum” makes the addendum too. “Open in calculator” on the client sheet reloads the inputs; press “Calculate” again.',
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
      {
        ro: 'Treci în „Index SPV” indexul primit la încărcare. Recipisa se confirmă singură când vine emailul ANAF; dacă depui pe codul special de TVA, emailul nu vine, așa că apeși „Am recipisa” după ce o vezi în SPV. Alerta „fără recipisă” se închide atunci.',
        en: 'Type the index SPV gave at upload under “SPV index”. The receipt confirms itself when the ANAF email arrives; filed on a special VAT code, that email never comes, so press “I have the receipt” once you see it in SPV. The “no receipt” alert closes then.',
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
    id: 'analitica',
    route: '/settings',
    feature: 'setari.analitica',
    title: {
      ro: 'Pornești analitica de utilizare',
      en: 'Turning on usage analytics',
    },
    summary: {
      ro: 'Cu PostHog vezi unde se blochează colegii: click-uri fără efect, click-uri repetate, erori și înregistrări ale sesiunilor. Textul și câmpurile sunt mascate în tot ce pleacă, deci notițele, emailurile și mesajele nu ajung la PostHog.',
      en: 'With PostHog you see where colleagues get stuck: dead clicks, rage clicks, errors and session recordings. Text and fields are masked in everything sent, so notes, emails and messages never reach PostHog.',
    },
    steps: [
      {
        ro: 'În PostHog, la Project settings, copiezi cheia proiectului (începe cu phc_) și o pui în Setări → Analitica de utilizare.',
        en: 'In PostHog, under Project settings, copy the project key (it starts with phc_) and paste it in Settings → Usage analytics.',
      },
      {
        ro: 'Gazda rămâne goală pentru proiectele din UE; pentru unul din SUA sau găzduit de voi, pui adresa lui.',
        en: 'Leave the host empty for EU projects; for a US or self-hosted one, enter its address.',
      },
      {
        ro: 'Colegii intră în PostHog la următoarea încărcare a aplicației. Ca să oprești, ștergi cheia și salvezi.',
        en: 'Colleagues show up in PostHog on the next app load. To stop, clear the key and save.',
      },
    ],
  },
  {
    id: 'setari-livekit',
    route: '/settings',
    feature: 'setari.apeluri',
    title: {
      ro: 'Configurezi apelurile LiveKit',
      en: 'Configuring LiveKit calls',
    },
    summary: {
      ro: 'Credențialele proiectului LiveKit Cloud stau criptate în baza firmei și deblochează apelurile video și audio E2EE.',
      en: 'Your LiveKit Cloud project credentials are stored encrypted per company and unlock E2EE audio and video calls.',
    },
    steps: [
      {
        ro: 'În LiveKit Cloud copiezi Project URL (`wss://…`), API Key și API Secret și le salvezi în Setări → Apeluri video și audio.',
        en: 'Copy the Project URL (`wss://…`), API Key and API Secret from LiveKit Cloud and save them under Settings → Video and audio calls.',
      },
      {
        ro: 'Apasă „Testează conexiunea” ca să verifici imediat că serverul răspunde cu cheile salvate.',
        en: 'Click “Test connection” to verify that LiveKit Cloud responds using the configured credentials.',
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
        ro: 'La Afișare alegi paleta de culori, limba interfeței și moneda în care vezi totalurile. Paleta se salvează pe contul tău; la schimbarea limbii pagina se reîncarcă.',
        en: 'Under Display you pick the colour palette, interface language and the currency totals are shown in. The palette is saved to your account; changing the language reloads the page.',
      },
      {
        ro: 'La Parolă scrii parola de acum și una nouă, de minim 12 caractere. Celelalte dispozitive sunt delogate.',
        en: 'Under Password you type the current password and a new one of at least 12 characters. Your other devices are logged out.',
      },
      {
        ro: 'La Notificări alegi despre ce ești anunțat: mesajele (toate sau doar cele directe), emailul nou pe cutiile tale și alertele.',
        en: 'Under Notifications you choose what you are told about: messages (all or only direct ones), new email in your mailboxes and alerts.',
      },
      {
        ro: 'La Dispozitive vezi unde ești logat: dispozitivul, ultima activitate și de când ești logat. Pe un rând care nu e al tău de acum apeși Deloghează și acolo va trebui să intri din nou cu parola; „Deloghează celelalte dispozitive” le scoate pe toate odată. Rămâi logat cât deschizi aplicația măcar o dată la 60 de zile.',
        en: 'Under Devices you see where you are logged in: the device, the last activity and since when. On a row that is not your current one, press Log out and that device will have to log in again with the password; “Log out other devices” removes them all at once. You stay logged in as long as you open the app at least once every 60 days.',
      },
      {
        ro: 'La Token-uri API (apare doar dacă adminul ți-a pornit funcția) faci un token pentru terminal sau Claude Code. Alegi un nume, drepturile și cât ține. Implicit e doar citire; bifezi în plus doar ce trebuie să scrie. Valoarea o vezi o singură dată: copiaz-o atunci. Un token care nu mai trebuie îl revoci din aceeași listă, iar efectul e imediat. Adminul vede token-urile firmei în Echipă.',
        en: 'Under API tokens (shown only if the admin turned the feature on for you) you make a token for a terminal or Claude Code. You pick a name, the rights and how long it lasts. It is read-only by default; tick more only for what it has to write. You see the value only once, so copy it then. A token you no longer need is revoked from the same list, and it stops at once. The admin sees the company’s tokens in Team.',
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
