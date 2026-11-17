export class InvoicingError extends Error {
  readonly userFacing = true
  constructor(
    readonly statusCode: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
