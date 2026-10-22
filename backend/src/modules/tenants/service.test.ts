import { describe, expect, it } from 'vitest'
import { tenantSlug } from './service.js'

describe('tenantSlug', () => {
  it('keeps letters and digits, drops the rest', () => {
    expect(tenantSlug('Acme Ștefan SRL')).toBe('acme-stefan-srl')
  })

  it('collapses runs of separators and trims them', () => {
    expect(tenantSlug('  --Ab__c--  ')).toBe('ab-c')
  })

  it('caps the slug at 60 characters', () => {
    expect(tenantSlug('a'.repeat(100))).toHaveLength(60)
  })
})
