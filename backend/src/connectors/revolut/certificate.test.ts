import { createSign, createVerify, X509Certificate } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateSelfSignedCertificate } from './certificate.js'

describe('generateSelfSignedCertificate', () => {
  it('returns a parsable X509 certificate and a matching private key', async () => {
    const { certificatePem, privateKeyPem } = await generateSelfSignedCertificate()

    expect(certificatePem).toContain('BEGIN CERTIFICATE')
    expect(privateKeyPem).toMatch(/BEGIN (RSA )?PRIVATE KEY/)

    const cert = new X509Certificate(certificatePem)
    expect(cert.subject).toContain('vana-dash.vanadium.systems')

    // Cheia privată se potrivește cu cheia publică din cert: semnăm cu privata,
    // verificăm cu publica extrasă din certificat.
    const data = Buffer.from('vana-dash certificate roundtrip check')
    const signature = createSign('RSA-SHA256').update(data).sign(privateKeyPem)
    const verified = createVerify('RSA-SHA256').update(data).verify(cert.publicKey, signature)
    expect(verified).toBe(true)
  })

  it('sets a ~10 year validity window', async () => {
    const { certificatePem } = await generateSelfSignedCertificate()
    const cert = new X509Certificate(certificatePem)
    const validFrom = new Date(cert.validFrom).getTime()
    const validTo = new Date(cert.validTo).getTime()
    const years = (validTo - validFrom) / (365.25 * 24 * 60 * 60 * 1000)
    expect(years).toBeGreaterThan(9)
    expect(years).toBeLessThan(11)
  })

  it('does not reuse keys across calls', async () => {
    const a = await generateSelfSignedCertificate()
    const b = await generateSelfSignedCertificate()
    expect(a.privateKeyPem).not.toBe(b.privateKeyPem)
    expect(a.certificatePem).not.toBe(b.certificatePem)
  })
})
