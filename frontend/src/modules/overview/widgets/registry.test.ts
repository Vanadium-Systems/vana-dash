// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WIDGETS, availableWidgets } from './registry'

// The backend list is read as text so the frontend never imports server code.
const source = readFileSync(resolve(__dirname, '../../../../../backend/src/modules/overview/widgets.ts'), 'utf8')
const block = source.slice(source.indexOf('export const WIDGETS'), source.indexOf('export const DEFAULT_COMPANY_LAYOUT'))
const backend = [...block.matchAll(/^\s*(\w+): \{ feature: '([^']+)', sizes: \[([^\]]*)\] \}/gm)].map((m) => ({
  id: m[1]!,
  feature: m[2]!,
  sizes: m[3]!.split(',').map((s) => s.trim().replace(/'/g, '')),
}))

describe('registrul de widget-uri Acasă', () => {
  it('are aceleași id-uri, mărimi și funcționalități ca backend-ul', () => {
    expect(backend.length).toBeGreaterThan(0)
    const front = WIDGETS.map((w) => ({ id: w.id, feature: w.feature, sizes: [...w.sizes] }))
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    expect(front.sort(byId)).toEqual(backend.sort(byId))
  })

  it('un om cu calendar, mesaje și clienți nu vede widget-uri de bani', () => {
    const can = (feature: string) => ['calendar.view', 'mesaje.view', 'clienti.view'].includes(feature)
    const ids = availableWidgets(can).map((w) => w.id)
    expect(availableWidgets(can).some((w) => w.feature === 'financiar.view' || w.feature === 'facturi.view')).toBe(false)
    expect(ids).toEqual(expect.arrayContaining(['today', 'unread_messages', 'my_tasks']))
  })
})
