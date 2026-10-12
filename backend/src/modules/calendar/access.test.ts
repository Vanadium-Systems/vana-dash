/**
 * modules/calendar/service.ts — izolarea între calendare (Wave 6), pg real (test/setup.ts).
 *
 * Cazurile de pornire ale modelului (decizii Stefan, 2026-09-30): un coleg nu vede calendarul
 * lui Stefan; un secretar primește „editează" pe calendarul lui ca să-i facă programări; un
 * eveniment comun apare la participanți fără share între calendare.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { calendarEvents } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import * as service from './service.js'

const userIds: string[] = []
const eventIds: string[] = []

const stefan = await createTestUser('calendar stefan', userIds)
const secretar = await createTestUser('calendar secretar', userIds)
const coleg = await createTestUser('calendar coleg', userIds)
const comun = await createTestUser('calendar comun', userIds, { features: ['calendar.comune'] })

const MON = new Date('2026-07-20T09:00:00.000Z')
const FROM = new Date('2026-07-20T00:00:00.000Z')
const TO = new Date('2026-07-21T00:00:00.000Z')

async function makeEvent(input: { title: string; attendeeUserIds?: string[]; calendarOwnerUserId?: string }, me = stefan) {
  const row = (await service.createEvent(me, {
    startAt: MON,
    endAt: new Date(MON.getTime() + 60 * 60 * 1000),
    ...input,
  }))!
  eventIds.push(row.id)
  return row
}

async function visibleTo(me: typeof stefan) {
  const rows = await service.listOccurrences(me, FROM, TO)
  return rows.filter((o) => eventIds.includes(o.eventId))
}

afterAll(async () => {
  if (eventIds.length) await db.delete(calendarEvents).where(inArray(calendarEvents.id, eventIds))
  await cleanupTestUsers(userIds)
})

describe('filtrarea listei', () => {
  it('un coleg nu vede niciun eveniment al lui Stefan, fără share', async () => {
    await makeEvent({ title: 'QA Ședință Stefan' })
    expect(await visibleTo(coleg)).toEqual([])
  })

  it('proprietarul vede propriul eveniment, cu `access` = owner și numele lui', async () => {
    const event = await makeEvent({ title: 'QA Proprietar' })
    const occ = (await visibleTo(stefan)).find((o) => o.eventId === event.id)
    expect(occ?.access).toBe('owner')
    expect(occ?.ownerUserId).toBe(stefan.id)
    expect(occ?.ownerName).toBe('QA calendar stefan')
  })

  it('un calendar partajat „vede" apare la cel care l-a primit, cu numele omului', async () => {
    const event = await makeEvent({ title: 'QA Partajat' })
    await service.setCalendarShare(stefan, stefan.id, secretar.id, 'view')

    const occ = (await visibleTo(secretar)).find((o) => o.eventId === event.id)
    expect(occ?.access).toBe('view')
    expect(occ?.ownerName).toBe('QA calendar stefan')
  })

  it('calendar.administrare vede toate calendarele, fără share', async () => {
    const sef = await createTestUser('calendar sef', userIds, { features: ['calendar.administrare'] })
    await makeEvent({ title: 'QA Vizibil doar pentru sef' })
    expect((await visibleTo(coleg)).length).toBe(0)
    expect((await visibleTo(sef)).length).toBeGreaterThan(0)
  })
})

describe('editare și ștergere după id', () => {
  it('un eveniment dintr-un calendar fără share dă null (ruta răspunde 404)', async () => {
    const event = await makeEvent({ title: 'QA Ineditabil' })
    expect(await service.updateEvent(coleg, event.id, { title: 'nu' })).toBeNull()
    expect(await service.deleteEvent(coleg, event.id)).toBeNull()
  })

  it('„vede" permite citit, nu scris — 403, nu 404 (evenimentul există, nu-l poate atinge)', async () => {
    const event = await makeEvent({ title: 'QA Doar citit' })
    await service.setCalendarShare(stefan, stefan.id, secretar.id, 'view')
    await expect(service.updateEvent(secretar, event.id, { title: 'nu' })).rejects.toThrow(service.CalendarAccessError)
  })

  it('„editează" lasă secretarul să modifice calendarul lui Stefan (cazul de pornire)', async () => {
    const event = await makeEvent({ title: 'QA Programare de secretar' })
    await service.setCalendarShare(stefan, stefan.id, secretar.id, 'edit')

    const updated = await service.updateEvent(secretar, event.id, { title: 'Mutat de secretar' })
    expect(updated?.title).toBe('Mutat de secretar')
    // Dar calendarul rămâne al lui Stefan — schimbarea e o programare, nu o preluare.
    const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, event.id))
    expect(row?.ownerUserId).toBe(stefan.id)
  })

  it('cu „editează", secretarul creează evenimentul direct în calendarul lui Stefan', async () => {
    await service.setCalendarShare(stefan, stefan.id, secretar.id, 'edit')
    const row = await makeEvent({ title: 'QA Programare nouă', calendarOwnerUserId: stefan.id }, secretar)
    expect(row.ownerUserId).toBe(stefan.id)
    expect((await visibleTo(stefan)).map((o) => o.title)).toContain('QA Programare nouă')
  })

  it('cu „vede" sau fără share, crearea în calendarul altcuia e 403', async () => {
    await service.setCalendarShare(stefan, stefan.id, secretar.id, 'view')
    await expect(makeEvent({ title: 'QA nu', calendarOwnerUserId: stefan.id }, secretar)).rejects.toMatchObject({ status: 403 })
    await expect(makeEvent({ title: 'QA nu', calendarOwnerUserId: stefan.id }, coleg)).rejects.toMatchObject({ status: 403 })
  })

  it('cel cu „editare" nu își poate da calendarul altuia mai departe', async () => {
    await service.setCalendarShare(stefan, stefan.id, secretar.id, 'edit')
    await expect(service.setCalendarShare(secretar, stefan.id, coleg.id, 'view')).rejects.toThrow(
      service.CalendarAccessError,
    )
  })
})

describe('evenimente comune', () => {
  it('fără calendar.comune, crearea cu participanți e refuzată (403)', async () => {
    await expect(makeEvent({ title: 'QA Com fără feature', attendeeUserIds: [coleg.id] })).rejects.toThrow(
      service.CalendarAccessError,
    )
  })

  it('cu calendar.comune: apare la creator și la fiecare participant, și la nimeni altcineva', async () => {
    const event = await makeEvent({ title: 'QA Ședință de echipă', attendeeUserIds: [coleg.id] }, comun)

    for (const om of [comun, coleg]) {
      const occ = (await visibleTo(om)).find((o) => o.eventId === event.id)
      expect(occ?.isCommon).toBe(true)
      expect(occ?.attendees.map((a) => a.id)).toEqual([coleg.id])
      expect(occ?.ownerName).toBe('QA calendar comun')
    }
    expect((await visibleTo(secretar)).some((o) => o.eventId === event.id)).toBe(false)
  })

  it('participantul vede evenimentul comun, dar nu îl poate modifica fără calendar.comune', async () => {
    const event = await makeEvent({ title: 'QA Com fără editare', attendeeUserIds: [coleg.id] }, comun)
    const occ = (await visibleTo(coleg)).find((o) => o.eventId === event.id)
    expect(occ?.access).toBe('view')
    await expect(service.updateEvent(coleg, event.id, { title: 'nu' })).rejects.toThrow(
      service.CalendarAccessError,
    )
  })

  it('participantul cu calendar.comune poate modifica evenimentul comun', async () => {
    const event = await makeEvent({ title: 'QA Com editabil' }, comun)
    const secretarComun = await createTestUser('calendar secretar comun', userIds, {
      features: ['calendar.comune'],
    })
    await service.setCalendarShare(comun, comun.id, secretarComun.id, 'edit')
    const updated = await service.updateEvent(secretarComun, event.id, { title: 'Mutat de participant' })
    expect(updated?.title).toBe('Mutat de participant')
  })

  it('creatorul nu se poate adăuga și el participant', async () => {
    await expect(makeEvent({ title: 'QA Auto-participant', attendeeUserIds: [comun.id] }, comun)).rejects.toThrow(
      service.CalendarAccessError,
    )
  })

  it('un participant inexistent e refuzat', async () => {
    await expect(
      makeEvent({ title: 'QA Participant inexistent', attendeeUserIds: ['00000000-0000-0000-0000-000000000000'] }, comun),
    ).rejects.toThrow(service.CalendarAccessError)
  })
})

describe('listCalendars — layer-ele din UI', () => {
  it('omul primește calendarul lui (owner) + calendarele primite prin share', async () => {
    const { mine, given, members } = await service.listCalendars(secretar)
    expect(mine.find((c) => c.userId === secretar.id)?.owner).toBe(true)
    expect(mine.find((c) => c.userId === stefan.id)?.level).toBe('edit')
    expect(given).toEqual([])
    expect(members.some((m) => m.id === stefan.id)).toBe(true)
    expect(members.some((m) => m.id === secretar.id)).toBe(false) // nu te poți invita pe tine
  })

  it('share-ul dat apare la „given" și dispare din „mine" când e scos', async () => {
    await service.setCalendarShare(stefan, stefan.id, secretar.id, 'view')
    const cuShare = await service.listCalendars(stefan)
    expect(cuShare.given.find((s) => s.userId === secretar.id)?.level).toBe('view')

    await service.removeCalendarShare(stefan, stefan.id, secretar.id)
    const faraShare = await service.listCalendars(stefan)
    expect(faraShare.given.find((s) => s.userId === secretar.id)).toBeUndefined()
    expect(faraShare.mine.some((c) => c.userId === stefan.id && c.owner)).toBe(true)
  })
})