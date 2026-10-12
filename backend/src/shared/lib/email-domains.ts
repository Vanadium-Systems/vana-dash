// Domenii publice de webmail — folosite ca să NU facem match pe domeniu întreg în euristici
// de reply/dezabonare (ex: sequences-service.ts::stopSequencesForReplyFrom). Un răspuns de pe
// @yahoo.com nu înseamnă că ORICE alt destinatar @yahoo.com trebuie tratat la fel — bug real,
// 2026-09-03 (Stefan: un singur răspuns de pe Yahoo a oprit jumătate din lista unei secvențe).
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.ro',
  'yahoo.co.uk',
  'ymail.com',
  'outlook.com',
  'outlook.ro',
  'hotmail.com',
  'hotmail.ro',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'yandex.com',
  'yandex.ru',
  'gmx.com',
  'gmx.net',
  'mail.ru',
  'zoho.com',
  'zohomail.com',
  'tutanota.com',
  'fastmail.com',
  'rocketmail.com',
  'inbox.com',
  'seznam.cz',
  'web.de',
  't-online.de',
])

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase())
}
