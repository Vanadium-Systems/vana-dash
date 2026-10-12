import { config } from '../../shared/config.js'
import { signClientAssertion } from './jwt.js'
import type { RevolutTokenResponse, RevolutTokens } from './types.js'

// OAuth2 + JWT client assertion Revolut Business API (RFC 7523). Simetric cu
// connectors/anaf/oauth.ts, dar Basic auth (client_id:client_secret) e
// înlocuit cu un client_assertion semnat RSA — Revolut nu emite client secret,
// verifică semnătura JWT cu certificatul urcat manual de Stefan.
//
// Consimțirea inițială (authorize URL → cod) rămâne un pas manual de browser,
// simetric cu ANAF: Stefan deschide URL-ul, aprobă accesul din Revolut
// Business app, iar codul rezultat (valabil doar 2 minute) e schimbat aici
// pe token-uri. Refresh-ul ulterior e automat (jobs/refresh-revolut-token.ts)
// până expiră refresh token-ul (90 zile).
//
// Research (verificat, iulie 2026): https://developer.revolut.com/docs/business/business-api
// — access token 40 min, refresh token 90 zile, endpoint token unic pentru
// exchange și refresh. Detalii exacte de payload JWT nu au putut fi confirmate
// din pagina oficială (fetch blocat, 403) — corroborate din implementări terțe
// (oauth2-revolut, revolut-connect) care confirmă structura generală (iss =
// domeniul aplicației, sub = client_id, JWT semnat RS256). Vezi Known Issues
// în raportul de sprint pentru ce rămâne neverificat empiric.

const FETCH_TIMEOUT_MS = 30_000

// Host-ul de consimțire trebuie să corespundă mediului API (REVOLUT_API_URL) —
// business.revolut.com pt. producție, sandbox-business.revolut.com pt. sandbox.
// Nu există o variabilă separată de env pt. Revolut (spre deosebire de ANAF_ENV) —
// derivăm din URL-ul API deja configurat, ca să nu poată drifta separat.
function authorizeBaseUrl(): string {
  const isSandbox = config.revolutApiUrl.includes('sandbox')
  const host = isSandbox ? 'sandbox-business.revolut.com' : 'business.revolut.com'
  return `https://${host}/app-confirm`
}

export function buildAuthorizeUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: config.revolutRedirectUri,
    response_type: 'code',
    scope: 'READ',
    state,
  })
  return `${authorizeBaseUrl()}?${params}`
}

export async function exchangeCode(code: string, clientId: string, privateKeyPem: string): Promise<RevolutTokens> {
  return requestTokens(clientId, privateKeyPem, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
  })
}

export async function refreshTokens(
  refreshToken: string,
  clientId: string,
  privateKeyPem: string,
): Promise<RevolutTokens> {
  return requestTokens(clientId, privateKeyPem, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
}

async function requestTokens(
  clientId: string,
  privateKeyPem: string,
  params: Record<string, string>,
): Promise<RevolutTokens> {
  // JWT nou la fiecare cerere — nu se refolosește între exchange și refresh.
  const clientAssertion = signClientAssertion(clientId, privateKeyPem)

  const body = new URLSearchParams({
    ...params,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  })

  const res = await fetch(`${config.revolutApiUrl}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    // Corpul poate conține detalii utile, dar niciodată nu logăm tokenul/JWT-ul.
    const detail = await res.text().catch(() => '')
    throw new Error(`Revolut /auth/token returned ${res.status}: ${detail.slice(0, 300)}`)
  }
  const payload = (await res.json()) as RevolutTokenResponse
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error('Revolut /auth/token: răspuns fără access_token/refresh_token')
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 40 * 60) * 1000),
  }
}
