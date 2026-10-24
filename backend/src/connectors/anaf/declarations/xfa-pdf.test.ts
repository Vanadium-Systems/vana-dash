import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { D301_TEMPLATE, D390_TEMPLATE, datasetsPacket, fillXfaDatasets, loadTemplate } from './xfa-pdf.js'

function lastXref(pdf: Buffer): { offset: number; dict: string } {
  const text = pdf.toString('latin1')
  const offset = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1])
  return { offset, dict: text.slice(offset, text.indexOf('stream', offset)) }
}

describe.each([D301_TEMPLATE, D390_TEMPLATE])('fillXfaDatasets($file)', (template) => {
  const original = loadTemplate(template)
  const datasets = datasetsPacket('<form1><cif>12345674</cif></form1>')
  const pdf = fillXfaDatasets(template, datasets, original)

  it('keeps the original bytes untouched, so the Reader usage rights stay valid', () => {
    expect(pdf.subarray(0, original.length).equals(original)).toBe(true)
  })

  it('chains the new xref stream to the template one', () => {
    const before = lastXref(original)
    const { dict } = lastXref(pdf)
    expect(dict).toContain(`/Prev ${before.offset}`)
    expect(dict).toContain(`/Index [${template.datasetsObject} 1`)
  })

  it('points the xref entry at the new datasets object, whose stream inflates to the packet', () => {
    const { offset, dict } = lastXref(pdf)
    const data = pdf.subarray(pdf.indexOf('stream\n', offset) + 7)
    const datasetsOffset = data.readUInt32BE(1)
    const xrefOffset = data.readUInt32BE(7)
    expect(xrefOffset).toBe(offset)
    expect(dict).toContain('/W [1 4 1]')

    const objText = pdf.subarray(datasetsOffset).toString('latin1')
    expect(objText.startsWith(`${template.datasetsObject} 0 obj`)).toBe(true)
    const length = Number(/\/Length (\d+)/.exec(objText)![1])
    const start = datasetsOffset + objText.indexOf('stream\n') + 7
    expect(inflateSync(pdf.subarray(start, start + length)).toString('utf8')).toBe(datasets)
  })
})
