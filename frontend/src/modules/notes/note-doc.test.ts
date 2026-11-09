import { describe, expect, it } from 'vitest'
import { EMPTY_TASK_DOC, isEmptyNote, noteToDoc, plainToDoc } from './note-doc'

describe('plainToDoc', () => {
  it('turns each line of an old plain note into a paragraph, keeping blank lines', () => {
    expect(plainToDoc('one\n\ntwo')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    })
  })

  it('gives an empty body one empty paragraph', () => {
    expect(plainToDoc('').content).toEqual([{ type: 'paragraph' }])
  })

  it('keeps characters that look like markup as text', () => {
    expect(plainToDoc('# not a heading <b>').content?.[0]?.content?.[0]?.text).toBe('# not a heading <b>')
  })
})

describe('noteToDoc', () => {
  it('prefers the stored document', () => {
    const bodyJson = { type: 'doc' as const, content: [{ type: 'heading', attrs: { level: 1 } }] }
    expect(noteToDoc({ bodyJson, body: 'ignored' })).toBe(bodyJson)
  })

  it('falls back to the plain body of an old note', () => {
    expect(noteToDoc({ bodyJson: null, body: 'a\nb' }).content).toHaveLength(2)
  })
})

describe('isEmptyNote', () => {
  it('is empty with no title and only blank paragraphs', () => {
    expect(isEmptyNote('  ', plainToDoc('  \n'))).toBe(true)
    expect(isEmptyNote('', EMPTY_TASK_DOC)).toBe(true)
  })

  it('is not empty with a title or text in a nested item', () => {
    expect(isEmptyNote('Title', plainToDoc(''))).toBe(false)
    const task = { type: 'doc' as const, content: [{ type: 'taskList', content: [{ type: 'taskItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'buy' }] }] }] }] }
    expect(isEmptyNote('', task)).toBe(false)
  })
})
