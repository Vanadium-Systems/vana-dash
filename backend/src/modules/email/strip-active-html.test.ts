import { describe, expect, it } from 'vitest'
import { stripActiveHtml } from './me-service.js'

describe('stripActiveHtml', () => {
  it('removes a script tag hidden inside another one', () => {
    expect(stripActiveHtml('<p>a</p><scr<script>x</script>ipt>alert(1)</script>')).not.toMatch(/<script/i)
  })

  it('removes an event handler that only appears once the first one is gone', () => {
    expect(stripActiveHtml('<img src="x" o onerror=1nerror="alert(1)">')).not.toMatch(/\son[a-z]+\s*=/i)
  })

  it('keeps ordinary signature markup', () => {
    expect(stripActiveHtml('<p><strong>Acme</strong> <a href="https://example.com">site</a></p>')).toBe(
      '<p><strong>Acme</strong> <a href="https://example.com">site</a></p>',
    )
  })
})
