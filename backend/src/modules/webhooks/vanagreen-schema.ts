import { z } from 'zod'

/**
 * Payload trimis de vanagreen (shared/lib/vanadash-alert.ts) când un tenant primește o eroare
 * la trimiterea unei facturi prin e-Factura care NU e vina clientului (CUI cumpărător greșit,
 * adresă/sector nerecunoscut, firmă radiată — acelea sunt filtrate acolo, nu ajung aici).
 * Bogat în detalii deliberat — spre deosebire de emailul sărac trimis de Sentry, ăsta e intern,
 * controlăm ambele capete, deci trimitem tot ce ar ajuta la diagnosticat fără să mai sape Stefan
 * prin loguri.
 */
export const VanagreenAlertIngestSchema = z
  .object({
    source: z.enum(['anaf_rejected', 'send_error']),
    tenant_id: z.string().min(1),
    tenant_name: z.string().min(1),
    invoice_id: z.string().min(1),
    invoice_number: z.string().nullable(),
    company_name: z.string().nullable(),
    company_cui: z.string().nullable(),
    error_code: z.string().nullable(),
    error_message: z.string().min(1),
    url: z.string().min(1),
  })
  .strict()

export type VanagreenAlertIngestBody = z.infer<typeof VanagreenAlertIngestSchema>
