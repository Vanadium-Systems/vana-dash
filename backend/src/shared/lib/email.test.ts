import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_RESEND_KEY = process.env.RESEND_API_KEY

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  if (ORIGINAL_RESEND_KEY === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = ORIGINAL_RESEND_KEY
})

describe('sendAlertEmail — with RESEND_API_KEY configured', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  it('POSTs the correct payload and Authorization header to Resend', async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.resend.com/emails')
      expect(init.method).toBe('POST')
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer test-resend-key')
      expect(headers['Content-Type']).toBe('application/json')
      const body = JSON.parse(init.body as string)
      expect(body.from).toBeTruthy()
      expect(body.to).toEqual([expect.any(String)])
      expect(body.subject).toBe('[vana-dash] Test subject')
      expect(body.text).toBe('Test body')
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { sendAlertEmail } = await import('./email.js')
    await sendAlertEmail('Test subject', 'Test body')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not throw when fetch rejects (network failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const { sendAlertEmail } = await import('./email.js')
    await expect(sendAlertEmail('subject', 'body')).resolves.toBeUndefined()
  })

  it('does not throw when Resend responds non-200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    )
    const { sendAlertEmail } = await import('./email.js')
    await expect(sendAlertEmail('subject', 'body')).resolves.toBeUndefined()
  })
})

describe('sendAlertEmail — without RESEND_API_KEY', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.RESEND_API_KEY
  })

  it('never calls fetch and does not throw', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { sendAlertEmail } = await import('./email.js')
    await expect(sendAlertEmail('subject', 'body')).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('sendAlertEmail — payload target', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  it('sends to config.alertEmailTo with the [vana-dash] prefix', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string)
        return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
      }),
    )
    const { sendAlertEmail } = await import('./email.js')
    const { config } = await import('../config.js')
    await sendAlertEmail('Ceva', 'Body')
    expect(capturedBody.to).toEqual([config.alertEmailTo])
    expect(capturedBody.subject).toBe('[vana-dash] Ceva')
  })
})

describe('sendEmail — attachments', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  it('base64-encodes attachment content exactly as Buffer.toString(base64)', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 fake pdf content for test purposes only')
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string)
        return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
      }),
    )

    const { sendEmail } = await import('./email.js')
    await sendEmail({
      to: 'client@example.com',
      subject: 'Factura VAN-2026-0001',
      text: 'Atașat factura.',
      attachments: [{ filename: 'VAN-2026-0001.pdf', content: pdfBytes }],
    })

    const attachments = capturedBody.attachments as Array<{ filename: string; content: string }>
    expect(attachments).toHaveLength(1)
    expect(attachments[0]!.filename).toBe('VAN-2026-0001.pdf')
    expect(attachments[0]!.content).toBe(pdfBytes.toString('base64'))
    // Sanity: base64 round-trips back to the exact original bytes.
    expect(Buffer.from(attachments[0]!.content, 'base64').equals(pdfBytes)).toBe(true)
  })

  it('omits the attachments key entirely when none are given (not an empty array)', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string)
        return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 })
      }),
    )

    const { sendEmail } = await import('./email.js')
    await sendEmail({ to: 'client@example.com', subject: 'Subiect fără atașament', text: 'Body' })

    expect('attachments' in capturedBody).toBe(false)
  })

  it('does not call fetch when RESEND_API_KEY is missing, even with attachments given', async () => {
    vi.resetModules()
    delete process.env.RESEND_API_KEY
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { sendEmail } = await import('./email.js')
    await expect(
      sendEmail({
        to: 'client@example.com',
        subject: 'x',
        text: 'y',
        attachments: [{ filename: 'a.pdf', content: Buffer.from('x') }],
      }),
    ).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not throw when fetch rejects, even with attachments given', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const { sendEmail } = await import('./email.js')
    await expect(
      sendEmail({
        to: 'client@example.com',
        subject: 'x',
        text: 'y',
        attachments: [{ filename: 'a.pdf', content: Buffer.from('x') }],
      }),
    ).resolves.toBeUndefined()
  })

  it('does not throw when Resend responds non-2xx, even with attachments given', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    )
    const { sendEmail } = await import('./email.js')
    await expect(
      sendEmail({
        to: 'client@example.com',
        subject: 'x',
        text: 'y',
        attachments: [{ filename: 'a.pdf', content: Buffer.from('x') }],
      }),
    ).resolves.toBeUndefined()
  })
})
