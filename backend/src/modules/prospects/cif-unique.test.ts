/**
 * Integration test on a real Postgres (test/setup.ts). uq_prospects_cif_normalized: one live prospect per
 * normalized CIF, however it is written. A lost race or an edit onto a taken CIF answers PROSPECT_EXISTS,
 * never a 500; deleted and merged rows do not hold a CIF; an empty CIF may repeat.
 */
import { readFileSync } from 'node:fs'
import { eq, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db, sql } from '../../shared/db/client.js'
import { prospects } from '../../shared/db/schema/index.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { commitImport, previewImport } from './import-service.js'
import * as service from './service.js'

const SOURCE = `qa-cif-${crypto.randomUUID()}`
const userIds: string[] = []
let a: SessionUser

const buffer = (lines: string[]) => Buffer.from(lines.join('\n'))
const byNormalized = (cif: string) => db.select().from(prospects).where(eq(prospects.cifNormalized, cif))
const caught = async (run: () => Promise<unknown>) => {
  try {
    await run()
  } catch (err) {
    return err
  }
  return undefined
}

beforeAll(async () => {
  a = await createTestUser('cif-a', userIds, { features: ['clienti.view', 'clienti.prospectare'] })
})

afterAll(async () => {
  await db.delete(prospects).where(eq(prospects.source, SOURCE))
  await db.delete(prospects).where(like(prospects.name, 'QA Cif %'))
  await cleanupTestUsers(userIds)
})

describe('create', () => {
  it('two writers racing on the same CIF in different forms: one wins, the other gets PROSPECT_EXISTS', async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const key = `9820010${n}`
      const results = await Promise.allSettled([
        service.createProspect(a, { name: `QA Cif Race A ${n}`, cif: `RO${key}` }),
        service.createProspect(a, { name: `QA Cif Race B ${n}`, cif: ` ${key}` }),
      ])
      const lost = results.filter((r) => r.status === 'rejected')
      expect(lost).toHaveLength(1)
      expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(service.ProspectExistsError)
      expect(await byNormalized(key)).toHaveLength(1)
    }
  })

  it('the index itself refuses the second form, and isCifConflict recognises it', async () => {
    await service.createProspect(a, { name: 'QA Cif Index SRL', cif: 'RO98200020' })
    const err = await caught(() => db.insert(prospects).values({ name: 'QA Cif Index Bis SRL', cif: ' 98200020' }))
    expect(service.isCifConflict(err)).toBe(true)
  })

  it('the lost race carries the existing company', async () => {
    const first = await service.createProspect(a, { name: 'QA Cif Holder SRL', cif: '98200030' })
    const err = await caught(() => service.createProspect(a, { name: 'QA Cif Second SRL', cif: 'ro 98200030' }))
    expect(err).toBeInstanceOf(service.ProspectExistsError)
    expect((err as service.ProspectExistsError).existing).toMatchObject({ id: first.id, name: 'QA Cif Holder SRL' })
  })

  it('an empty CIF may repeat, and so may one that normalizes to nothing', async () => {
    await service.createProspect(a, { name: 'QA Cif Empty 1 SRL' })
    await service.createProspect(a, { name: 'QA Cif Empty 2 SRL', cif: '   ' })
    await service.createProspect(a, { name: 'QA Cif Empty 3 SRL' })
    await db.insert(prospects).values({ name: 'QA Cif Empty 4 SRL', cif: 'RO' })
    await db.insert(prospects).values({ name: 'QA Cif Empty 5 SRL', cif: ' ro ' })
    expect(await byNormalized('')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'QA Cif Empty 4 SRL' }), expect.objectContaining({ name: 'QA Cif Empty 5 SRL' })]))
  })

  it('findByCif has the index conditions: an empty key finds nothing', async () => {
    expect(await service.findByCif('RO')).toBeUndefined()
  })
})

describe('update', () => {
  it('moving a prospect onto a CIF that is taken answers PROSPECT_EXISTS with the holder', async () => {
    const holder = await service.createProspect(a, { name: 'QA Cif Taken SRL', cif: '98200040' })
    const mover = await service.createProspect(a, { name: 'QA Cif Mover SRL', cif: '98200041' })
    const err = await caught(() => service.updateProspect(a, mover.id, { cif: 'RO98200040' }))
    expect(err).toBeInstanceOf(service.ProspectExistsError)
    expect((err as service.ProspectExistsError).existing.id).toBe(holder.id)
    expect((await byNormalized('98200041'))[0]?.id).toBe(mover.id)
  })

  it('rewriting its own CIF in another form is not a conflict', async () => {
    const own = await service.createProspect(a, { name: 'QA Cif Own SRL', cif: '98200042' })
    await service.updateProspect(a, own.id, { cif: 'RO98200042' })
    expect((await byNormalized('98200042'))[0]?.cif).toBe('RO98200042')
  })

  it('a CIF freed by a deleted prospect can be taken', async () => {
    const gone = await service.createProspect(a, { name: 'QA Cif Gone SRL', cif: 'RO98200043' })
    await service.deleteProspect(a, gone.id)
    const reborn = await service.createProspect(a, { name: 'QA Cif Reborn SRL', cif: '98200043' })
    expect((await byNormalized('98200043')).filter((r) => r.deletedAt === null).map((r) => r.id)).toEqual([reborn.id])
  })
})

describe('rows that do not hold a CIF', () => {
  it('a merged row (merged_into_id set) does not block, and findByCif skips it', async () => {
    const master = await service.createProspect(a, { name: 'QA Cif Master SRL', cif: '98200050' })
    const merged = await service.createProspect(a, { name: 'QA Cif Merged SRL', cif: 'RO98200051' })
    await db.update(prospects).set({ mergedIntoId: master.id }).where(eq(prospects.id, merged.id))
    expect(await service.findByCif('98200051')).toBeUndefined()
    const fresh = await service.createProspect(a, { name: 'QA Cif Fresh SRL', cif: '98200051' })
    expect(fresh.id).not.toBe(merged.id)
  })

  it('bringing a deleted prospect back onto a CIF a live one now holds is refused by the index', async () => {
    // No service restores a prospect today; this is the guard for the day one does.
    const gone = await service.createProspect(a, { name: 'QA Cif Trashed SRL', cif: 'RO98200060' })
    await service.deleteProspect(a, gone.id)
    await service.createProspect(a, { name: 'QA Cif Holder 2 SRL', cif: '98200060' })
    const err = await caught(() => db.update(prospects).set({ deletedAt: null }).where(eq(prospects.id, gone.id)))
    expect(service.isCifConflict(err)).toBe(true)
  })
})

describe('import', () => {
  const commit = async (lines: string[]) => {
    const preview = await previewImport(a, buffer(lines), 'qa.csv', SOURCE)
    return { preview, result: await commitImport(a, preview.token, { mode: 'me' }) }
  }

  it('the same CIF twice in a file in two forms: the second row is a duplicate, the batch goes on', async () => {
    const { result } = await commit(['Nume firmă,CUI', 'QA Cif Imp One SRL,98200070', 'QA Cif Imp Dup SRL,RO 98200070', 'QA Cif Imp Two SRL,98200071'])
    expect(result).toMatchObject({ created: 2, skipped: 1 })
    expect(await byNormalized('98200070')).toHaveLength(1)
  })

  it('a CIF taken between the plan and the insert makes the row a duplicate, not a failed batch', async () => {
    const preview = await previewImport(a, buffer(['Nume firmă,CUI', 'QA Cif Imp Late SRL,98200080', 'QA Cif Imp Other SRL,98200081']), 'qa.csv', SOURCE)
    const real = db.transaction.bind(db)
    const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(((fn: never, config?: never) =>
      // Someone else creates the company right before the batch is written.
      service.createProspect(a, { name: 'QA Cif Imp Winner SRL', cif: 'RO98200080' }).then(() => real(fn, config))) as never)
    const result = await commitImport(a, preview.token, { mode: 'me' })
    spy.mockRestore()
    expect(result).toMatchObject({ created: 1, skipped: 1 })
    const holders = await byNormalized('98200080')
    expect(holders.map((r) => r.name)).toEqual(['QA Cif Imp Winner SRL'])
    expect(await byNormalized('98200081')).toHaveLength(1)
  })

  it('an existing prospect whose fill would take a CIF held elsewhere is skipped, the rest of the batch is written', async () => {
    const bare = await service.createProspect(a, { name: 'QA Cif Imp Bare SRL', phone: '0733 000 090' })
    const preview = await previewImport(a, buffer(['Nume firmă,CUI,Telefon', 'QA Cif Imp Bare SRL,98200090,0733 000 090', 'QA Cif Imp After SRL,98200091,']), 'qa.csv', SOURCE)
    expect(preview.rows[0]).toMatchObject({ action: 'update', prospectId: bare.id })
    const real = db.transaction.bind(db)
    const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(((fn: never, config?: never) =>
      service.createProspect(a, { name: 'QA Cif Imp Holder SRL', cif: 'RO98200090' }).then(() => real(fn, config))) as never)
    const result = await commitImport(a, preview.token, { mode: 'me' })
    spy.mockRestore()
    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 1 })
    expect((await byNormalized('98200090')).map((r) => r.name)).toEqual(['QA Cif Imp Holder SRL'])
  })
})

describe('migration 0109', () => {
  it('fails on live duplicates with counts only, and no CIF in the message', async () => {
    const guard = readFileSync(new URL('../../shared/db/migrations/0109_prospect_cif_unique.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')[0]!
    const rollback = new Error('rollback')
    let failure: unknown
    await sql
      .begin(async (tx) => {
        await tx.unsafe('DROP INDEX uq_prospects_cif_normalized')
        await tx.unsafe("INSERT INTO prospects (name, cif) VALUES ('QA Cif Mig 1 SRL', 'RO98200099'), ('QA Cif Mig 2 SRL', '98200099'), ('QA Cif Mig 3 SRL', ' 98200099 ')")
        try {
          await tx.unsafe(guard)
        } catch (err) {
          failure = err
        }
        throw rollback
      })
      .catch((err) => {
        if (err !== rollback) throw err
      })
    expect((failure as Error).message).toMatch(/1 groups of live prospects share a normalized CIF \(2 surplus rows\)/)
    expect((failure as Error).message).not.toContain('98200099')
    expect(await byNormalized('98200099')).toHaveLength(0)
  })

  it('passes on data without duplicates', async () => {
    const guard = readFileSync(new URL('../../shared/db/migrations/0109_prospect_cif_unique.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')[0]!
    await expect(sql.unsafe(guard)).resolves.toBeDefined()
  })
})
