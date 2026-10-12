// `html-to-text` nu vine cu tipuri proprii, iar @types/html-to-text e pinat pe major v9
// (avem v10 instalat) — declarație minimă, doar pt. `convert`, funcția singură folosită
// (backend/src/modules/email/html-to-text.ts).
declare module 'html-to-text' {
  export interface HtmlToTextOptions {
    wordwrap?: number | false
    selectors?: Array<{ selector: string; format?: string }>
  }
  export function convert(html: string, options?: HtmlToTextOptions): string
}
