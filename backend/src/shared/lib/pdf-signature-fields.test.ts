import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { addSignatureFields, markSignatureRoles } from './pdf-signature-fields.js'
import { htmlToPdf, isPdfAvailable } from './pdf.js'

// Chromium is not available in tests, so the PDF is built by hand with the same link
// annotations Chromium prints for the marker anchors.
async function pdfWithLinks(uris: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const annots = uris.map((uri, i) =>
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [60 + i * 270, 500, 250 + i * 270, 530],
        A: { S: 'URI', URI: PDFString.of(uri) },
      }),
    ),
  )
  page.node.set(PDFName.of('Annots'), doc.context.obj(annots))
  return doc.save()
}

describe('addSignatureFields', () => {
  it('turns every marker link into an empty signature field at the same place', async () => {
    const out = await addSignatureFields(
      await pdfWithLinks(['https://signature-field.invalid/1', 'https://signature-field.invalid/2']),
    )
    const doc = await PDFDocument.load(out)
    expect(doc.getForm().getFields().map((f) => f.getName()).sort()).toEqual(['Semnatura_1', 'Semnatura_2'])
    const widgets = doc.getForm().getFields().map((f) => f.acroField.getWidgets()[0]!.getRectangle())
    expect(widgets).toContainEqual({ x: 60, y: 500, width: 190, height: 30 })
  })

  it('keeps other links and adds no form when there is nothing to sign', async () => {
    const input = await pdfWithLinks(['https://example.com'])
    const out = await addSignatureFields(input)
    expect(out).toBe(input)
  })
})

const SAAS_SIGNATURES = `<div class="signatures">
  <div class="signature-block"><strong>PRESTATOR</strong><br>Acme Software SRL<div class="signature-line">Semnătură și ștampilă</div></div>
  <div class="signature-block"><strong>CLIENT</strong><br>Example Client SRL<div class="signature-line">Semnătură și ștampilă</div></div>
</div>`

describe.skipIf(!isPdfAvailable())('signature fields in a printed document', () => {
  it('leaves our own line without a field, since we sign on webSIGN', async () => {
    const pdf = await htmlToPdf(SAAS_SIGNATURES, { signatureFields: { skipPartyName: 'Acme Software SRL' }, offline: true })
    expect((await PDFDocument.load(pdf)).getForm().getFields().map((f) => f.getName())).toEqual(['Semnatura_1'])
  })

  it('names a role that signs twice apart, so each place is its own field', async () => {
    const line = '<div class="signature-line" data-sign-role="Colaborator">Semnătură</div>'
    const html = markSignatureRoles(`${line}<div style="page-break-before:always"></div>${line}`, ['Beneficiar'])
    const pdf = await htmlToPdf(html, { signatureFields: true, isolated: true })
    expect((await PDFDocument.load(pdf)).getForm().getFields().map((f) => f.getName()).sort()).toEqual(['Semnatura_Colaborator', 'Semnatura_Colaborator_2'])
  })
})
