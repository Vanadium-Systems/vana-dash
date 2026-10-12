// @vitest-environment jsdom
/**
 * SEC (obligatoriu, cf. PLAN.md Sprint 3, nu opțional): payload-uri XSS cunoscute trebuie
 * neutralizate de DOMPurify. Plus: rescrierea cid: e strict scopată pe atașamentele mesajului
 * curent (array-ul primit, nu o căutare globală) + gating imagini externe by-default.
 */
import { describe, expect, it, vi } from 'vitest'
import type { EmailAttachmentMeta } from '@/shared/lib/types'
import { MAX_INLINE_HTML_CHARS, renderMessageHtml, rewriteCidReferences, sanitizeAndGateImages } from './HtmlMessageBody'

function attachment(overrides: Partial<EmailAttachmentMeta> = {}): EmailAttachmentMeta {
  return {
    id: 'att-1',
    messageId: 'msg-1',
    filename: 'logo.png',
    contentType: 'image/png',
    // Format realist — header-ul MIME real `Content-ID:` vine cu `<...>` (RFC 2392/2111),
    // nu ca string gol. Un fixture fără paranteze unghiulare a lăsat regresia netestabilă
    // (testul trecea, dar attachment.contentId nenormalizat nu se potrivea niciodată în prod).
    contentId: '<logo123@vanadium.systems>',
    disposition: 'inline',
    ...overrides,
  }
}

describe('sanitizeAndGateImages — payload-uri XSS cunoscute', () => {
  it('elimină <script>', () => {
    const { html } = sanitizeAndGateImages('<p>salut</p><script>alert(1)</script>', true)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('elimină onerror= pe <img>', () => {
    const { html } = sanitizeAndGateImages('<img src="x" onerror="alert(1)">', true)
    expect(html.toLowerCase()).not.toContain('onerror')
  })

  it('elimină onclick= și alte event handlere', () => {
    const { html } = sanitizeAndGateImages('<div onclick="alert(1)" onmouseover="alert(2)">click</div>', true)
    expect(html.toLowerCase()).not.toContain('onclick')
    expect(html.toLowerCase()).not.toContain('onmouseover')
  })

  it('neutralizează javascript: URIs în href', () => {
    const { html } = sanitizeAndGateImages('<a href="javascript:alert(1)">link</a>', true)
    expect(html.toLowerCase()).not.toContain('javascript:')
  })

  it('neutralizează data: URI cu HTML/script embedat în href (nu doar imagini)', () => {
    // data:text/html;base64,... care ar deschide un mini-document HTML cu <script> — DOMPurify
    // trebuie să respingă URI-uri data: în context href (diferit de <img src="data:image/...">,
    // care e o folosire legitimă comună și nu execută cod).
    const payload = '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>'
    const { html } = sanitizeAndGateImages(payload, true)
    expect(html.toLowerCase()).not.toContain('data:text/html')
  })

  it('un <img src="data:..."> nu execută cod (nu conține onload/onerror după sanitizare)', () => {
    // svg cu onload embedat într-un data URI de imagine — chiar dacă src="data:image/svg+xml..."
    // e permis structural, orice onload/onerror pe elementul <img> propriu-zis tot trebuie eliminat.
    const { html } = sanitizeAndGateImages('<img src="data:image/svg+xml;base64,PHN2Zy8+" onload="alert(1)">', true)
    expect(html.toLowerCase()).not.toContain('onload')
  })

  it('elimină SVG cu <script> embedat', () => {
    const { html } = sanitizeAndGateImages('<svg><script>alert(1)</script></svg>', true)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('elimină <iframe>/<object>/<embed>/<form>/<link>', () => {
    const dangerous = '<iframe src="//evil.example"></iframe><object data="x"></object><embed src="x"><form action="//evil.example"></form><link rel="stylesheet" href="//evil.example">'
    const { html } = sanitizeAndGateImages(dangerous, true)
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<object')
    expect(html).not.toContain('<embed')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<link')
  })

  it('elimină <style> (decizie MVP — CSS-based tracking prin background:url())', () => {
    const { html } = sanitizeAndGateImages('<style>body{background:url(//evil.example/track.png)}</style><p>ok</p>', true)
    expect(html).not.toContain('<style')
  })

  it('păstrează markup inofensiv (paragrafe, linkuri http(s) fără javascript:, formatare)', () => {
    const { html } = sanitizeAndGateImages('<p><b>salut</b> <a href="https://example.com">link</a></p>', true)
    expect(html).toContain('<b>salut</b>')
    expect(html).toContain('href="https://example.com"')
  })
})

describe('sanitizeAndGateImages — gating imagini externe', () => {
  it('blochează by-default o imagine externă (http/https, nu /api/email/attachments/)', () => {
    const { html, hasExternalImages } = sanitizeAndGateImages('<img src="https://evil.example/track.png">', false)
    expect(hasExternalImages).toBe(true)
    const container = document.createElement('div')
    container.innerHTML = html
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBeNull() // niciun request de fetch declanșat automat
    expect(img?.getAttribute('data-blocked-src')).toBe('https://evil.example/track.png')
  })

  it('NU blochează o imagine proprie (/api/email/attachments/...)', () => {
    const { html, hasExternalImages } = sanitizeAndGateImages('<img src="/api/email/attachments/att-1/download">', false)
    expect(hasExternalImages).toBe(false)
    expect(html).toContain('src="/api/email/attachments/att-1/download"')
  })

  it('showExternalImages=true lasă src-ul original pe loc', () => {
    const { html, hasExternalImages } = sanitizeAndGateImages('<img src="https://evil.example/track.png">', true)
    expect(hasExternalImages).toBe(true)
    expect(html).toContain('src="https://evil.example/track.png"')
  })
})

describe('rewriteCidReferences', () => {
  it('rescrie cid: către endpoint-ul de download când există un atașament cu contentId potrivit (Content-ID cu < >, cid: din HTML fără)', () => {
    const html = rewriteCidReferences('<img src="cid:logo123@vanadium.systems">', [attachment()])
    expect(html).toBe('<img src="/api/email/attachments/att-1/download">')
  })

  it('strip < > din Content-ID header dacă sunt prezente și în cid: din HTML', () => {
    const html = rewriteCidReferences('<img src="cid:<logo123@vanadium.systems>">', [attachment()])
    expect(html).toBe('<img src="/api/email/attachments/att-1/download">')
  })

  it('se potrivește și când attachment.contentId nu are < > (formatul vechi, nerealist, dar tolerat)', () => {
    const html = rewriteCidReferences('<img src="cid:logo123">', [attachment({ contentId: 'logo123' })])
    expect(html).toBe('<img src="/api/email/attachments/att-1/download">')
  })

  it('lasă neschimbat cid: necunoscut (nu se potrivește cu niciun atașament al mesajului)', () => {
    const html = rewriteCidReferences('<img src="cid:necunoscut">', [attachment()])
    expect(html).toBe('<img src="cid:necunoscut">')
  })

  it('scop STRICT per mesaj: un contentId care există doar la alt mesaj nu se potrivește (array-ul primit e deja filtrat per messageId de backend)', () => {
    // Simulăm array-ul de atașamente al ALTUI mesaj — contentId identic, dar nu face parte
    // din lista pasată aici (echivalent cu "nu aparține acestui mesaj").
    const attachmentsOfDifferentMessage: EmailAttachmentMeta[] = []
    const html = rewriteCidReferences('<img src="cid:logo123@vanadium.systems">', attachmentsOfDifferentMessage)
    expect(html).toBe('<img src="cid:logo123@vanadium.systems">') // neschimbat — niciun match în lista scopată
  })

  it('nu atinge alte atribute src (doar cid: e rescris)', () => {
    const html = rewriteCidReferences('<img src="https://example.com/x.png">', [attachment()])
    expect(html).toBe('<img src="https://example.com/x.png">')
  })
})

describe('renderMessageHtml — plasă de siguranță pt. conținut de email neîncrezător', () => {
  it('randează normal conținut sub pragul de mărime', () => {
    const result = renderMessageHtml('<p>salut</p>', [], true)
    expect(result?.html).toContain('salut')
  })

  it('randează și conținut PESTE pragul de mărime când e chemat direct — gate-ul e o decizie a componentei, nu a funcției de randare', () => {
    const bigHtml = `<p>${'x'.repeat(MAX_INLINE_HTML_CHARS + 1000)}</p>`
    expect(bigHtml.length).toBeGreaterThan(MAX_INLINE_HTML_CHARS)
    const result = renderMessageHtml(bigHtml, [], true)
    expect(result?.html).toContain('x'.repeat(100))
  })

  it('cade pe null (fallback) în loc să arunce, când randarea eșuează neașteptat', () => {
    // Simulează un runtime error real (nu mockuit) — `attachments` malformat (nu array) face
    // ca `.find()` din rewriteCidReferences să arunce quando html conține un cid: de rezolvat.
    // Verifică exact plasa de siguranță descrisă în comentariul funcției: eșecul unui mesaj nu
    // trebuie să propage o excepție mai departe.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const malformedAttachments = undefined as unknown as EmailAttachmentMeta[]
    const result = renderMessageHtml('<img src="cid:x">', malformedAttachments, true)
    expect(result).toBeNull()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
