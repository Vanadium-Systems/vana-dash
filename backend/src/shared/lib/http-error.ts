import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import { trFor, type TrKey, type TrParams } from './i18n.js'
import type { Locale } from './locale.js'
import { currentLocale } from './request-context.js'
import { validationMessage } from './validation-messages.js'

// Every error response of the API: `{ success: false, error: { code, message, ...details } }`.
// `code` is stable (clients decide on it), `message` comes from `errors.codes.<CODE>` in the
// language of the request. Text from an exception never goes to the client: it stays in the log.

export type ErrorParams = TrParams
export type ErrorDetails = Record<string, unknown>

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly params: ErrorParams = {},
    readonly details: ErrorDetails = {},
  ) {
    super(code)
    this.name = 'HttpError'
  }

  /** Keeps the technical reason for the log and `sync_log`; the answer still has only the code. */
  causedBy(cause: unknown): this {
    this.cause = cause
    this.message = `${this.code}: ${cause instanceof Error ? cause.message : String(cause)}`
    return this
  }
}

export function httpError(statusCode: number, code: string, params?: ErrorParams, details?: ErrorDetails): HttpError {
  return new HttpError(statusCode, code, params, details)
}

/** The code the global handler gives a status when nothing more precise is known. */
export function genericCode(statusCode: number): string {
  if (statusCode >= 500) return 'INTERNAL'
  switch (statusCode) {
    case 401:
      return 'UNAUTHORIZED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 409:
      return 'CONFLICT'
    case 413:
      return 'PAYLOAD_TOO_LARGE'
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE'
    case 429:
      return 'RATE_LIMITED'
    default:
      return 'BAD_REQUEST'
  }
}

export function hasErrorText(code: string, locale: Locale = currentLocale()): boolean {
  const key = `errors.codes.${code}`
  return trFor(locale, key as TrKey) !== key
}

/** The text of a code; a code without text of its own falls back on the generic one of its status. */
export function errorMessage(code: string, params?: ErrorParams, statusCode = 400): string {
  const locale = currentLocale()
  const key = `errors.codes.${hasErrorText(code, locale) ? code : genericCode(statusCode)}`
  return trFor(locale, key as TrKey, params)
}

export function errorBody(statusCode: number, code: string, opts: FailOptions = {}) {
  return {
    success: false as const,
    error: { ...opts.details, code, message: opts.message ?? errorMessage(code, opts.params, statusCode) },
  }
}

export interface FailOptions {
  /** Text already written for this case (`tr('errors.x.y')`); otherwise `errors.codes.<CODE>`. */
  message?: string
  params?: ErrorParams
  details?: ErrorDetails
}

/** For routes that answer directly instead of throwing. */
export function fail(reply: FastifyReply, statusCode: number, code: string, opts?: FailOptions) {
  return reply.code(statusCode).send(errorBody(statusCode, code, opts))
}

// The text of an exception never reaches the client: Fastify's own 4xx (broken JSON, body too
// large) get the generic text of their status, a 5xx is logged and answered with INTERNAL.
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) {
    if (error.statusCode >= 500) request.log.error(error)
    return reply.code(error.statusCode).send(errorBody(error.statusCode, error.code, { params: error.params, details: error.details }))
  }
  if (error.code === 'FST_ERR_VALIDATION' && error.validation?.length) {
    // Without this a Zod failure fell on Fastify's "Bad Request" and the reason (a field, a rule)
    // never reached the person.
    const message = hasZodFastifySchemaValidationErrors(error)
      ? validationMessage(
          error.validation.map(({ keyword, instancePath, message: text, params }) => ({
            ...params,
            code: keyword,
            path: instancePath.split('/').slice(1).filter(Boolean),
            message: text ?? '',
          })),
        )
      : undefined
    return reply.code(400).send(errorBody(400, 'VALIDATION_FAILED', { message }))
  }
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
  if (statusCode >= 500) {
    request.log.error(error)
    return reply.code(statusCode).send(errorBody(statusCode, 'INTERNAL'))
  }
  // A domain error of ours (a class with `statusCode`, its message written with tr()) keeps its
  // text until its route maps it to a code; anything from Fastify or a plugin does not.
  const ownError = !error.code?.startsWith('FST_') && Object.getPrototypeOf(error) !== Error.prototype && statusCode !== 429
  const code = ownError && /^[A-Z][A-Z0-9_]+$/.test(error.code ?? '') ? error.code : genericCode(statusCode)
  return reply.code(statusCode).send(errorBody(statusCode, code, ownError ? { message: error.message } : {}))
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send(errorBody(404, 'NOT_FOUND'))
}
