import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from './html-to-text.js'

describe('htmlToPlainText', () => {
  it('convertește un email ANAF SPV real (doar HTML, fără alternativă text/plain)', () => {
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
    expect(text).not.toContain('----') // <hr> — linia decorativă nu ajută într-o bulă de chat
  })

  it('păstrează link-urile ca text simplu, inline', () => {
    const text = htmlToPlainText('<p>Vezi <a href="https://exemplu.ro/factura">factura aici</a>.</p>')
    expect(text).toContain('factura aici')
  })
})
