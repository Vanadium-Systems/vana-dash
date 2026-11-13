import { maybeExtendSubscription } from '../../modules/reconciliation/vanagreen-extension.js'
import { rollBillingDueDateOnPayment } from './billing-rollover.js'
import { sendPaymentConfirmationEmail } from './payment-confirmation.js'

/**
 * What follows an issued invoice becoming paid by a payment recorded by hand: the client's next
 * due date, the VanaGreen subscription extension and the confirmation email, as the manual
 * mark-paid does. The payment is already committed, so a failure here is logged, never thrown.
 * The extension key is the one mark-paid uses, so settling the same invoice both ways extends once.
 */
export async function afterInvoiceSettledByHand(invoice: { id: string; billingClientId: string | null; issuedAt: Date }): Promise<void> {
  if (invoice.billingClientId) {
    try {
      await rollBillingDueDateOnPayment(invoice.billingClientId, invoice.issuedAt)
    } catch (err) {
      console.error(`[payments] billing due date roll failed for client ${invoice.billingClientId}:`, err)
    }
  }
  try {
    await maybeExtendSubscription({ billingClientId: invoice.billingClientId, source: 'mark_paid', sourceId: `mark-paid:${invoice.id}` })
  } catch (err) {
    console.error(`[payments] vanagreen extension failed for invoice ${invoice.id}:`, err)
  }
  void sendPaymentConfirmationEmail(invoice.id).catch((err) => console.error(`[payments] payment confirmation failed for ${invoice.id}:`, err))
}
