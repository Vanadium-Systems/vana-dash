import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from './html-to-text.js'

describe('htmlToPlainText', () => {
  it('converts an ANAF SPV HTML-only email to plain text', () => {
    const html =
      '<html><body><p>Ați primit următoarele documente în Spațiul Privat Virtual (SPV) ANAF:<br><br>' +
      '- CIF 12345674: Document Fisa Rol pentru CIF=12345674 (cod arondare 000001) in format PDF simplificat</p>' +
      '<hr><small>Mesaj automat.</small></body></html>'
    const text = htmlToPlainText(html)
    expect(text).not.toContain('<')
    expect(text).not.toContain('>')
    expect(text).toContain('Ați primit următoarele documente în Spațiul Privat Virtual (SPV) ANAF:')
    expect(text).toContain('CIF 12345674: Document Fisa Rol')
    expect(text).toContain('Mesaj automat.')
    expect(text).not.toContain('----')
  })

  it('formats links inline as text (url)', () => {
    const text = htmlToPlainText('<p>Vezi <a href="https://example.com/invoice">factura aici</a>.</p>')
    expect(text).toBe('Vezi factura aici (https://example.com/invoice).')
  })

  it('strips script/style/img, converts lists, and decodes HTML entities', () => {
    const html = `
      <html>
        <head><style>body { color: red; }</style></head>
        <body>
          <script>alert("xss")</script>
          <h1>Raport &amp; Sumar &euro;</h1>
          <img src="https://example.com/logo.png" alt="Acme" />
          <ul>
            <li>Factura #101 &ndash; achitat&#259;</li>
            <li>Factura #102 &mdash; &#x20AC;250&nbsp;net</li>
          </ul>
          <p>Contact: <a href="mailto:billing@example.com">billing@example.com</a></p>
        </body>
      </html>
    `
    const text = htmlToPlainText(html)
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color: red')
    expect(text).not.toContain('logo.png')
    expect(text).toContain('Raport & Sumar €')
    expect(text).toContain('- Factura #101 – achitată')
    expect(text).toContain('- Factura #102 — €250 net')
    expect(text).toContain('Contact: billing@example.com (mailto:billing@example.com)')
  })

  it('handles table-based transactional emails cleanly', () => {
    const html = `
      <table>
        <tr><th>Produs</th><th>Suma</th></tr>
        <tr><td>Abonament Acme</td><td>100 RON</td></tr>
      </table>
    `
    const text = htmlToPlainText(html)
    expect(text).toContain('Produs Suma')
    expect(text).toContain('Abonament Acme 100 RON')
  })
})
