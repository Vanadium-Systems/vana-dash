import { describe, expect, it } from 'vitest'
import type { ArchiveDetails } from '@/shared/lib/types'
import { detailsItem } from './items'

const details: ArchiveDetails = {
  id: 'f1',
  name: 'offer.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  tags: ['acme'],
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-02T10:00:00.000Z',
  path: [],
  createdBy: null,
  updatedBy: null,
  owner: { id: 'u1', name: 'Ana' } as ArchiveDetails['owner'],
  starred: true,
  access: [],
}

describe('detailsItem', () => {
  it('gives a file opened by link the fields its actions need', () => {
    expect(detailsItem(details)).toMatchObject({ kind: 'file', id: 'f1', name: 'offer.pdf', mimeType: 'application/pdf', sizeBytes: 2048, starred: true, canWrite: false, ownerUserId: 'u1' })
  })

  it('reads details without a mime type as a folder', () => {
    const folder: ArchiveDetails = { ...details, mimeType: undefined, sizeBytes: undefined, tags: undefined, color: 3 }
    expect(detailsItem(folder)).toMatchObject({ kind: 'folder', mimeType: '', sizeBytes: 0, tags: [], color: 3 })
  })
})
