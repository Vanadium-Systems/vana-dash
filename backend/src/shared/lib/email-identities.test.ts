import { describe, expect, it } from 'vitest'
import { bareAddress } from './email-identities.js'

describe('bareAddress', () => {
  it('drops the display name, which mailto: in an ORGANIZER line cannot carry', () => {
    expect(bareAddress('Acme Sales <sales@acme.example>')).toBe('sales@acme.example')
    expect(bareAddress(' office@acme.example ')).toBe('office@acme.example')
    expect(bareAddress('')).toBe('')
  })
})
