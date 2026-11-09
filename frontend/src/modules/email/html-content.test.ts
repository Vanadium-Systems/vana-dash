// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { htmlHasContent } from './html-content'

describe('htmlHasContent', () => {
  it('is false for empty editor markup and non-breaking spaces', () => {
    expect(htmlHasContent('<p></p>')).toBe(false)
    expect(htmlHasContent('<p>&nbsp;</p>')).toBe(false)
  })

  it('is true for text or a lone image', () => {
    expect(htmlHasContent('<p>Salut</p>')).toBe(true)
    expect(htmlHasContent('<p><img src="cid:logo"></p>')).toBe(true)
  })
})
