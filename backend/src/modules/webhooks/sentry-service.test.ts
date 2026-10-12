/**
 * extractIssue — extracție best-effort din ambele forme posibile de payload Sentry (Internal
 * Integration `data.issue.*` vs. Issue Alert webhook `data.event.*`), nevalidate live contra
 * unui Sentry real (vezi comentariul din sentry-service.ts). handleSentryIssueWebhook —
 * integration test (pg real) pt. dedup pe alert_rules/alerts.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { alertRules, alerts } from '../../shared/db/schema/index.js'
import { extractIssue, handleSentryIssueWebhook } from './sentry-service.js'

describe('extractIssue', () => {
  it('extrage din forma Internal Integration (data.issue)', () => {
    const payload = {
      action: 'created',
      data: {
        issue: {
          id: '134161529',
          title: 'TypeError: Invalid character in header content ["content-disposition"]',
          culprit: 'GET /api/documents/bundles/:id/download',
          level: 'error',
          permalink: 'https://vanadium-systems.sentry.io/issues/134161529/',
        },
      },
    }
    const result = extractIssue(payload)
    expect(result.dedupeKey).toBe('134161529')
    expect(result.title).toContain('Invalid character')
    expect(result.culprit).toContain('/download')
    expect(result.level).toBe('error')
    expect(result.permalink).toContain('134161529')
  })

  it('extrage din forma Issue Alert webhook (data.event, cu exception)', () => {
    const payload = {
      action: 'triggered',
      data: {
        event: {
          event_id: 'abc123',
          message: 'Invalid character in header content',
          culprit: 'sendStream',
          transaction: 'GET /api/documents/bundles/:id/download',
          level: 'error',
          web_url: 'https://vanadium-systems.sentry.io/issues/134161529/',
          exception: { values: [{ type: 'TypeError', value: 'Invalid character in header content' }] },
        },
      },
    }
    const result = extractIssue(payload)
    expect(result.dedupeKey).toBe('abc123')
    expect(result.exceptionSummary).toBe('TypeError: Invalid character in header content')
    expect(result.culprit).toBe('sendStream')
  })

  it('nu aruncă pe payload complet neașteptat — fallback pe dedup din hash', () => {
    const result = extractIssue({ some: 'random shape' })
    expect(result.title).toBe('Eroare Sentry fără titlu')
    expect(result.dedupeKey).toHaveLength(16)
  })

  it('dedupeKey e stabil pt. același payload fallback (hash determinist)', () => {
    const a = extractIssue({ foo: 'bar' })
    const b = extractIssue({ foo: 'bar' })
    expect(a.dedupeKey).toBe(b.dedupeKey)
  })
})

describe('handleSentryIssueWebhook — dedup pe alert_rules/alerts', () => {
  const ruleIds: string[] = []
  afterAll(async () => {
    if (ruleIds.length) {
      await db.delete(alerts).where(inArray(alerts.ruleId, ruleIds))
      await db.delete(alertRules).where(inArray(alertRules.id, ruleIds))
    }
  })

  it('creează o alertă nouă pt. un issue nou, nu re-emite la a doua livrare', async () => {
    const payload = {
      data: { issue: { id: `qa-${Date.now()}`, title: 'QA Sentry issue', culprit: 'qa culprit', level: 'error' } },
    }

    await handleSentryIssueWebhook(payload)
    await handleSentryIssueWebhook(payload)

    const [rule] = await db.select().from(alertRules).where(eq(alertRules.metricKey, `sentry.${(payload.data.issue as { id: string }).id}`))
    expect(rule).toBeTruthy()
    ruleIds.push(rule!.id)

    const raised = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(raised).toHaveLength(1)
    expect(raised[0]?.severity).toBe('critical')
    expect(raised[0]?.message).toContain('QA Sentry issue')
  })
})
