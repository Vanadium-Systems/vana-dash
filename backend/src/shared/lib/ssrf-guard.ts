import { tr } from './i18n.js'
// SSRF guard for the URL of a connected platform. It runs when the platform is created or
// edited, so the sync jobs never get to request an internal address. It matches the hostname
// as written, not what DNS resolves it to, and it does not follow what a redirect answers:
// both would need a session that may edit platforms, which is an admin's.
const IPV4_PRIVATE_OR_LOOPBACK =
  /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0\.\d{1,3}\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})$/

export class SsrfBlockedError extends Error {}

export function validatePlatformUrl(url: string): void {
  const parsed = new URL(url)
  const hostname = parsed.hostname.toLowerCase()

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SsrfBlockedError(tr('errors.platforms.protocolNotAllowed', { protocol: parsed.protocol }))
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SsrfBlockedError(tr('errors.platforms.blockedLocalhost', { url }))
  }
  if (IPV4_PRIVATE_OR_LOOPBACK.test(hostname)) {
    throw new SsrfBlockedError(tr('errors.platforms.blockedPrivate', { url }))
  }
  // A name without a dot is not on the public internet: on the server it is another container
  // on the Docker network (`postgres`, `backend`).
  if (!hostname.includes('.') && !hostname.includes(':')) {
    throw new SsrfBlockedError(tr('errors.platforms.blockedInternalName', { url }))
  }
  // IPv6 loopback (::1), unspecified (::), unique local (fc00::/7), link-local (fe80::/10) and
  // IPv4-mapped addresses (::ffff:7f00:1 is 127.0.0.1). `new URL()` keeps the brackets.
  const ipv6 = hostname.replace(/^\[|\]$/g, '')
  if (ipv6 === '::1' || ipv6 === '::' || /^f[cd][0-9a-f]{0,2}:/i.test(ipv6) || /^fe[89ab][0-9a-f]:/i.test(ipv6) || /^::ffff:/i.test(ipv6)) {
    throw new SsrfBlockedError(tr('errors.platforms.blockedPrivateV6', { url }))
  }
}
