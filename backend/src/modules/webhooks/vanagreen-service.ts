import { ensureAlertRule, raiseAlert } from '../../shared/lib/alerting.js'
import type { VanagreenAlertIngestBody } from './vanagreen-schema.js'

const SOURCE_LABEL: Record<VanagreenAlertIngestBody['source'], string> = {
  anaf_rejected: 'ANAF a respins factura',
  send_error: 'Eroare tehnică la trimitere',
}

/**
 * Dedup pe (tenant, factură, sursă) — nu pe mesajul exact: un retry pe aceeași factură
 * respinsă nu trebuie să deschidă o alertă nouă cât timp cea veche e neconfirmată, chiar
 * dacă ANAF reformulează ușor eroarea între încercări.
 */
export async function handleVanagreenAlert(body: VanagreenAlertIngestBody): Promise<void> {
  const ruleKey = `vanagreen.efactura.${body.tenant_id}.${body.invoice_id}.${body.source}`
  const ruleId = await ensureAlertRule(ruleKey, `vanagreen e-Factura — ${body.tenant_name}`.slice(0, 255))

  const invoiceRef = body.invoice_number ?? 'ciornă'
  const message = `[vanagreen] ${SOURCE_LABEL[body.source]} — ${body.tenant_name}, factura ${invoiceRef}: ${body.error_message}`

  const emailBody = [
    message,
    '',
    `Tenant: ${body.tenant_name} (${body.tenant_id})`,
    `Factură: ${invoiceRef} (${body.invoice_id})`,
    body.company_name ? `Cumpărător: ${body.company_name}${body.company_cui ? ` — CUI ${body.company_cui}` : ''}` : null,
    body.error_code ? `Cod eroare: ${body.error_code}` : null,
    `Eroare completă: ${body.error_message}`,
    `Deschide în vanagreen: ${body.url}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  await raiseAlert(ruleId, message, { emailBody, url: body.url })
}
