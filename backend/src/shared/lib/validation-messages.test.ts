import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validationMessage } from './validation-messages.js'

const Body = z.object({
  name: z.string(),
  email: z.string().email(),
  code: z.string().min(3),
  kind: z.enum(['a', 'b']),
  id: z.string().uuid(),
})

describe('validationMessage', () => {
  it('describes every Zod 4 issue in the language of the request, field by field', () => {
    const issues = Body.safeParse({ email: 'no', code: 'ab', kind: 'c', id: 'x' }).error!.issues
    expect(validationMessage(issues)).toBe(
      'name: câmp obligatoriu; email: adresă de email nevalidă; code: cel puțin 3 caractere; ' +
        'kind: valoare în afara listei: a, b; id: identificator nevalid',
    )
  })
})
