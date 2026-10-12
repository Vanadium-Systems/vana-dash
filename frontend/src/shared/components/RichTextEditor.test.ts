import { describe, expect, it } from 'vitest'
import { legacyBodyToHtml } from './RichTextEditor'

describe('legacyBodyToHtml (2026-08-11 — migrare draft-uri/template-uri de dinainte de editor)', () => {
  it('returns real HTML untouched (already produced by the editor)', () => {
    const html = '<p>Salut <b>Andrei</b></p>'
    expect(legacyBodyToHtml(html)).toBe(html)
  })

  it('wraps a legacy plain-text body in paragraphs, escaping HTML-special characters', () => {
    expect(legacyBodyToHtml('Salut & bine ai venit <aici>')).toBe('<p>Salut &amp; bine ai venit &lt;aici&gt;</p>')
  })

  it('preserves multiple lines as separate paragraphs', () => {
    expect(legacyBodyToHtml('Linia 1\nLinia 2')).toBe('<p>Linia 1</p><p>Linia 2</p>')
  })

  it('returns an empty string for empty input', () => {
    expect(legacyBodyToHtml('')).toBe('')
  })

  it('does not mistake a plain-text placeholder like "<nume aici>" for real HTML', () => {
    // Regresie — un regex generic "conține un tag" ar fi prins <nume aici> ca HTML și ar fi
    // lăsat body-ul nemodificat (nu l-ar fi escapat/împachetat în <p>).
    expect(legacyBodyToHtml('Salut <nume aici>,')).toBe('<p>Salut &lt;nume aici&gt;,</p>')
  })
})
