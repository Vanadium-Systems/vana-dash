import { X509Certificate, createPrivateKey } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateSelfSignedCertificate } from './certificate.js'

describe('generateSelfSignedCertificate', () => {
  it('generates a valid 2048-bit RSA self-signed certificate and matching private key', async () => {
    const { certificatePem, privateKeyPem } = await generateSelfSignedCertificate()

    expect(certificatePem).toContain('-----BEGIN CERTIFICATE-----')
    expect(privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----')

    const x509 = new X509Certificate(certificatePem)
    expect(x509.subject).toContain('CN=vana-dash.vanadium.systems')
    expect(x509.issuer).toBe(x509.subject)

    const privKey = createPrivateKey(privateKeyPem)
    expect(x509.checkPrivateKey(privKey)).toBe(true)
  })
})
