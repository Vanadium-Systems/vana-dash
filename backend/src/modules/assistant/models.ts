import { tr } from '../../shared/lib/i18n.js'
// Labels are getters: the list is built once, but each request reads them in its own language.
// Modele disponibile în dropdown-ul de pe pagina Asistent. Listă mică, hardcodată — nu un
// registry generic, doar cele 3 modele de chat relevante (Fable e model de creative writing,
// nu se pretează la un agent cu tool use). `null` (implicit) = config.anthropic.model din env.
export const ASSISTANT_MODELS = [
  { id: 'claude-haiku-4-5-20251001', get label() { return tr('errors.assistant.models.haiku') } },
  { id: 'claude-sonnet-5', get label() { return tr('errors.assistant.models.sonnet') } },
  { id: 'claude-opus-4-8', get label() { return tr('errors.assistant.models.opus') } },
] as const

export type AssistantModelId = (typeof ASSISTANT_MODELS)[number]['id']

export function isValidAssistantModel(value: string): value is AssistantModelId {
  return ASSISTANT_MODELS.some((m) => m.id === value)
}
