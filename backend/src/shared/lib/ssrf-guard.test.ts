import { lookup } from 'node:dns/promises'
import { describe, expect, it, vi } from 'vitest'
import { assertResolvesToPublicAddress, SsrfBlockedError, validatePlatformUrl } from './ssrf-guard.js'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))

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

describe('assertResolvesToPublicAddress', () => {
  const resolvesTo = (...addresses: { address: string; family: number }[]) =>
    vi.mocked(lookup).mockResolvedValueOnce(addresses as never)

  it('allows a name that resolves only to public addresses', async () => {
    resolvesTo({ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 })
    await expect(assertResolvesToPublicAddress('https://example.com')).resolves.toBeUndefined()
  })

  it.each([
    ['127.0.0.1', 4],
    ['10.1.2.3', 4],
    ['169.254.169.254', 4],
    ['::1', 6],
    ['fd00::5', 6],
  ])('refuses a public name that resolves to %s', async (address, family) => {
    resolvesTo({ address: '93.184.216.34', family: 4 }, { address, family })
    await expect(assertResolvesToPublicAddress('https://rebind.example.com')).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('lets a name that does not resolve through', async () => {
    vi.mocked(lookup).mockRejectedValueOnce(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
    await expect(assertResolvesToPublicAddress('https://nope.example.com')).resolves.toBeUndefined()
  })
})
