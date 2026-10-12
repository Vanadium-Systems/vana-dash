import { describe, expect, it } from 'vitest'
import { SsrfBlockedError, validatePlatformUrl } from './ssrf-guard.js'

describe('validatePlatformUrl', () => {
  it('permite un URL public HTTPS', () => {
    expect(() => validatePlatformUrl('https://api.vanagreen.ro/v1')).not.toThrow()
  })

  it('permite un URL public HTTP', () => {
    expect(() => validatePlatformUrl('http://example.com')).not.toThrow()
  })

  it.each([
    'http://localhost:3000',
    'http://sub.localhost',
    'http://127.0.0.1',
    'http://127.5.5.5',
    'http://10.0.0.1',
    'http://10.255.255.255',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://[::1]',
    'http://[fc00::1]',
    'http://[fd12::1]',
    'http://[fe80::1]',
    'http://[::ffff:127.0.0.1]',
    'http://0.0.0.0:3001',
    'http://100.64.0.1',
    'http://2130706433',
    'http://postgres:5432',
    'http://backend:3001/health',
  ])('respinge %s (rețea privată/loopback)', (url) => {
    expect(() => validatePlatformUrl(url)).toThrow(SsrfBlockedError)
  })

  it('respinge protocoale nepermise (ex. file:)', () => {
    expect(() => validatePlatformUrl('file:///etc/passwd')).toThrow(SsrfBlockedError)
  })

  it('nu blochează un IP public care doar seamănă cu un prefix privat', () => {
    expect(() => validatePlatformUrl('http://172.15.0.1')).not.toThrow()
    expect(() => validatePlatformUrl('http://172.32.0.1')).not.toThrow()
    expect(() => validatePlatformUrl('http://100.63.0.1')).not.toThrow()
    expect(() => validatePlatformUrl('http://100.128.0.1')).not.toThrow()
  })
})
