import { describe, expect, it } from 'vitest'
import type { SessionUser } from '../../shared/lib/session.js'
import { systemPrompt, SYSTEM_PROMPT_TEMPLATE } from './system-prompt.js'

const person = (locale: 'ro' | 'en') => ({ displayName: 'Ana', email: 'ana@example.com', locale }) as SessionUser

describe('systemPrompt', () => {
  it('is unchanged for a person who uses the app in Romanian', () => {
    expect(systemPrompt(person('ro'))).toBe(SYSTEM_PROMPT_TEMPLATE.replaceAll('{{nume}}', 'Ana'))
  })

  it('tells the model to answer in English for a person who uses the app in English', () => {
    const prompt = systemPrompt(person('en'))
    expect(prompt).toContain('Răspunde-i în engleză')
    expect(prompt).toContain('Invoices')
    expect(prompt).not.toContain('{{nume}}')
  })
})
