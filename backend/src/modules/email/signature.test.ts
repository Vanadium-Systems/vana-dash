/**
 * buildSignature — semnătura devine HTML (2026-08-11, editor rich-text în SettingsTab.tsx),
 * la fel ca body-ul emailurilor; din 2026-09-30 e per identitate de trimitere, nu două câmpuri
 * fixe. Integration test, pg real (dashboard_config) — mai simplu decât mockuit
 * settings-service.js, și exercită drumul real prin getEmailSettings.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { updateEmailSettings } from './settings-service.js'
import { buildSignature } from './signature.js'

describe('buildSignature (2026-08-11 — semnătura e HTML, nu mai text simplu wrapped cu <br>)', () => {
  it('uses the stored signature HTML directly (unescaped) in the html output', async () => {
    await updateEmailSettings({ signatures: { stefan: '<p><strong>Stefan</strong> — <em>Vanadium Systems</em></p>' } })
    const sig = await buildSignature('stefan')
    expect(sig.html).toContain('<p><strong>Stefan</strong> — <em>Vanadium Systems</em></p>')
  })

  it('derives the plain-text version from the HTML, without leftover tags', async () => {
    await updateEmailSettings({ signatures: { contact: '<p><strong>Vanadium Systems</strong> SRL</p>' } })
    const sig = await buildSignature('contact')
    expect(sig.text).toContain('Vanadium Systems SRL')
    expect(sig.text).not.toContain('<strong>')
    expect(sig.text).not.toContain('<p>')
  })

  it('picks the signature of the sending identity, not a fixed pair', async () => {
    await updateEmailSettings({
      signatures: { stefan: '<p>QA Stefan Sig</p>', contact: '<p>QA Contact Sig</p>', sales: '<p>QA Sales Sig</p>' },
    })
    const stefanSig = await buildSignature('stefan')
    const contactSig = await buildSignature('contact')
    const salesSig = await buildSignature('sales')
    expect(stefanSig.html).toContain('QA Stefan Sig')
    expect(stefanSig.html).not.toContain('QA Contact Sig')
    expect(contactSig.html).toContain('QA Contact Sig')
    expect(contactSig.html).not.toContain('QA Stefan Sig')
    expect(salesSig.html).toContain('QA Sales Sig')
    expect(salesSig.html).not.toContain('QA Contact Sig')
  })
})

describe('buildSignature (2026-09-30 — per identitate, cu fallback pe semnătura de firmă)', () => {
  beforeEach(async () => {
    await updateEmailSettings({ signatures: { stefan: '', contact: '<p>QA Firmă</p>', sales: '', outreach: '' } })
  })

  it('falls back to the company signature while the identity has none of its own', async () => {
    // `noreply` nu are rând scris, deci primește semnătura de firmă — cum orice cutie nouă
    // adăugată din Setări.
    const sig = await buildSignature('noreply')
    expect(sig.html).toContain('QA Firmă')
  })

  it('an empty signature is no signature at all — not an empty block with a rule above it', async () => {
    const sig = await buildSignature('sales')
    expect(sig.html).toBe('')
    expect(sig.text).toBe('')
  })

  it('an identity that is no longer configured falls back to the company signature', async () => {
    const sig = await buildSignature('cutie-stersa')
    expect(sig.html).toContain('QA Firmă')
  })
})
