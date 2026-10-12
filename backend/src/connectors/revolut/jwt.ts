import { createSign } from 'node:crypto'
import { config } from '../../shared/config.js'

// JWT de client assertion pentru Revolut Business API OAuth2 (RFC 7523 —
// urn:ietf:params:oauth:client-assertion-type:jwt-bearer). Hand-rolled cu
// node:crypto: payload-ul e minimal (3 claims + exp), nu justifică o
// dependență (jsonwebtoken/jose) pentru ~20 linii.
//
// Se generează un JWT NOU la fiecare cerere de token (exchange SAU refresh) —
// nu se refolosește. `iss` = originea redirect_uri-ului configurat (cerință
// Revolut: "JWT issuer domain, typically your app domain"), `sub` = client_id
// alocat de Revolut per cont bancar, `aud` = 'https://revolut.com' fix.

const EXPIRY_SECONDS = 60 * 60 // 1h — doar timpul necesar pentru un exchange/refresh, nu reutilizat

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function signClientAssertion(clientId: string, privateKeyPem: string): string {
  // Revolut cere domeniul FĂRĂ schemă ("Client assertion invalid. The 'iss'
  // claim must be your domain (without 'https://')" — confirmat empiric,
  // 2026-07-10, eroarea 401/9001 de la /auth/token). `.origin` includea
  // 'https://' — bug real, prins la primul test live.
  const issuer = new URL(config.revolutRedirectUri).hostname

  const header = { alg: 'RS256', typ: 'JWT' }
  const nowSeconds = Math.floor(Date.now() / 1000)
  const payload = {
    iss: issuer,
    sub: clientId,
    aud: 'https://revolut.com',
    iat: nowSeconds,
    exp: nowSeconds + EXPIRY_SECONDS,
  }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKeyPem)

  return `${signingInput}.${base64url(signature)}`
}
