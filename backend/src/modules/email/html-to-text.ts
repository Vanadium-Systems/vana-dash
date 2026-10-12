import { convert } from 'html-to-text'

// Unele expeditoare (ANAF SPV confirmat, probabil alte sisteme automate) trimit DOAR
// text/html, fără alternativă text/plain — fără conversie, HTML-ul brut ajungea stocat ca
// `bodyText` și se vedea ca text simplu cu tag-uri (`<html><body><p>...`) în UI (raportat de
// Stefan, 2026-07-18). Randăm mereu text simplu (nu HTML sanitizat/iframe — ar fi mult mai
// mult efort/suprafață de atac pt. un tool personal), deci convertim o singură dată, la ingest.
export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', format: 'inline' },
      { selector: 'img', format: 'skip' },
      { selector: 'hr', format: 'skip' }, // linia "----..." nu ajută cu nimic într-o bulă îngustă de chat
    ],
  }).trim()
}
