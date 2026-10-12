import { htmlToPlainText } from './html-to-text.js'
import { getEmailSettings } from './settings-service.js'

// Extras din service.ts (Wave 1, doar Compose avea semnătură) — reutilizat acum și de
// replyToThread/forwardMessage din inbound-service.ts (bug găsit de Stefan, 2026-07-17:
// reply/forward nu adăugau NICIODATĂ semnătura, deși UI-ul de Compose sugera că "se adaugă
// automat la trimitere" universal).

// outreach (2026-08-12) reutilizează semnătura 'contact' (aceeași identitate de firmă, no bloat
// — nu o a 3-a semnătură separată; de revizuit dacă Stefan vrea ton distinct pt. cold outreach).
// Din sprintul de-hardcodare (2026-08-25) identitățile sunt dinamice — orice cheie nouă primește
// semnătura de firmă (contact), ca outreach-ul.
export type EmailFromKey = string

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function textToHtmlParagraph(text: string): string {
  return escapeHtml(text)
    .split('\n')
    .map((line) => `<p style="margin:0 0 12px">${line || '&nbsp;'}</p>`)
    .join('')
}

/**
 * Semnătură auto-atașată — text simplu + variantă HTML cu logo (dacă unul e configurat).
 * Citește din dashboard_config (Setări Email, editabil din UI), NU din `.env` — decizia
 * fixată în PLAN.md. `config.email*` rămâne doar fallback (implicit în getEmailSettings).
 *
 * 2026-08-11 — semnătura e acum HTML (editor rich-text, SettingsTab.tsx), la fel ca body-ul
 * emailurilor (bug Stefan: o semnătură text simplu arăta nepotrivit sub un body stilizat HTML,
 * gen template-uri de outreach). Text simplu derivat din HTML (htmlToPlainText), nu invers.
 * Semnături vechi (plain text, dinainte de editor) rămân valide — RichTextEditor.tsx le
 * convertește o singură dată la încărcare (legacyBodyToHtml), la fel ca drafturile/template-urile.
 *
 * 2026-09-30 — per identitate de trimitere, nu două câmpuri fixe: cu cutiile împărțite pe
 * oameni, sales@ își are semnătura ei. O identitate fără rând primește semnătura de firmă, iar
 * șirul gol înseamnă „fără semnătură" — nici linia separatoare.
 */
export async function buildSignature(from: EmailFromKey): Promise<{ text: string; html: string }> {
  const settings = await getEmailSettings()
  // Cheie necunoscută (identitate scoasă din Setări) → semnătura de firmă, ca până acum.
  const signatureHtml = settings.signatures[from] ?? settings.signatures['contact'] ?? ''
  if (!signatureHtml.trim()) return { text: '', html: '' }
  const logo = settings.logoUrl
    ? `<br><img src="${settings.logoUrl}" alt="" style="max-height:48px;margin-top:8px;display:block">`
    : ''
  return {
    text: `\n\n--\n${htmlToPlainText(signatureHtml)}`,
    html: `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e5e5;color:#555;font-size:13px">${signatureHtml}${logo}</div>`,
  }
}
