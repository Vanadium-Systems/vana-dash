/**
 * jobs/tender-watch-sync.ts — cron 2x/zi. Unit test, orchestrare: mockuim clientul SICAP
 * (`e-licitatie-client.ts`, are propriile teste de matching) și service-ul de persistență,
 * verificăm doar orchestrarea — izolarea eșecului per sursă (regula #7 CLAUDE.md: o sursă
 * picată nu oprește cealaltă) și alertarea (pg real, ca în bnr-daily-fetch.test.ts).
 */
import { and, eq, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import { alertRules, alerts } from '../shared/db/schema/index.js'

const fetchDaMock = vi.fn()
const fetchCNoticeMock = vi.fn()
const matchMock = vi.fn()
const matchesAnyRuleMock = vi.fn()
const fetchEligibilityMock = vi.fn()
const listActiveWatchRulesMock = vi.fn()
const upsertMock = vi.fn()
const getCompanyProfileMock = vi.fn()
const getOpsJobTogglesMock = vi.fn()
const setOpsJobTogglesMock = vi.fn()
const sicapBlockedStatusMock = vi.fn()
const listCheckedMock = vi.fn()

vi.mock('../modules/tenders/e-licitatie-client.js', () => ({
  fetchOpenDirectAcquisitions: (...args: unknown[]) => fetchDaMock(...args),
  fetchOpenContractNotices: (...args: unknown[]) => fetchCNoticeMock(...args),
  matchWatchRule: (...args: unknown[]) => matchMock(...args),
  matchesAnyRule: (...args: unknown[]) => matchesAnyRuleMock(...args),
  fetchContractNoticeEligibility: (...args: unknown[]) => fetchEligibilityMock(...args),
  beginSicapRun: () => {},
  sicapBlockedStatus: () => sicapBlockedStatusMock(),
}))

vi.mock('../modules/tenders/service.js', () => ({
  listActiveWatchRules: (...args: unknown[]) => listActiveWatchRulesMock(...args),
  upsertTenderOpportunities: (...args: unknown[]) => upsertMock(...args),
  listEligibilityCheckedNoticeIds: (...args: unknown[]) => listCheckedMock(...args),
}))

vi.mock('../modules/settings/service.js', () => ({
  getCompanyProfile: (...args: unknown[]) => getCompanyProfileMock(...args),
  getOpsJobToggles: (...args: unknown[]) => getOpsJobTogglesMock(...args),
  setOpsJobToggles: (...args: unknown[]) => setOpsJobTogglesMock(...args),
}))

const { runTenderWatchSyncJob } = await import('./tender-watch-sync.js')

const DA_RULE_KEY = 'tender_watch.direct_acquisition_fetch_failed'
const CNOTICE_RULE_KEY = 'tender_watch.contract_notice_fetch_failed'
const NEW_OPP_RULE_KEY = 'tender_watch.new_opportunities'
const NEW_PRIORITY_RULE_KEY = 'tender_watch.new_priority_opportunities'
const BLOCKED_RULE_KEY = 'tender_watch.sicap_blocked'

async function cleanupAlerts(metricKey: string) {
  const [rule] = await db.select({ id: alertRules.id }).from(alertRules).where(eq(alertRules.metricKey, metricKey))
  if (!rule) return
  await db.delete(alerts).where(eq(alerts.ruleId, rule.id))
  await db.delete(alertRules).where(eq(alertRules.id, rule.id))
}

async function cleanupAllAlerts() {
  await cleanupAlerts(DA_RULE_KEY)
  await cleanupAlerts(CNOTICE_RULE_KEY)
  await cleanupAlerts(NEW_OPP_RULE_KEY)
  await cleanupAlerts(NEW_PRIORITY_RULE_KEY)
  await cleanupAlerts(BLOCKED_RULE_KEY)
}

const ruleQA = { id: 'rule-qa', label: 'QA', cpvPrefix: '72', keyword: null, active: true, highPriority: false, exclude: false }
const rulePriority = { id: 'rule-priority', label: 'QA prioritate', cpvPrefix: '48', keyword: null, active: true, highPriority: true, exclude: false }
const ruleExclude = { id: 'rule-exclude', label: 'QA exclude', cpvPrefix: null, keyword: 'windows', active: true, highPriority: false, exclude: true }
const rowDa = { source: 'direct_acquisition', externalId: 'DA-1', title: 'DA item', raw: {} }
const rowNotice = { source: 'contract_notice', externalId: 'CN-1', title: 'CN item', raw: {} }

beforeEach(async () => {
  fetchDaMock.mockReset()
  fetchCNoticeMock.mockReset()
  matchMock.mockReset()
  matchesAnyRuleMock.mockReset()
  fetchEligibilityMock.mockReset()
  listActiveWatchRulesMock.mockReset()
  upsertMock.mockReset()
  getCompanyProfileMock.mockReset()
  getOpsJobTogglesMock.mockReset()
  setOpsJobTogglesMock.mockReset()
  sicapBlockedStatusMock.mockReset()
  listCheckedMock.mockReset()
  sicapBlockedStatusMock.mockReturnValue(null)
  listCheckedMock.mockResolvedValue(new Set())
  listActiveWatchRulesMock.mockResolvedValue([ruleQA])
  matchesAnyRuleMock.mockReturnValue(false)
  fetchEligibilityMock.mockResolvedValue(null)
  getCompanyProfileMock.mockResolvedValue({ annualTurnoverRon: '10000' })
  getOpsJobTogglesMock.mockResolvedValue({ bankSync: true, tenderWatch: true, bnrFeed: true })
  upsertMock.mockResolvedValue({ inserted: 0, updated: 0, rows: [] })
  await cleanupAllAlerts()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupAllAlerts()
})

describe('runTenderWatchSyncJob', () => {
  it('oprește monitorul din Setări și ridică alertă critică dacă SICAP a răspuns cu 403', async () => {
    fetchDaMock.mockRejectedValue(new Error('SICAP a răspuns cu HTTP 403'))
    fetchCNoticeMock.mockResolvedValue([rowNotice])
    matchMock.mockReturnValue('rule-qa')
    sicapBlockedStatusMock.mockReturnValue(403)

    await runTenderWatchSyncJob()

    expect(setOpsJobTogglesMock).toHaveBeenCalledWith({ tenderWatch: false })
    expect(fetchEligibilityMock).not.toHaveBeenCalled()
    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, BLOCKED_RULE_KEY))
    const raised = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(raised[0]?.severity).toBe('critical')
  })

  it('nu mai cere Secțiunea 3 pt. licitațiile care au deja eligibilitatea salvată', async () => {
    fetchDaMock.mockResolvedValue([])
    fetchCNoticeMock.mockResolvedValue([rowNotice])
    matchMock.mockReturnValue('rule-qa')
    listCheckedMock.mockResolvedValue(new Set(['CN-1']))

    await runTenderWatchSyncJob()

    expect(fetchEligibilityMock).not.toHaveBeenCalled()
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(setOpsJobTogglesMock).not.toHaveBeenCalled()
  })

  it('sare peste rulare dacă nu există reguli active', async () => {
    listActiveWatchRulesMock.mockResolvedValue([])

    await runTenderWatchSyncJob()

    expect(fetchDaMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('combină ambele surse, filtrează pe match și trimite doar rândurile potrivite la upsert', async () => {
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([rowNotice])
    matchMock.mockImplementation((row: { externalId: string }) => (row.externalId === 'DA-1' ? 'rule-qa' : null))

    await runTenderWatchSyncJob()

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [sentRows] = upsertMock.mock.calls[0]!
    expect(sentRows).toHaveLength(1)
    expect(sentRows[0]).toMatchObject({ externalId: 'DA-1', matchedRuleId: 'rule-qa', isPriority: false })
  })

  it('marchează isPriority=true pt. potrivirile pe o regulă de prioritate înaltă', async () => {
    listActiveWatchRulesMock.mockResolvedValue([ruleQA, rulePriority])
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([])
    matchMock.mockReturnValue('rule-priority')

    await runTenderWatchSyncJob()

    const [sentRows] = upsertMock.mock.calls[0]!
    expect(sentRows[0]).toMatchObject({ matchedRuleId: 'rule-priority', isPriority: true })
  })

  it('izolează eșecul unei surse — cealaltă tot se procesează, fără să arunce', async () => {
    fetchDaMock.mockRejectedValue(new Error('SICAP jos'))
    fetchCNoticeMock.mockResolvedValue([rowNotice])
    matchMock.mockReturnValue('rule-qa')

    await expect(runTenderWatchSyncJob()).resolves.toBeUndefined()

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [sentRows] = upsertMock.mock.calls[0]!
    expect(sentRows).toHaveLength(1)
    expect(sentRows[0]).toMatchObject({ externalId: 'CN-1' })

    const [rule] = await db.select().from(alertRules).where(and(eq(alertRules.metricKey, DA_RULE_KEY), isNull(alertRules.deletedAt)))
    expect(rule).toBeDefined()
    const raised = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(raised).toHaveLength(1)
    expect(raised[0]?.message).toContain('achiziții directe')
  })

  it('nu aruncă dacă AMBELE surse pică — job-ul se termină curat, fără upsert', async () => {
    fetchDaMock.mockRejectedValue(new Error('SICAP jos'))
    fetchCNoticeMock.mockRejectedValue(new Error('SICAP jos'))

    await expect(runTenderWatchSyncJob()).resolves.toBeUndefined()

    expect(upsertMock).not.toHaveBeenCalled()
    const [daRule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, DA_RULE_KEY))
    const [cnRule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, CNOTICE_RULE_KEY))
    expect(daRule).toBeDefined()
    expect(cnRule).toBeDefined()
  })

  it('ridică alertă info doar pt. rândurile CHIAR NOI (inserted), nu pt. cele doar actualizate', async () => {
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([])
    matchMock.mockReturnValue('rule-qa')
    upsertMock.mockResolvedValue({
      inserted: 1,
      updated: 0,
      rows: [{ id: 'opp-1', externalId: 'DA-1', title: 'DA item', isPriority: false, detailUrl: 'https://x', inserted: true }],
    })

    await runTenderWatchSyncJob()

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, NEW_OPP_RULE_KEY))
    expect(rule).toBeDefined()
    const raised = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(raised).toHaveLength(1)
    expect(raised[0]?.severity).toBe('info')
  })

  it('nu ridică alertă de oportunități noi când toate rândurile sunt doar actualizate', async () => {
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([])
    matchMock.mockReturnValue('rule-qa')
    upsertMock.mockResolvedValue({
      inserted: 0,
      updated: 1,
      rows: [{ id: 'opp-1', externalId: 'DA-1', title: 'DA item', isPriority: false, detailUrl: 'https://x', inserted: false }],
    })

    await runTenderWatchSyncJob()

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, NEW_OPP_RULE_KEY))
    expect(rule).toBeUndefined()
  })

  it('ridică alertă CRITICĂ separată pt. potriviri noi pe reguli de prioritate înaltă, cu titlul în mesaj', async () => {
    listActiveWatchRulesMock.mockResolvedValue([rulePriority])
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([])
    matchMock.mockReturnValue('rule-priority')
    upsertMock.mockResolvedValue({
      inserted: 1,
      updated: 0,
      rows: [{ id: 'opp-1', externalId: 'DA-1', title: 'Licitație super importantă', isPriority: true, detailUrl: 'https://x', inserted: true }],
    })

    await runTenderWatchSyncJob()

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, NEW_PRIORITY_RULE_KEY))
    expect(rule).toBeDefined()
    const raised = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(raised).toHaveLength(1)
    expect(raised[0]?.severity).toBe('critical')
    expect(raised[0]?.message).toContain('Licitație super importantă')
  })

  it('nu ridică alertă critică pt. potriviri noi pe reguli fără prioritate înaltă', async () => {
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([])
    matchMock.mockReturnValue('rule-qa')
    upsertMock.mockResolvedValue({
      inserted: 1,
      updated: 0,
      rows: [{ id: 'opp-1', externalId: 'DA-1', title: 'DA item', isPriority: false, detailUrl: 'https://x', inserted: true }],
    })

    await runTenderWatchSyncJob()

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, NEW_PRIORITY_RULE_KEY))
    expect(rule).toBeUndefined()
  })

  it('nu ridică alertă critică pt. rânduri de prioritate înaltă doar actualizate (nu inserted)', async () => {
    listActiveWatchRulesMock.mockResolvedValue([rulePriority])
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([])
    matchMock.mockReturnValue('rule-priority')
    upsertMock.mockResolvedValue({
      inserted: 0,
      updated: 1,
      rows: [{ id: 'opp-1', externalId: 'DA-1', title: 'Licitație super importantă', isPriority: true, detailUrl: 'https://x', inserted: false }],
    })

    await runTenderWatchSyncJob()

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, NEW_PRIORITY_RULE_KEY))
    expect(rule).toBeUndefined()
  })

  it('marchează excludedByRule=true pt. rândurile care potrivesc și o regulă de excludere', async () => {
    listActiveWatchRulesMock.mockResolvedValue([ruleQA, ruleExclude])
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([])
    matchMock.mockReturnValue('rule-qa')
    matchesAnyRuleMock.mockReturnValue(true)

    await runTenderWatchSyncJob()

    // matchWatchRule trebuie apelat DOAR cu regulile de urmărire (fără cea de excludere)
    expect(matchMock).toHaveBeenCalledWith(rowDa, [ruleQA])
    expect(matchesAnyRuleMock).toHaveBeenCalledWith(rowDa, [ruleExclude])
    const [sentRows] = upsertMock.mock.calls[0]!
    expect(sentRows[0]).toMatchObject({ matchedRuleId: 'rule-qa', excludedByRule: true })
  })

  it('sare peste rulare dacă există doar reguli de excludere, fără nicio regulă de urmărire activă', async () => {
    listActiveWatchRulesMock.mockResolvedValue([ruleExclude])

    await runTenderWatchSyncJob()

    expect(fetchDaMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('nu ridică alertă de oportunități noi pt. rândurile auto-arhivate pe regulă de excludere', async () => {
    fetchDaMock.mockResolvedValue([rowDa])
    fetchCNoticeMock.mockResolvedValue([])
    matchMock.mockReturnValue('rule-qa')
    upsertMock.mockResolvedValue({
      inserted: 1,
      updated: 0,
      rows: [{ id: 'opp-1', externalId: 'DA-1', title: 'DA item', isPriority: false, detailUrl: 'https://x', inserted: true, dismissedAt: new Date() }],
    })

    await runTenderWatchSyncJob()

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, NEW_OPP_RULE_KEY))
    expect(rule).toBeUndefined()
  })

  it('marchează ineligibleByTurnover=true când Secțiunea 3 cere o cifră de afaceri peste prag', async () => {
    fetchDaMock.mockResolvedValue([])
    fetchCNoticeMock.mockResolvedValue([rowNotice])
    matchMock.mockReturnValue('rule-qa')
    fetchEligibilityMock.mockResolvedValue({ minTurnoverRon: 2_700_000, eligibilityNote: 'CA min 2.700.000 lei' })

    await runTenderWatchSyncJob()

    expect(fetchEligibilityMock).toHaveBeenCalledWith(rowNotice)
    const [sentRows] = upsertMock.mock.calls[0]!
    expect(sentRows[0]).toMatchObject({ minTurnoverRon: 2_700_000, eligibilityNote: 'CA min 2.700.000 lei', ineligibleByTurnover: true })
  })

  it('ineligibleByTurnover=false când cifra cerută e sub prag', async () => {
    fetchDaMock.mockResolvedValue([])
    fetchCNoticeMock.mockResolvedValue([rowNotice])
    matchMock.mockReturnValue('rule-qa')
    fetchEligibilityMock.mockResolvedValue({ minTurnoverRon: 5_000, eligibilityNote: 'CA min 5.000 lei' })

    await runTenderWatchSyncJob()

    const [sentRows] = upsertMock.mock.calls[0]!
    expect(sentRows[0]).toMatchObject({ ineligibleByTurnover: false })
  })

  it('un eșec la verificarea eligibilității nu oprește sincronizarea — rândul rămâne needeterminat', async () => {
    fetchDaMock.mockResolvedValue([])
    fetchCNoticeMock.mockResolvedValue([rowNotice])
    matchMock.mockReturnValue('rule-qa')
    fetchEligibilityMock.mockRejectedValue(new Error('SICAP jos'))

    await expect(runTenderWatchSyncJob()).resolves.toBeUndefined()

    const [sentRows] = upsertMock.mock.calls[0]!
    expect(sentRows[0]).toMatchObject({ minTurnoverRon: null, eligibilityNote: null, ineligibleByTurnover: false })
  })

  it('fără cifră de afaceri validă setată în Date firmă, nu marchează nimic ineligibil (fail open)', async () => {
    fetchDaMock.mockResolvedValue([])
    fetchCNoticeMock.mockResolvedValue([rowNotice])
    matchMock.mockReturnValue('rule-qa')
    fetchEligibilityMock.mockResolvedValue({ minTurnoverRon: 2_700_000, eligibilityNote: 'CA min 2.700.000 lei' })
    getCompanyProfileMock.mockResolvedValue({ annualTurnoverRon: '' })

    await runTenderWatchSyncJob()

    const [sentRows] = upsertMock.mock.calls[0]!
    expect(sentRows[0]).toMatchObject({ minTurnoverRon: 2_700_000, ineligibleByTurnover: false })
  })
})
