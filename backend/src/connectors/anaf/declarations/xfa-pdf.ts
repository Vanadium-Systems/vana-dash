import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

// ANAF's "soft A" declarations are XFA forms reader-extended with a UR3 signature. Rewriting the
// file would void that signature and Adobe Reader would refuse to save or sign the form, so the
// data goes in as an incremental update: a new revision of the `datasets` stream appended after
// the original bytes, which is what Reader itself writes when the form is saved.
// The user then opens the PDF in Adobe Reader, presses "Validare" (the form builds and attaches
// D301.xml / D390.xml itself), signs and uploads it to SPV.

export interface XfaTemplate {
  file: string
  /** Object number of the `datasets` packet in /AcroForm /XFA. */
  datasetsObject: number
}

export const D301_TEMPLATE: XfaTemplate = { file: 'D301_XML_2017_260320.pdf', datasetsObject: 5 }
export const D390_TEMPLATE: XfaTemplate = { file: 'D390_XML_2020_300424.pdf', datasetsObject: 5 }

export function loadTemplate(template: XfaTemplate): Buffer {
  return readFileSync(new URL(`./templates/${template.file}`, import.meta.url))
}

function lastTrailer(pdf: string): { startxref: number; size: number; root: string; info: string | null; id0: string } {
  const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(pdf)?.[1])
  if (!Number.isFinite(startxref)) throw new Error('XFA template: startxref not found')
  const dict = pdf.slice(startxref, pdf.indexOf('stream', startxref))
  const size = Number(/\/Size\s+(\d+)/.exec(dict)?.[1])
  const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(dict)?.[1]
  const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(dict)?.[1] ?? null
  const id0 = /\/ID\s*\[\s*<([0-9A-Fa-f]+)>/.exec(dict)?.[1]
  if (!size || !root || !id0) throw new Error('XFA template: unexpected trailer')
  return { startxref, size, root, info, id0 }
}

/** `datasets` is the full `<xfa:datasets>` packet. */
export function fillXfaDatasets(template: XfaTemplate, datasets: string, original = loadTemplate(template)): Buffer {
  const trailer = lastTrailer(original.toString('latin1'))
  const body = deflateSync(Buffer.from(datasets, 'utf8'))
  const xrefObject = trailer.size

  const head = original[original.length - 1] === 0x0a ? '' : '\n'
  const datasetsOffset = original.length + head.length
  const datasetsObj = Buffer.concat([
    Buffer.from(`${head}${template.datasetsObject} 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    body,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ])
  const xrefOffset = datasetsOffset + datasetsObj.length - head.length

  // Type 1 entries, W [1 4 1]: one for the new datasets revision, one for this xref stream.
  const entry = (offset: number) => {
    const row = Buffer.alloc(6)
    row.writeUInt8(1, 0)
    row.writeUInt32BE(offset, 1)
    return row
  }
  const xrefData = Buffer.concat([entry(datasetsOffset), entry(xrefOffset)])
  // The second /ID only has to change with the content; 16 bytes, the length Reader writes itself.
  const newId = createHash('sha256').update(datasets).digest('hex').slice(0, 32).toUpperCase()
  const xrefDict =
    `<< /Type /XRef /Size ${xrefObject + 1} /Index [${template.datasetsObject} 1 ${xrefObject} 1] /W [1 4 1]` +
    ` /Root ${trailer.root}${trailer.info ? ` /Info ${trailer.info}` : ''} /ID [<${trailer.id0}> <${newId}>]` +
    ` /Prev ${trailer.startxref} /Length ${xrefData.length} >>`
  const xrefObj = Buffer.concat([
    Buffer.from(`${xrefObject} 0 obj\n${xrefDict}\nstream\n`, 'latin1'),
    xrefData,
    Buffer.from(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`, 'latin1'),
  ])

  return Buffer.concat([original, datasetsObj, xrefObj])
}

export function xmlText(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Wraps the form's own data tree (`<form1>…`) in the XFA datasets packet. */
export function datasetsPacket(form1: string): string {
  return `<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data>${form1}</xfa:data></xfa:datasets>`
}
