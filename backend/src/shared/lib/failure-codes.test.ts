import { describe, expect, it } from 'vitest'
import en from '../../locales/en/errors.json' with { type: 'json' }
import ro from '../../locales/ro/errors.json' with { type: 'json' }
import { classifySendFailure, classifySyncFailure } from './failure-codes.js'

describe('failure codes', () => {
  it.each([
    'EMAIL_SEND_RATE_LIMITED',
    'EMAIL_SEND_AUTH_FAILED',
    'EMAIL_RECIPIENT_REJECTED',
    'EMAIL_SEND_TIMEOUT',
    'EMAIL_SEND_FAILED',
    'SYNC_TIMEOUT',
    'SYNC_AUTH_FAILED',
    'SYNC_UNREACHABLE',
    'SYNC_FAILED',
  ])('%s has a text in ro and en', (code) => {
    expect(ro.codes).toHaveProperty(code)
    expect(en.codes).toHaveProperty(code)
  })
})

describe('classifySendFailure', () => {
  it.each([
    [null, null],
    ['Error: Resend answered with HTTP 429: {"name":"rate_limit_exceeded"}', 'EMAIL_SEND_RATE_LIMITED'],
    ['Error: Resend a răspuns cu HTTP 429: Too many requests', 'EMAIL_SEND_RATE_LIMITED'],
    ['outreach_cap_reached: 20', 'EMAIL_SEND_RATE_LIMITED'],
    ['Error: Resend answered with HTTP 401: API key is invalid', 'EMAIL_SEND_AUTH_FAILED'],
    ['Error: Resend a răspuns cu HTTP 403: domain not verified', 'EMAIL_SEND_AUTH_FAILED'],
    ['SMTP_AUTH_FAILED', 'EMAIL_SEND_AUTH_FAILED'],
    ['RESEND_API_KEY neconfigurat', 'EMAIL_SEND_AUTH_FAILED'],
    ['RESEND_API_KEY is not configured', 'EMAIL_SEND_AUTH_FAILED'],
    ['SMTP_REJECTED', 'EMAIL_RECIPIENT_REJECTED'],
    ['IMAP_DSN_5.1.1', 'EMAIL_RECIPIENT_REJECTED'],
    ['IMAP_DSN_BOUNCE', 'EMAIL_RECIPIENT_REJECTED'],
    ['recipient_unsubscribed: someone@example.com', 'EMAIL_RECIPIENT_REJECTED'],
    ['Error: Resend answered with HTTP 422: Invalid `to` field', 'EMAIL_RECIPIENT_REJECTED'],
    ['TimeoutError: The operation was aborted due to timeout', 'EMAIL_SEND_TIMEOUT'],
    ['Error: connect ETIMEDOUT 203.0.113.5:443', 'EMAIL_SEND_TIMEOUT'],
    ['SMTP_UNREACHABLE', 'EMAIL_SEND_FAILED'],
    ['Error: Resend answered with HTTP 500: internal', 'EMAIL_SEND_FAILED'],
    ['something nobody has seen before', 'EMAIL_SEND_FAILED'],
    ['', 'EMAIL_SEND_FAILED'],
  ])('%j -> %s', (raw, code) => {
    expect(classifySendFailure(raw)).toBe(code)
  })
})

describe('classifySyncFailure', () => {
  it.each([
    [null, null],
    ['TimeoutError: The operation was aborted due to timeout', 'SYNC_TIMEOUT'],
    ['Error: connect ETIMEDOUT 203.0.113.5:443', 'SYNC_TIMEOUT'],
    ['Error: ANAF: invalid/expired token (HTTP 401); a refresh or re-authorization is needed', 'SYNC_AUTH_FAILED'],
    ['Error: ANAF: token invalid/expirat (HTTP 401) — necesită refresh sau re-auth', 'SYNC_AUTH_FAILED'], // slop-ok: verbatim text of errors.anaf.tokenInvalid
    ['Error: Revolut: invalid/expired token (HTTP 403)', 'SYNC_AUTH_FAILED'],
    ['Error: vanagreen metrics endpoint returned 401', 'SYNC_AUTH_FAILED'],
    ['Error: ANAF OAuth is not configured: set ANAF_CLIENT_ID and ANAF_CLIENT_SECRET', 'SYNC_AUTH_FAILED'],
    ['Error: ANAF OAuth neconfigurat: setează ANAF_CLIENT_ID și ANAF_CLIENT_SECRET', 'SYNC_AUTH_FAILED'],
    ['TypeError: fetch failed', 'SYNC_UNREACHABLE'],
    ['Error: getaddrinfo ENOTFOUND api.example.com', 'SYNC_UNREACHABLE'],
    ['Error: connect ECONNREFUSED 127.0.0.1:3000', 'SYNC_UNREACHABLE'],
    ['Error: vanagreen metrics endpoint returned 503', 'SYNC_UNREACHABLE'],
    ['Error: ANAF: https://example.com/x returned HTTP 502', 'SYNC_UNREACHABLE'],
    ['Error: generic /data returned 404', 'SYNC_FAILED'],
    ['Error: Unknown platform type: nope', 'SYNC_FAILED'],
    ['', 'SYNC_FAILED'],
  ])('%j -> %s', (raw, code) => {
    expect(classifySyncFailure(raw)).toBe(code)
  })
})
