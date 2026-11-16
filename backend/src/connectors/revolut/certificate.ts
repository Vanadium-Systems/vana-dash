import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Certificate used by the Revolut Business API to verify client-assertion JWTs.
// Generated locally (RSA, self-signed) — the user uploads ONLY the public part
// (certificatePem) in Revolut Business Settings -> API. The private key never
// leaves this server: it is encrypted with AES-256-GCM in bank_accounts.private_key_enc.

const COMMON_NAME = 'vana-dash.vanadium.systems'
const KEY_SIZE_BITS = 2048
const VALIDITY_DAYS = 3650

export interface SelfSignedCertificate {
  certificatePem: string
  privateKeyPem: string
}

export async function generateSelfSignedCertificate(): Promise<SelfSignedCertificate> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vana-revolut-cert-'))
  const keyPath = path.join(tmpDir, 'key.pem')
  const certPath = path.join(tmpDir, 'cert.pem')

  try {
    await execFileAsync('openssl', [
      'req',
      '-x509',
      '-newkey',
      `rsa:${KEY_SIZE_BITS}`,
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      String(VALIDITY_DAYS),
      '-nodes',
      '-sha256',
      '-subj',
      `/CN=${COMMON_NAME}`,
    ])

    const [certificatePem, privateKeyPem] = await Promise.all([
      fs.readFile(certPath, 'utf8'),
      fs.readFile(keyPath, 'utf8'),
    ])

    return { certificatePem, privateKeyPem }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}
