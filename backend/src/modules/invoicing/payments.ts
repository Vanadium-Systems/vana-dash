import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { db } from '../../shared/db/client.js'
import { financialRecords } from '../../shared/db/schema/index.js'
import { afterInvoiceSettledByHand } from '../../shared/lib/invoice-settled.js'
import { addPayment, PaymentError, removePayment } from '../../shared/lib/payments.js'
import { IdParamsSchema, PaymentCreateSchema, PaymentParamsSchema } from './schema.js'
import { tr } from '../../shared/lib/i18n.js'

// The same four operations under two prefixes: Emise works on /api/invoicing/invoices, the
// received-documents list and the document page on /api/accounting/records.

type PaymentBody = typeof PaymentCreateSchema._output

async function loadRecord(recordId: string, direction?: 'out') {
  const [record] = await db
    .select({ direction: financialRecords.direction, billingClientId: financialRecords.billingClientId, issuedAt: financialRecords.issuedAt })
    .from(financialRecords)
    .where(and(eq(financialRecords.id, recordId), isNull(financialRecords.deletedAt)))
  if (!record || (direction && record.direction !== direction)) {
    throw new PaymentError(404, 'RECORD_NOT_FOUND', tr('errors.payments.recordNotFound'))
  }
  return record
}

async function createPayment(recordId: string, body: PaymentBody, direction?: 'out') {
  const record = await loadRecord(recordId, direction)
  const payment = await addPayment(recordId, body)
  if (payment.becamePaid && record.direction === 'out') {
    await afterInvoiceSettledByHand({ id: recordId, billingClientId: record.billingClientId, issuedAt: record.issuedAt })
  }
  return payment
}

async function deletePayment(recordId: string, paymentId: string, direction?: 'out') {
  await loadRecord(recordId, direction)
  return removePayment(paymentId, { recordId })
}

function sendPaymentError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof PaymentError)) throw err
  return reply.code(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } })
}

export async function paymentRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  const prefixes = [
    { prefix: '/api/invoicing/invoices', direction: 'out' as const },
    { prefix: '/api/accounting/records', direction: undefined },
  ]
  for (const { prefix, direction } of prefixes) {
    server.post(
      `${prefix}/:id/payments`,
      { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: PaymentCreateSchema } },
      async (req, reply) => {
        try {
          return reply.code(201).send({ success: true, data: await createPayment(req.params.id, req.body, direction) })
        } catch (err) {
          return sendPaymentError(reply, err)
        }
      },
    )

    server.delete(
      `${prefix}/:id/payments/:pid`,
      { preHandler: [app.authenticate], schema: { params: PaymentParamsSchema } },
      async (req, reply) => {
        try {
          return { success: true, data: await deletePayment(req.params.id, req.params.pid, direction) }
        } catch (err) {
          return sendPaymentError(reply, err)
        }
      },
    )
  }
}
