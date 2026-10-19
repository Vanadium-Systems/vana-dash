import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RELEASES, isUnseen, visibleReleases } from '@/modules/updates/releases'
import { GUIDES, guidePageLabel, guideRouteOf, searchGuides, visibleGuides } from './guides'

// Catalogul de funcționalități e în backend; frontend-ul îl primește doar ca șiruri. Citit ca
// text, ca o cheie scrisă greșit într-un ghid (care l-ar ascunde tuturor) să pice aici.
const catalog = readFileSync(resolve(__dirname, '../../../../backend/src/shared/lib/features.ts'), 'utf8')
const inCatalog = (key: string) => catalog.includes(`key: '${key}'`)

const only = (...features: string[]) => (feature: string) => features.includes(feature)

describe('ghiduri', () => {
  it('fiecare ghid ține de o funcționalitate din catalog (sau de nicio funcționalitate) și de o pagină cu nume', () => {
    for (const guide of GUIDES) {
      if (guide.feature) expect(inCatalog(guide.feature), `${guide.id}: ${guide.feature}`).toBe(true)
      expect(guidePageLabel(guide.route), `${guide.id}: ${guide.route}`).toBeDefined()
      expect(guide.steps.length, guide.id).toBeGreaterThan(0)
    }
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length)
  })

  it('omul vede doar ghidurile funcționalităților pe care le are', () => {
    const sales = visibleGuides(only('email.view', 'clienti.prospectare'))
    expect(sales.map((g) => g.id).sort()).toEqual(['clienti-prospecti', 'email-citire', 'profil-meu'])
    expect(visibleGuides(only()).map((g) => g.id)).toEqual(['profil-meu'])
  })

  it('pagina se ia din prima parte a căii', () => {
    expect(guideRouteOf('/messages/abc-123')).toBe('/messages')
    expect(guideRouteOf('/email')).toBe('/email')
    expect(guideRouteOf('/')).toBe('/')
  })

  it('căutarea ignoră diacriticele și caută și în pași', () => {
    expect(searchGuides(GUIDES, 'raspunzi').map((g) => g.id)).toContain('email-raspuns')
    expect(searchGuides(GUIDES, 'Promovează').map((g) => g.id)).toEqual(['clienti-prospecti'])
    expect(searchGuides(GUIDES, '  ')).toHaveLength(GUIDES.length)
  })
})

describe('noutăți', () => {
  it('fiecare intrare are funcționalități din catalog și lista e ordonată, cea mai nouă sus', () => {
    for (const release of RELEASES) {
      for (const feature of release.features) expect(inCatalog(feature), `${release.title}: ${feature}`).toBe(true)
      expect(Number.isNaN(Date.parse(release.publishedAt)), release.title).toBe(false)
    }
    const times = RELEASES.map((r) => Date.parse(r.publishedAt))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(new Set(times).size).toBe(times.length)
  })

  it('un om fără funcționalitate nu vede noutatea ei; cele generale le vede oricine', () => {
    const sales = visibleReleases(only('email.view'))
    expect(sales.every((r) => r.features.length === 0 || r.features.includes('email.view'))).toBe(true)
    expect(sales.length).toBeGreaterThan(0)
    expect(visibleReleases(only('facturi.contracte')).some((r) => r.title === 'Numere de contract rezervate')).toBe(true)
    expect(sales.some((r) => r.title === 'Numere de contract rezervate')).toBe(false)
  })

  it('e „nou” ce a apărut după ultima vizită; cine n-a deschis niciodată pagina le are pe toate noi', () => {
    const release = { publishedAt: '2026-10-12T10:00:00+03:00', title: 't', body: 'b', features: [] }
    expect(isUnseen(release, null)).toBe(true)
    expect(isUnseen(release, '2026-10-12T06:59:00.000Z')).toBe(true)
    expect(isUnseen(release, '2026-10-12T07:01:00.000Z')).toBe(false)
  })
})
