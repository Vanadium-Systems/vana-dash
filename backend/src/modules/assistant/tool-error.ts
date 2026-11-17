import { errorMessage, HttpError } from '../../shared/lib/http-error.js'
import { PaymentError } from '../../shared/lib/payments.js'
import { InvoicingError } from '../invoicing/errors.js'

/** A tool failure whose text is already safe for the model and the person. */
export class ToolError extends Error {}

/**
 * The text of a tool failure that reaches the model (and through it the person). Errors of
 * ours carry a translated message; anything else (DB, network) is logged and replaced.
 */
export function toolFailureText(err: unknown): string {
  if (err instanceof HttpError) return errorMessage(err.code, err.params, err.statusCode)
  if (err instanceof ToolError || err instanceof PaymentError || err instanceof InvoicingError) return err.message
  console.error('[assistant] tool failed', err)
  return errorMessage('INTERNAL')
}
