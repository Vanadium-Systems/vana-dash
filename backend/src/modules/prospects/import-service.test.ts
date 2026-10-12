/**
 * Integration test — pg real (test/setup.ts). Verifică parsarea CSV tolerantă la alias-uri
 * (format vechi pe ani + format nou BUC) și UPSERT pe cif (păstrează status/notițe existente
 * dacă rândul nou nu are Status/OBS completat).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { prospects } from '../../shared/db/schema/index.js'
import { importProspects, parseProspectsCsv } from './import-service.js'

const cifs = ['QA-CIF-1', 'QA-CIF-2', 'QA-CIF-3', 'QA-CIF-5']

afterAll(async () => {
  await db.delete(prospects).where(inArray(prospects.cif, cifs))
})

describe('parseProspectsCsv', () => {
  it('recunoaște formatul nou (BUC export) prin alias-uri de coloane', () => {
    const csv = [
      'Firma,CUI,Nr. angajați,Cifra afaceri,Profit/pierdere,Capital propriu,Datorii,Disponibilități,Web1,Email1,Pers. decizie',
      'ACME TEST SRL,QA-CIF-1,10,1000000,50000,200000,100000,30000,https://acme.ro,office@acme.ro,ION POPESCU',
    ].join('\n')

    const rows = parseProspectsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'ACME TEST SRL',
      cif: 'QA-CIF-1',
      employeeCount: 10,
      revenue: 1_000_000,
      profit: 50_000,
      equity: 200_000,
      debt: 100_000,
      cash: 30_000,
      website: 'https://acme.ro',
      email: 'office@acme.ro',
      contactName: 'ION POPESCU',
    })
  })

  it('parsează numere format românesc (zecimale cu virgulă)', () => {
    const csv = ['Firma,CUI,Cifra2024RON,Profit2024RON,Angajati2024', 'BETA SRL,QA-CIF-2,"1.234.567,89","93,3",5'].join('\n')
    const rows = parseProspectsCsv(csv)
    expect(rows[0]?.revenue).toBeCloseTo(1_234_567.89)
    expect(rows[0]?.profit).toBeCloseTo(93.3)
  })

  it('recunoaște formatul deja-sortat (Status/OBS/CineAContactat) și normalizează statusul', () => {
    const csv = ['Firma,CUI,Status,OBS,CineAContactat', 'GAMMA SRL,QA-CIF-3,DE REVENIT,revin saptamana viitoare,Stefan'].join('\n')
    const rows = parseProspectsCsv(csv)
    expect(rows[0]?.presetStatus).toBe('de_revenit')
    expect(rows[0]?.presetNotes).toBe('revin saptamana viitoare')
    expect(rows[0]?.presetContactedBy).toBe('Stefan')
  })

  it('recunoaște coloanele "giga CSV" ale lui Stefan (Telefon/Site/CifraAfacereRON/NrAngajati) — bug găsit 2026-07-29: import tăcut cu revenue/employeeCount null, toate firmele SKIP/0.0', () => {
    const csv = [
      'Firma,CUI,Telefon,Email,Site,Contact,CifraAfacereRON,ProfitRON,VenituriRON,NrAngajati,AnInfiintare',
      'DELTA SRL,QA-CIF-4,0755055544,office@delta.ro,https://delta.ro,ION IONESCU,6945923,147024,5192867,28,2017',
    ].join('\n')
    const rows = parseProspectsCsv(csv)
    expect(rows[0]).toMatchObject({
      phone: '0755055544',
      website: 'https://delta.ro',
      revenue: 6_945_923,
      profit: 147_024,
      employeeCount: 28,
      foundingYear: 2017,
      hasAnyFinancialData: true,
    })
  })
})

describe('importProspects', () => {
  it('INSERT simplu la primul import, apoi UPSERT pe cif păstrează status/notes dacă noul rând nu are Status', async () => {
    const csvV1 = ['Firma,CUI,Status,OBS,Cifra2024RON,Angajati2024', 'DELTA SRL,QA-CIF-1,RESPINS,nu are buget,500000,5'].join('\n')
    await importProspects(csvV1, 'qa-test')

    const [afterFirst] = await db.select().from(prospects).where(eq(prospects.cif, 'QA-CIF-1'))
    expect(afterFirst?.status).toBe('respins')
    expect(afterFirst?.notes).toBe('nu are buget')

    // Reimport fără Status/OBS (doar date financiare actualizate) — nu trebuie să reseteze statusul.
    const csvV2 = ['Firma,CUI,Cifra2024RON,Angajati2024', 'DELTA SRL,QA-CIF-1,900000,7'].join('\n')
    await importProspects(csvV2, 'qa-test')

    const [afterSecond] = await db.select().from(prospects).where(eq(prospects.cif, 'QA-CIF-1'))
    expect(afterSecond?.status).toBe('respins')
    expect(afterSecond?.notes).toBe('nu are buget')
    expect(Number(afterSecond?.revenue)).toBe(900_000)
  })

  it('reimport cu doar telefon/website nu șterge email-ul sau datele financiare deja existente', async () => {
    const csvV1 = ['Firma,CUI,Email,Cifra2024RON,Angajati2024', 'EPSILON SRL,QA-CIF-5,office@epsilon.ro,750000,8'].join('\n')
    await importProspects(csvV1, 'qa-test')

    const [afterFirst] = await db.select().from(prospects).where(eq(prospects.cif, 'QA-CIF-5'))
    expect(afterFirst?.email).toBe('office@epsilon.ro')
    expect(Number(afterFirst?.revenue)).toBe(750_000)

    // Reimport doar cu telefon + website (fără Email, fără date financiare).
    const csvV2 = ['Firma,CUI,Telefon,Site', 'EPSILON SRL,QA-CIF-5,0722111222,https://epsilon.ro'].join('\n')
    await importProspects(csvV2, 'qa-test')

    const [afterSecond] = await db.select().from(prospects).where(eq(prospects.cif, 'QA-CIF-5'))
    expect(afterSecond?.phone).toBe('0722111222')
    expect(afterSecond?.website).toBe('https://epsilon.ro')
    expect(afterSecond?.email).toBe('office@epsilon.ro')
    expect(Number(afterSecond?.revenue)).toBe(750_000)
    expect(afterSecond?.employeeCount).toBe(8)
  })
})
