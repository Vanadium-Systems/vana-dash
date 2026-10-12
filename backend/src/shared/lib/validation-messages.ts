import { resolveLazy, tr } from './i18n.js'

// What a person reads when a request fails validation, in the language of the request.
// Zod writes its default messages in English at module load; here the issue is described again
// from its code. A message written in a schema (`lazyTr`) wins.

export interface ValidationIssue {
  code: string
  path: (string | number)[]
  message: string
  received?: unknown
  type?: string
  validation?: unknown
  minimum?: number | bigint
  maximum?: number | bigint
  options?: unknown[]
}

function describe(issue: ValidationIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null' ? tr('validation.required') : tr('validation.invalidType')
    case 'invalid_string':
      if (issue.validation === 'email') return tr('validation.invalidEmail')
      if (issue.validation === 'url') return tr('validation.invalidUrl')
      if (issue.validation === 'uuid') return tr('validation.invalidUuid')
      if (issue.validation === 'datetime' || issue.validation === 'date') return tr('validation.invalidDate')
      return tr('validation.invalidValue')
    case 'invalid_date':
      return tr('validation.invalidDate')
    case 'too_small':
      if (issue.type === 'string') return Number(issue.minimum) === 1 ? tr('validation.required') : tr('validation.stringTooShort', { count: Number(issue.minimum) })
      if (issue.type === 'array') return tr('validation.arrayTooShort', { count: Number(issue.minimum) })
      return tr('validation.numberTooSmall', { min: Number(issue.minimum) })
    case 'too_big':
      if (issue.type === 'string') return tr('validation.stringTooLong', { count: Number(issue.maximum) })
      if (issue.type === 'array') return tr('validation.arrayTooLong', { count: Number(issue.maximum) })
      return tr('validation.numberTooBig', { max: Number(issue.maximum) })
    case 'invalid_enum_value':
      return tr('validation.invalidOption', { options: (issue.options ?? []).join(', ') })
    default:
      return issue.message
  }
}

/** One line for the whole failed request: `field: what is wrong; other.field: …`. */
export function validationMessage(issues: ValidationIssue[]): string {
  return issues
    .map((issue) => {
      // `custom` is a schema's own refine; a regex message is also written by the schema.
      const own = issue.code === 'custom' || (issue.code === 'invalid_string' && issue.validation === 'regex')
      const text = own || issue.message.startsWith('tr:') ? resolveLazy(issue.message) : describe(issue)
      return issue.path.length ? `${issue.path.join('.')}: ${text}` : text
    })
    .join('; ')
}
