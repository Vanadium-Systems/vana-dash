import { config } from '../../shared/config.js'
import type { AnafTokenResponse, AnafTokens } from './types.js'

// OAuth2 ANAF (logincert.anaf.ro). Consimțirea inițială NU poate fi automatizată:
// necesită certificatul digital al lui Stefan într-un flow de browser. Noi construim
// URL-ul, Stefan îl deschide, iar codul rezultat e schimbat aici pe token-uri.
// Refresh-ul ulterior e automat (jobs/refresh-anaf-token.ts) până expiră refresh token-ul.

const AUTHORIZE_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize'
const TOKEN_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/token'
const FETCH_TIMEOUT_MS = 30_000

export function isOauthConfigured(): boolean {
  return Boolean(config.anafClientId && config.anafClientSecret)
}

export function buildAuthorizeUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.anafClientId,
    redirect_uri: config.anafRedirectUri,
    token_content_type: 'jwt',
  })
  return `${AUTHORIZE_URL}?${params}`
}

export async function exchangeCode(code: string): Promise<AnafTokens> {
  return requestTokens({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.anafRedirectUri,
    token_content_type: 'jwt',
  })
}

export async function refreshTokens(refreshToken: string): Promise<AnafTokens> {
  return requestTokens({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    token_content_type: 'jwt',
  })
}

async function requestTokens(params: Record<string, string>): Promise<AnafTokens> {
  if (!isOauthConfigured()) {
    throw new Error('ANAF OAuth neconfigurat: setează ANAF_CLIENT_ID și ANAF_CLIENT_SECRET')
  }
  const basic = Buffer.from(`${config.anafClientId}:${config.anafClientSecret}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    // Corpul poate conține detalii utile, dar niciodată nu logăm token-uri.
    const detail = await res.text().catch(() => '')
    throw new Error(`ANAF token endpoint returned ${res.status}: ${detail.slice(0, 300)}`)
  }
  const payload = (await res.json()) as AnafTokenResponse
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error('ANAF token endpoint: răspuns fără access_token/refresh_token')
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 86_400) * 1000),
  }
}
