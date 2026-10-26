import { describe, expect, it } from 'vitest'
import { NAV_GROUP_ORDER, NAV_ITEMS, resolveNavLayout } from './nav-items'

describe('NAV_ITEMS', () => {
  it('are 21 destinații, fiecare într-un grup cunoscut', () => {
    expect(NAV_ITEMS).toHaveLength(21)
    expect(NAV_ITEMS.every((item) => (NAV_GROUP_ORDER as readonly string[]).includes(item.group))).toBe(true)
  })

  it('poarta fiecărei pagini e o funcționalitate din catalog; fără poartă doar Azi și Echipă', () => {
    const withoutGate = NAV_ITEMS.filter((item) => !item.feature).map((item) => item.to)
    expect(withoutGate).toEqual(['/', '/team'])
  })

  it('ignoră din nav.layout salvat rutele contopite (Rapoarte, Plan, Wishlist, Acțiuni)', () => {
    const saved = [
      { to: '/reports', visible: true },
      { to: '/email', visible: true },
      { to: '/plan', visible: false },
      { to: '/wishlist', visible: true },
      { to: '/assets', visible: true },
      { to: '/', visible: true },
    ]
    const resolved = resolveNavLayout(saved).map((item) => item.to)
    expect(resolved.slice(0, 2)).toEqual(['/email', '/'])
    expect(resolved).not.toContain('/reports')
    expect(resolved).not.toContain('/plan')
    expect(resolved).not.toContain('/assets')
    expect(resolved).toHaveLength(21)
  })
})
