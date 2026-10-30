import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString } from 'pdf-lib'

// Empty digital signature fields over every "Semnătură…" line of a generated document, so it
// can be signed straight from Adobe Reader with a qualified certificate (click the field, pick
// the token). Works with any template, including ones edited from the UI: the lines are found
// in the rendered page, not in the template source.
//
// Chromium has no way to emit form fields, but it does emit a link annotation, at the exact
// page and position, for every <a href>. So each signature area gets a placeholder link with
// a marker URL, and the links are swapped for signature fields after printing.

const MARKER = 'https://signature-field.invalid/'

// 190 pt wide like contracte/pdf-semnatura.py, but only 30 pt tall: the templates leave about
// 34 pt between the representative's name and the signature line, and the field must not cover
// the name once Adobe draws the signature in it.
const FIELD_WIDTH_PT = 190
const FIELD_HEIGHT_PT = 30

/**
 * Script run in the page before printing: puts a marker link above every short element that
 * starts with "Semnătură" (the innermost one). Plain JS in a string because the backend has no
 * DOM types. Returns how many areas it marked.
 */
export const MARK_SIGNATURE_AREAS = `(() => {
  const starts = (el) => (el.textContent || '').trim().startsWith('Semnătură')
  const lines = Array.from(document.body.querySelectorAll('*')).filter(
    (el) => starts(el) && (el.textContent || '').trim().length < 120 && !Array.from(el.children).some(starts),
  )
  lines.forEach((line, i) => {
    if (getComputedStyle(line).position === 'static') line.style.position = 'relative'
    const anchor = document.createElement('a')
    anchor.href = '${MARKER}' + (i + 1)
    anchor.setAttribute('aria-hidden', 'true')
    anchor.style.cssText = 'position:absolute;display:block;left:50%;bottom:calc(100% + 2pt);' +
      'width:${FIELD_WIDTH_PT}pt;height:${FIELD_HEIGHT_PT}pt;margin-left:-${FIELD_WIDTH_PT / 2}pt'
    line.appendChild(anchor)
  })
  return lines.length
})()`

/** Replaces the marker links Chromium printed with empty signature fields named Semnatura_N. */
export async function addSignatureFields(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf)
  const context = doc.context
  const fieldRefs: PDFRef[] = []

  doc.getPages().forEach((page) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookupMaybe(i, PDFDict)
      const action = annot?.lookupMaybe(PDFName.of('A'), PDFDict)
      const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString)?.decodeText()
      if (!annot || !uri?.startsWith(MARKER)) continue
      annots.remove(i)
      const field = context.obj({
        FT: 'Sig',
        Type: 'Annot',
        Subtype: 'Widget',
        T: PDFString.of(`Semnatura_${uri.slice(MARKER.length)}`),
        Rect: annot.lookup(PDFName.of('Rect')),
        F: PDFNumber.of(4),
        P: page.ref,
      })
      const ref = context.register(field)
      annots.push(ref)
      fieldRefs.push(ref)
    }
  })

  if (fieldRefs.length === 0) return pdf
  const acroForm = context.obj({ Fields: fieldRefs })
  doc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm))
  return doc.save()
}
