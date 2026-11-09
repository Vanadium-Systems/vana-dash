import { describe, expect, it } from 'vitest'
import { stripActiveHtml } from './me-service.js'

describe('stripActiveHtml', () => {
  it('leaves no script tag, not even one hidden inside another', () => {
    expect(stripActiveHtml('<p>a</p><scr<script>x</script>ipt>alert(1)</script>')).not.toMatch(/<script/i)
  })

  it('leaves no event handler, not even one hidden inside another', () => {
    expect(stripActiveHtml('<img src="x" o onerror=1nerror="alert(1)">')).not.toMatch(/\son[a-z]+\s*=/i)
    expect(stripActiveHtml('<img/onerror="alert(1)" src=x>')).not.toMatch(/[\s/]on[a-z]+\s*=/i)
  })

  it('blocks javascript: links', () => {
    expect(stripActiveHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i)
    expect(stripActiveHtml('<a href=javascript:alert(1)>x</a>')).not.toMatch(/javascript:/i)
  })

  it('keeps ordinary signature markup', () => {
    expect(stripActiveHtml('<p><strong>Acme</strong> <a href="https://example.com">site</a></p>')).toBe(
      '<p><strong>Acme</strong> <a href="https://example.com">site</a></p>',
    )
  })
})
