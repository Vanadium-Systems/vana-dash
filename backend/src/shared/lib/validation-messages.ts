import { resolveLazy, tr } from './i18n.js'

// What a person reads when a request fails validation, in the language of the request.
// Zod writes its default messages in English at module load; here the issue is described again
// from its code. A message written in a schema (`lazyTr`) wins.

export interface ValidationIssue {
  code: string
  path: PropertyKey[]
  message: string
  expected?: string
  format?: string
  origin?: string
  minimum?: number | bigint
  maximum?: number | bigint
  values?: unknown[]
}

function describe(issue: ValidationIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      // Zod 4 leaves the input out of the issue; only its default message says what arrived.
      if (/received (undefined|null)$/.test(issue.message)) return tr('validation.required')
      return issue.expected === 'date' ? tr('validation.invalidDate') : tr('validation.invalidType')
    case 'invalid_format':
      if (issue.format === 'email') return tr('validation.invalidEmail')
      if (issue.format === 'url') return tr('validation.invalidUrl')
      if (issue.format === 'uuid') return tr('validation.invalidUuid')
      if (issue.format === 'datetime' || issue.format === 'date') return tr('validation.invalidDate')
      return tr('validation.invalidValue')
    case 'too_small':
      if (issue.origin === 'string') return Number(issue.minimum) === 1 ? tr('validation.required') : tr('validation.stringTooShort', { count: Number(issue.minimum) })
      if (issue.origin === 'array') return tr('validation.arrayTooShort', { count: Number(issue.minimum) })
      return tr('validation.numberTooSmall', { min: Number(issue.minimum) })
    case 'too_big':
      if (issue.origin === 'string') return tr('validation.stringTooLong', { count: Number(issue.maximum) })
      if (issue.origin === 'array') return tr('validation.arrayTooLong', { count: Number(issue.maximum) })
      return tr('validation.numberTooBig', { max: Number(issue.maximum) })
    case 'invalid_value':
      return tr('validation.invalidOption', { options: (issue.values ?? []).join(', ') })
    default:
      return issue.message
  }
}

/** One line for the whole failed request: `field: what is wrong; other.field: …`. */
export function validationMessage(issues: ValidationIssue[]): string {
  return issues
    .map((issue) => {
      // `custom` is a schema's own refine; a regex message is also written by the schema.
      const own = issue.code === 'custom' || (issue.code === 'invalid_format' && issue.format === 'regex')
      const text = own || issue.message.startsWith('tr:') ? resolveLazy(issue.message) : describe(issue)
      return issue.path.length ? `${issue.path.map(String).join('.')}: ${text}` : text
    })
    .join('; ')
}
