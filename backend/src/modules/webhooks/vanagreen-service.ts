import { ensureAlertRule, raiseAlert } from '../../shared/lib/alerting.js'
import type { VanagreenAlertIngestBody } from './vanagreen-schema.js'
import { tr } from '../../shared/lib/i18n.js'

const SOURCE_LABEL: Record<VanagreenAlertIngestBody['source'], string> = {
  anaf_rejected: tr('alerts.vanagreen.anafRejected'),
  send_error: tr('alerts.vanagreen.technicalError'),
}

/**
 * Dedup pe (tenant, factură, sursă) — nu pe mesajul exact: un retry pe aceeași factură
 * respinsă nu trebuie să deschidă o alertă nouă cât timp cea veche e neconfirmată, chiar
 * dacă ANAF reformulează ușor eroarea între încercări.
 */
export async function handleVanagreenAlert(body: VanagreenAlertIngestBody): Promise<void> {
  const ruleKey = `vanagreen.efactura.${body.tenant_id}.${body.invoice_id}.${body.source}`
  const ruleId = await ensureAlertRule(ruleKey, `vanagreen e-Factura — ${body.tenant_name}`.slice(0, 255))

  const invoiceRef = body.invoice_number ?? tr('alerts.vanagreen.draft')
  const message = `[vanagreen] ${SOURCE_LABEL[body.source]} — ${body.tenant_name}, factura ${invoiceRef}: ${body.error_message}`

  const emailBody = [
    message,
    '',
    `Tenant: ${body.tenant_name} (${body.tenant_id})`,
    tr('alerts.vanagreen.invoice', { invoiceRef, invoice_id: body.invoice_id }),
    body.company_name
      ? body.company_cui
        ? tr('alerts.vanagreen.buyerWithCui', { name: body.company_name, cui: body.company_cui })
        : tr('alerts.vanagreen.buyer', { name: body.company_name })
      : null,
    body.error_code ? tr('alerts.vanagreen.errorCode', { error_code: body.error_code }) : null,
    tr('alerts.vanagreen.fullError', { error_message: body.error_message }),
    tr('alerts.vanagreen.open', { url: body.url }),
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  await raiseAlert(ruleId, message, { emailBody, url: body.url })
}
