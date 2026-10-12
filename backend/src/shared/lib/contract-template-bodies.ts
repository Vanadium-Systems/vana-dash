// Sample contract texts, with {{token}} placeholders. They are short on purpose: enough to show
// every token and every conditional clause at work, not a contract to send to a client. An
// installation replaces them from the templates screen; what is saved in the database wins over
// this file (see modules/contracts/templates-service.ts).

export const CONTRACT_TEMPLATE_KEYS = ['contract-saas', 'anexa-preturi', 'act-aditional'] as const
export type ContractTemplateKey = (typeof CONTRACT_TEMPLATE_KEYS)[number]

// The page-break rules keep a table row or the signature block from splitting across pages
// in the PDF.
const BASE_STYLE = `
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.45; margin: 0; padding: 8mm; }
  h1.doc-title { font-size: 19px; color: #0f2447; text-align: center; margin: 0 0 4px; }
  .doc-subtitle { text-align: center; font-size: 13px; font-weight: bold; margin: 0 0 4px; }
  .doc-number { text-align: center; font-size: 12px; margin: 0 0 16px; }
  h2.art { font-size: 13px; color: #0f2447; margin: 13px 0 5px; }
  h2.sect { font-size: 14px; color: #0f2447; margin: 13px 0 4px; border-bottom: 1px solid #0f2447; padding-bottom: 4px; }
  p.subart { margin: 4px 0; text-align: justify; }
  p.subart strong.label { white-space: nowrap; }
  ul { margin: 4px 0; padding-left: 20px; }
  li { margin-bottom: 3px; text-align: justify; }
  table.info { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
  table.info tr { page-break-inside: avoid; }
  table.info tr:first-child { page-break-after: avoid; }
  table.info th, table.info td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  table.info th { color: #666; font-weight: normal; width: 32%; }
  table.info thead th, table.info tr:first-child th { color: #0f2447; font-weight: bold; width: auto; }
  .party { margin: 8px 0; }
  .signatures { display: flex; justify-content: space-between; margin-top: 24px; page-break-inside: avoid; }
  .signature-block { width: 44%; text-align: center; }
  .signature-line { border-top: 1px solid #1a1a1a; margin-top: 40px; padding-top: 4px; font-size: 10px; color: #444; }
  .page-break { page-break-before: always; }
  .note { font-size: 10.5px; color: #555; font-style: italic; }
`

function docShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ro">
<head><meta charset="utf-8"><style>${BASE_STYLE}</style><title>${title}</title></head>
<body>${bodyHtml}</body>
</html>`
}

const SAMPLE_NOTE = `
    <p class="note">Text de exemplu, fără valoare juridică. Înlocuiește-l cu textul contractului tău înainte de a-l trimite unui client.</p>`

const SIGNATURES = `
  <div class="signatures">
    <div class="signature-block">
      <strong>PRESTATOR</strong><br>{{prestator.nume}}<br>{{prestator.reprezentant}}
      <div class="signature-line">Semnătură și ștampilă, Data: __________</div>
    </div>
    <div class="signature-block">
      <strong>CLIENT</strong><br>{{client.nume}}<br>{{client.reprezentant}}
      <div class="signature-line">Semnătură și ștampilă, Data: __________</div>
    </div>
  </div>`

const PARTIES = `
    <p class="party"><strong>PRESTATOR:</strong> {{prestator.nume}}, cu sediul în {{prestator.adresa}}, înregistrată la
      Registrul Comerțului sub nr. {{prestator.nrRegCom}}, CUI {{prestator.cui}}, reprezentată prin
      {{prestator.reprezentant}}, denumită în continuare <strong>„Prestatorul”</strong>.</p>
    <p class="party"><strong>CLIENT:</strong> {{client.nume}}, cu sediul în {{client.adresa}}, înregistrată la
      Registrul Comerțului sub nr. {{client.regCom}}, CUI {{client.cif}}, reprezentată prin {{client.reprezentant}},
      în calitate de {{client.functie}}, denumită în continuare <strong>„Clientul”</strong>.</p>`

const CONTRACT_SAAS_BODY = `
    <h1 class="doc-title">CONTRACT DE SERVICII</h1>
    <div class="doc-subtitle">ABONAMENT SOFTWARE CA SERVICIU (SaaS)</div>
    <div class="doc-number">Nr. {{nrContract}} / {{dataContract}}</div>${SAMPLE_NOTE}

    <h2 class="art">Art. 1. PĂRȚILE</h2>${PARTIES}

    <h2 class="art">Art. 2. DEFINIȚII</h2><ul>
      <li><strong>„Serviciul”:</strong> aplicația pusă la dispoziție de Prestator, în configurația din Anexa de Prețuri;</li>
      <li><strong>„Taxa de Inițiere”:</strong> {{defTaxaInitiere}}</li>{{defLunaGratuita}}
      <li><strong>„Zi Lucrătoare”:</strong> orice zi de luni până vineri, în afara sărbătorilor legale.</li>
    </ul>

    <h2 class="art">Art. 3. OBIECTUL CONTRACTULUI</h2><p class="subart"><strong class="label">3.1.</strong> Prestatorul dă Clientului acces la Serviciu, iar Clientul plătește tariful din Anexa de Prețuri, care face parte din contract.</p>

    <h2 class="art">Art. 4. TAXA DE INIȚIERE</h2><p class="subart"><strong class="label">4.1.</strong> Clientul plătește o Taxă de Inițiere unică de {{taxaInitiere}} (fără TVA), pentru configurare și instruire.</p><p class="subart"><strong class="label">4.2.</strong> {{clauza42}}</p><p class="subart"><strong class="label">4.3.</strong> {{clauza43}}</p>

    <h2 class="art">Art. 5. TARIF ȘI FACTURARE</h2><p class="subart"><strong class="label">5.1.</strong> Tariful de abonament este de {{monthlyPrice}} (fără TVA).</p><p class="subart"><strong class="label">5.2.</strong> Ciclul de facturare ales de Client: {{facturareTip}}. Abonamentul se reînnoiește automat la finalul fiecărui ciclu.</p><p class="subart"><strong class="label">5.3.</strong> Facturile sunt scadente în termen de {{termenScadenta}} de la emitere. După o perioadă de grație de {{gratiePlata}} se aplică penalități de {{penalitateIntarziere}} din suma restantă.</p><p class="subart"><strong class="label">5.4.</strong> {{clauza55}}</p><p class="subart"><strong class="label">5.5.</strong> Pentru un client nou recomandat, ambele părți primesc o reducere de {{referralReducere}} (echivalentul a {{referralDurata}} de abonament), cel mult {{referralPlafon}} din abonamentul propriu.</p>

    <h2 class="art">Art. 6. NIVELUL SERVICIULUI</h2><p class="subart"><strong class="label">6.1.</strong> Disponibilitatea garantată este de <strong>{{slaUptime}}</strong> pe lună. Mentenanța planificată: {{slaMentenanta}}.</p><p class="subart"><strong class="label">6.2.</strong> Suport: {{prestator.email}}, {{prestator.telefon}}.</p>

    <h2 class="art">Art. 7. DURATĂ ȘI ÎNCETARE</h2><p class="subart"><strong class="label">7.1.</strong> {{clauza131}}</p><p class="subart"><strong class="label">7.2.</strong> {{clauza132}}</p><p class="subart"><strong class="label">7.3.</strong> Oricare parte poate înceta contractul cu un preaviz scris de {{preavizReziliere}}.</p><p class="subart"><strong class="label">7.4.</strong> {{clauza135}}</p>

    <h2 class="art">Art. 8. DISPOZIȚII FINALE</h2><p class="subart"><strong class="label">8.1.</strong> Contractul, Anexa de Prețuri și Acordul de prelucrare a datelor formează înțelegerea completă a părților. Orice modificare se face prin act adițional.</p>

    <p class="note">Semnat în două exemplare, câte unul pentru fiecare parte.</p>
${SIGNATURES}

    <div class="page-break"></div>

    <h1 class="doc-title">ACORD DE PRELUCRARE A DATELOR</h1>
    <div class="doc-number">la Contractul de Servicii nr. {{nrContract}} / {{dataContract}}</div>

    <h2 class="art">Art. DPA 1. ROLURI</h2><p>Clientul este operator, iar Prestatorul este persoană împuternicită, în sensul Regulamentului (UE) 2016/679.</p>

    <h2 class="art">Art. DPA 2. SUB-PROCESORI</h2><p>Prestatorul folosește următorii sub-procesori: furnizorul de găzduire{{subprocesorAiExtra}}.</p>

    <h2 class="art">Art. DPA 3. TRANSFERURI</h2>{{paragrafTransferuri}}
${SIGNATURES}`

const ANEXA_PRETURI_BODY = `
    <h1 class="doc-title">ANEXA DE PREȚURI</h1>
    <div class="doc-number">la Contractul de Servicii nr. {{nrContract}} / {{dataContract}}</div>${SAMPLE_NOTE}
    <table class="info">
      <tr><th>PRESTATOR</th><td>{{prestator.nume}} · CUI {{prestator.cui}} · {{prestator.nrRegCom}}</td></tr>
      <tr><th>CLIENT</th><td>{{client.nume}} · CUI {{client.cif}} · {{client.regCom}}</td></tr>
    </table>

    <h2 class="sect">1. Abonamentul</h2><table class="info">
      <tr><th>Tarif lunar</th><td><strong>{{monthlyPrice}}</strong> (fără TVA)</td></tr>
      <tr><th>Taxa de inițiere</th><td><strong>{{taxaInitiere}}</strong> (o singură dată)</td></tr>
      <tr><th>Ciclu de facturare</th><td>{{facturareTip}}</td></tr>
    </table>
    <table class="info">
      <tr><th>Operatori gestiune</th><td>{{operatoriGestiune}}</td></tr>
      <tr><th>Operatori teren</th><td>{{operatoriTeren}}</td></tr>
      <tr><th>Puncte de lucru</th><td>{{puncteLucru}}</td></tr>
      <tr><th>Documente incluse / lună</th><td>{{documenteIncluse}}</td></tr>
      <tr><th>Flux</th><td>{{flux}}</td></tr>
      <tr><th>Module active</th><td>{{moduleAddon}}</td></tr>
    </table>

    <h2 class="sect">2. {{anexaSect3Titlu}}</h2><p>{{anexaSect3Intro}}</p>
    <table class="info">
      <tr><th>Descriere</th><th>Valoare (fără TVA)</th><th>Scadență</th></tr>
      <tr><td>Taxă de inițiere</td><td>{{taxaInitiere}}</td><td>{{anexaScadentaInitiere}}</td></tr>
    </table>
    <p>Reducere prin recomandare: {{referralReducere}} (echivalentul a {{referralDurata}} de abonament), cel mult {{referralPlafon}} din abonamentul propriu.</p>

    <h2 class="sect">3. Termene de plată</h2><table class="info">
      <tr><th>Scadența facturii</th><td>{{termenScadenta}} de la emitere</td></tr>
      <tr><th>Perioada de grație</th><td>{{gratiePlata}} după scadență</td></tr>
      <tr><th>Penalități de întârziere</th><td>{{penalitateIntarziere}} din suma restantă</td></tr>
    </table>

    <h2 class="sect">4. Nivelul serviciului</h2><table class="info">
      <tr><th>Disponibilitate garantată</th><td>{{slaUptime}} / lună</td></tr>
      <tr><th>Mentenanță planificată</th><td>{{slaMentenanta}}</td></tr>
      <tr><th>Răspuns suport, critic</th><td>{{slaP1}}</td></tr>
      <tr><th>Răspuns suport, normal</th><td>{{slaP2}}</td></tr>
      <tr><th>Suport</th><td>{{prestator.email}} · {{prestator.telefon}}</td></tr>
    </table>

    <h2 class="sect">5. Condiții speciale</h2><p>{{conditiiSpeciale}}</p>
${SIGNATURES}`

const ACT_ADITIONAL_BODY = `
    <h1 class="doc-title">ACT ADIȚIONAL NR. {{actNumar}}</h1>
    <div class="doc-subtitle">la Contractul de Servicii nr. {{nrContract}} / {{dataContract}}</div>
    <div class="doc-number">{{actDataEmitere}}</div>${SAMPLE_NOTE}

    <p>Prezentul act adițional se încheie între:</p>${PARTIES}

    <h2 class="art">Art. 1. OBIECT</h2><p class="subart"><strong class="label">1.1.</strong> Părțile modifică tariful de abonament din Anexa de Prețuri. Restul contractului rămâne neschimbat.</p>

    <h2 class="art">Art. 2. MODIFICAREA TARIFULUI</h2><table class="info">
      <tr><th>Tarif anterior</th><td>{{tarifAnterior}}</td></tr>
      <tr><th>Tarif nou</th><td><strong>{{tarifNou}}</strong></td></tr>
      <tr><th>Motivul modificării</th><td>{{motivModificare}}</td></tr>
      <tr><th>Data intrării în vigoare</th><td>{{dataIntrareVigoare}}</td></tr>
    </table>{{sectiuneTemporaraAct}}

    <h2 class="art">Art. {{nrArticolFinalAct}}. DISPOZIȚII FINALE</h2><p class="subart"><strong class="label">{{nrArticolFinalAct}}.1</strong> Actul adițional face parte din contract.</p>

    <p class="note">Semnat în două exemplare, câte unul pentru fiecare parte.</p>
${SIGNATURES}`

// Conditional fragments: text that enters a template only in some cases (temporary addendum,
// AI module on, with or without a free month). The engine picks the variant and puts it at the
// token of the same name. The free-month variants may use three tokens:
// {{lunaGratuitaDurata}}, {{termenConfirmareContinuare}}, {{nrZileOnboarding}}.
export const LUNA_GRATUITA_KEYS = [
  'defTaxaInitiere',
  'defLunaGratuita',
  'clauza42',
  'clauza43',
  'clauza55',
  'clauza131',
  'clauza132',
  'clauza135',
  'anexaSect3Titlu',
  'anexaSect3Intro',
  'anexaScadentaInitiere',
] as const
export type LunaGratuitaKey = (typeof LUNA_GRATUITA_KEYS)[number]

export interface ContractFragments {
  sectiuneTemporaraAct: string
  subprocesorAiExtra: string
  paragrafTransferuriCuAi: string
  paragrafTransferuriFaraAi: string
  cuLunaGratuita: Record<LunaGratuitaKey, string>
  faraLunaGratuita: Record<LunaGratuitaKey, string>
}

export const DEFAULT_CONTRACT_FRAGMENTS: ContractFragments = {
  sectiuneTemporaraAct: `
    <h2 class="art">Art. 3. CARACTER TEMPORAR</h2><p class="subart"><strong class="label">3.1.</strong> Tariful nou este temporar. {{notaRevenire}}</p>`,
  subprocesorAiExtra: ', iar pentru clienții cu asistentul AI activ, furnizorul modelului AI',
  paragrafTransferuriCuAi:
    '<p>Datele sunt stocate în Uniunea Europeană. Mesajele trimise asistentului AI pot fi prelucrate în afara Uniunii Europene, de sub-procesorul de la DPA 2.</p>',
  paragrafTransferuriFaraAi: '<p>Datele sunt stocate și prelucrate numai în Uniunea Europeană.</p>',
  cuLunaGratuita: {
    defTaxaInitiere: 'tariful unic pentru configurare și instruire, facturat la finalul Lunii Gratuite;',
    defLunaGratuita: '<li><strong>„Luna Gratuită”:</strong> prima lună de la activarea contului, fără cost de abonament;</li>',
    clauza42: 'Taxa de Inițiere devine datorată numai dacă Clientul confirmă continuarea la finalul Lunii Gratuite.',
    clauza43: 'Prestatorul activează contul în {{nrZileOnboarding}} Zile Lucrătoare de la primirea datelor necesare.',
    clauza55: '<strong>Luna Gratuită.</strong> Prima {{lunaGratuitaDurata}} de la activarea contului este fără cost de abonament.',
    clauza131: 'Contractul produce efecte de la activarea contului și se încheie pe durată nedeterminată.',
    clauza132:
      'Dacă Clientul nu confirmă continuarea în {{termenConfirmareContinuare}} de la finalul Lunii Gratuite, contractul încetează fără nicio sumă datorată.',
    clauza135: 'La încetare, accesul este dezactivat, iar Clientul își poate exporta datele timp de 30 de zile.',
    anexaSect3Titlu: 'Luna gratuită și taxa de inițiere',
    anexaSect3Intro: 'Prima {{lunaGratuitaDurata}} de la activarea contului este gratuită. Taxa de inițiere se facturează la finalul ei.',
    anexaScadentaInitiere: 'La finalul Lunii Gratuite',
  },
  faraLunaGratuita: {
    defTaxaInitiere: 'tariful unic pentru configurare și instruire, facturat la semnarea contractului;',
    defLunaGratuita: '',
    clauza42: 'Taxa de Inițiere devine datorată la semnarea contractului.',
    clauza43: 'Prestatorul activează contul în {{nrZileOnboarding}} Zile Lucrătoare de la semnarea contractului.',
    clauza55: '<strong>Facturare.</strong> Prima lună de abonament se facturează la semnarea contractului.',
    clauza131: 'Contractul produce efecte de la semnare și se încheie pe durată nedeterminată.',
    clauza132: 'Contractul nu include o perioadă gratuită.',
    clauza135: 'La încetare, accesul este dezactivat, iar Clientul își poate exporta datele timp de 30 de zile.',
    anexaSect3Titlu: 'Taxa de inițiere',
    anexaSect3Intro: 'Taxa de inițiere se facturează la semnarea contractului.',
    anexaScadentaInitiere: 'La semnarea contractului',
  },
}

export const CONTRACT_TEMPLATE_BODIES: Record<ContractTemplateKey, string> = {
  'contract-saas': docShell('Contract SaaS · {{client.nume}}', CONTRACT_SAAS_BODY),
  'anexa-preturi': docShell('Anexa de Prețuri · {{client.nume}}', ANEXA_PRETURI_BODY),
  'act-aditional': docShell('Act Adițional nr. {{actNumar}} · {{client.nume}}', ACT_ADITIONAL_BODY),
}

export interface ContractPlaceholderDoc {
  token: string
  descriere: string
  exemplu: string
}

const CLIENT_DOCS: ContractPlaceholderDoc[] = [
  { token: 'client.nume', descriere: 'Denumirea juridică a clientului', exemplu: 'Acme Recycling SRL' },
  { token: 'client.adresa', descriere: 'Sediul social al clientului', exemplu: 'Brașov, Str. Lungă nr. 10' },
  { token: 'client.regCom', descriere: 'Număr în Registrul Comerțului', exemplu: 'J08/1234/2019' },
  { token: 'client.cif', descriere: 'Codul unic de înregistrare', exemplu: '12345678' },
  { token: 'client.reprezentant', descriere: 'Persoana de contact semnatare', exemplu: 'Ion Popescu' },
  { token: 'client.functie', descriere: 'Funcția reprezentantului', exemplu: 'Administrator' },
]

const PRESTATOR_DOCS: ContractPlaceholderDoc[] = [
  { token: 'prestator.nume', descriere: 'Denumirea firmei tale', exemplu: 'Acme Software SRL' },
  { token: 'prestator.adresa', descriere: 'Sediul firmei tale', exemplu: 'Brașov, Str. Scurtă nr. 1' },
  { token: 'prestator.nrRegCom', descriere: 'Numărul tău în Registrul Comerțului', exemplu: 'J08/4321/2020' },
  { token: 'prestator.cui', descriere: 'Codul unic de înregistrare al firmei tale', exemplu: '87654321' },
  { token: 'prestator.reprezentant', descriere: 'Reprezentantul legal al firmei tale', exemplu: 'Ana Ionescu' },
  { token: 'prestator.email', descriere: 'Emailul de suport', exemplu: 'contact@example.com' },
  { token: 'prestator.telefon', descriere: 'Telefonul de suport', exemplu: '0700 000 000' },
]

const TERMS_DOCS: ContractPlaceholderDoc[] = [
  { token: 'termenScadenta', descriere: 'Scadența facturilor', exemplu: '10 zile' },
  { token: 'penalitateIntarziere', descriere: 'Penalitatea de întârziere', exemplu: '0,2% / zi' },
  { token: 'gratiePlata', descriere: 'Perioada de grație după scadență', exemplu: '20 zile' },
  { token: 'preavizReziliere', descriere: 'Preavizul de încetare', exemplu: '30 zile' },
  { token: 'lunaGratuitaDurata', descriere: 'Durata lunii gratuite', exemplu: '1 lună' },
  { token: 'referralReducere', descriere: 'Reducerea pt. recomandări', exemplu: '30%' },
  { token: 'referralDurata', descriere: 'Echivalentul reducerii referral', exemplu: '1 lună' },
  { token: 'referralPlafon', descriere: 'Plafonul reducerii referral', exemplu: '90%' },
  { token: 'slaUptime', descriere: 'Uptime garantat', exemplu: '99,9%' },
  { token: 'slaMentenanta', descriere: 'Fereastra de mentenanță', exemplu: 'Duminică, 02:00–06:00 EET' },
  { token: 'slaP1', descriere: 'Răspuns suport P1', exemplu: '4 ore lucrătoare' },
  { token: 'slaP2', descriere: 'Răspuns suport P2', exemplu: '24 ore lucrătoare' },
]

const COMMON_DOC_DOCS: ContractPlaceholderDoc[] = [
  { token: 'nrContract', descriere: 'Numărul contractului', exemplu: '010' },
  { token: 'dataContract', descriere: 'Data contractului', exemplu: '1 august 2026' },
]

const SAAS_ONLY_DOCS: ContractPlaceholderDoc[] = [
  { token: 'monthlyPrice', descriere: 'Tariful lunar formatat', exemplu: '100 EUR/lună' },
  { token: 'taxaInitiere', descriere: 'Taxa de inițiere', exemplu: '100 EUR' },
  { token: 'nrZileOnboarding', descriere: 'Zile lucrătoare de onboarding', exemplu: '5' },
  { token: 'facturareTip', descriere: 'Ciclul de facturare', exemplu: 'LUNAR' },
  { token: 'subprocesorAiExtra', descriere: 'Fragment: sub-procesorul pentru AI (doar cu modulul AI)', exemplu: '—' },
  { token: 'paragrafTransferuri', descriere: 'Bloc: paragraful despre transferuri (variază cu modulul AI)', exemplu: '—' },
  { token: 'defTaxaInitiere', descriere: 'Definiția Taxei de Inițiere (variază cu Luna Gratuită)', exemplu: '—' },
  { token: 'defLunaGratuita', descriere: 'Definiția Lunii Gratuite (gol dacă nu se oferă)', exemplu: '—' },
  { token: 'clauza42', descriere: 'Clauză: când devine datorată Taxa de Inițiere', exemplu: '—' },
  { token: 'clauza43', descriere: 'Clauză: termenul de activare a contului', exemplu: '—' },
  { token: 'clauza55', descriere: 'Clauză: Luna Gratuită sau facturare la semnare', exemplu: '—' },
  { token: 'clauza131', descriere: 'Clauză: de când produce efecte contractul', exemplu: '—' },
  { token: 'clauza132', descriere: 'Clauză: ce se întâmplă fără confirmare după Luna Gratuită', exemplu: '—' },
  { token: 'clauza135', descriere: 'Clauză: încetarea contractului', exemplu: '—' },
]

const ANEXA_ONLY_DOCS: ContractPlaceholderDoc[] = [
  ...SAAS_ONLY_DOCS.filter((d) =>
    ['monthlyPrice', 'taxaInitiere', 'facturareTip'].includes(d.token),
  ),
  { token: 'operatoriGestiune', descriere: 'Operatori desktop din configurație', exemplu: '2' },
  { token: 'operatoriTeren', descriere: 'Operatori mobil din configurație', exemplu: '3' },
  { token: 'puncteLucru', descriere: 'Puncte de lucru', exemplu: '1' },
  { token: 'documenteIncluse', descriere: 'Documente incluse / lună', exemplu: '150' },
  { token: 'flux', descriere: 'Fluxul de reciclare', exemplu: 'DEEE' },
  { token: 'moduleAddon', descriere: 'Module add-on active', exemplu: 'VanaGreen AI' },
  { token: 'conditiiSpeciale', descriere: 'Condiții speciale negociate', exemplu: '(fără condiții speciale)' },
  { token: 'anexaSect3Titlu', descriere: 'Titlul secțiunii despre taxa de inițiere (variază cu Luna Gratuită)', exemplu: '—' },
  { token: 'anexaSect3Intro', descriere: 'Introducerea aceleiași secțiuni (variază cu Luna Gratuită)', exemplu: '—' },
  { token: 'anexaScadentaInitiere', descriere: 'Scadența taxei de inițiere (variază cu Luna Gratuită)', exemplu: '—' },
]

const ACT_ONLY_DOCS: ContractPlaceholderDoc[] = [
  ...COMMON_DOC_DOCS,
  { token: 'actNumar', descriere: 'Numărul actului adițional', exemplu: '1' },
  { token: 'actDataEmitere', descriere: 'Data emiterii actului', exemplu: '2026-07-20' },
  { token: 'tarifAnterior', descriere: 'Tariful dinainte de modificare', exemplu: '100 RON/lună (fără TVA)' },
  { token: 'tarifNou', descriere: 'Tariful nou', exemplu: '40 EUR/lună (fără TVA)' },
  { token: 'motivModificare', descriere: 'Motivul modificării de tarif', exemplu: 'extinderea Serviciului' },
  { token: 'dataIntrareVigoare', descriere: 'Data intrării în vigoare', exemplu: 'data semnării' },
  { token: 'notaRevenire', descriere: 'Detaliu revenire tarif (doar act temporar)', exemplu: 'Revine la tariful vechi după 3 luni.' },
  { token: 'sectiuneTemporaraAct', descriere: 'Bloc: articolul despre caracterul temporar (gol dacă actul e definitiv)', exemplu: '—' },
  { token: 'nrArticolFinalAct', descriere: 'Numărul articolului final (3 sau 4 la act temporar)', exemplu: '4' },
]

export const CONTRACT_TEMPLATE_PLACEHOLDERS: Record<ContractTemplateKey, ContractPlaceholderDoc[]> = {
  'contract-saas': [...COMMON_DOC_DOCS, ...SAAS_ONLY_DOCS, ...CLIENT_DOCS, ...PRESTATOR_DOCS, ...TERMS_DOCS],
  'anexa-preturi': [...COMMON_DOC_DOCS, ...ANEXA_ONLY_DOCS, ...CLIENT_DOCS, ...PRESTATOR_DOCS, ...TERMS_DOCS],
  'act-aditional': [...ACT_ONLY_DOCS, ...CLIENT_DOCS, ...PRESTATOR_DOCS],
}
