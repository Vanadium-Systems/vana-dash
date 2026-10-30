import { describe, expect, it } from 'vitest'
import type { SessionUser } from '../../shared/lib/session.js'
import { localSystemPrompt, systemPrompt, SYSTEM_PROMPT_TEMPLATE } from './system-prompt.js'

const person = (locale: 'ro' | 'en') => ({ displayName: 'Ana', email: 'ana@example.com', locale }) as SessionUser

describe('systemPrompt', () => {
  it('is unchanged for a person who uses the app in Romanian', () => {
    expect(systemPrompt(person('ro'), 'Acme SRL')).toBe(SYSTEM_PROMPT_TEMPLATE.replaceAll('{{nume}}', 'Ana').replaceAll('{{firma}}', 'Acme SRL'))
  })

  it('tells the model to answer in English for a person who uses the app in English', () => {
    const prompt = systemPrompt(person('en'), 'Acme SRL')
    expect(prompt).toContain('Răspunde-i în engleză')
    expect(prompt).toContain('Invoices')
    expect(prompt).not.toContain('{{nume}}')
  })
})

describe('localSystemPrompt', () => {
  it('names the person and says there is no access to the app data', () => {
    const prompt = localSystemPrompt(person('ro'), 'Acme SRL')
    expect(prompt).toContain('Ana')
    expect(prompt).not.toContain('{{nume}}')
    expect(prompt).toContain('Nu ai acces la datele din aplicație')
    expect(prompt.length).toBeLessThan(800)
  })
})
