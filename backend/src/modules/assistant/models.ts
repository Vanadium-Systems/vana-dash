// Modele disponibile în dropdown-ul de pe pagina Asistent. Listă mică, hardcodată — nu un
// registry generic, doar cele 3 modele de chat relevante (Fable e model de creative writing,
// nu se pretează la un agent cu tool use). `null` (implicit) = config.anthropic.model din env.
export const ASSISTANT_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — rapid, ieftin' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — echilibrat' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 — cel mai capabil' },
] as const

export type AssistantModelId = (typeof ASSISTANT_MODELS)[number]['id']

export function isValidAssistantModel(value: string): value is AssistantModelId {
  return ASSISTANT_MODELS.some((m) => m.id === value)
}
