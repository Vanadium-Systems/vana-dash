import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'

// Setări modul Email — mutate din .env în dashboard_config (editabile din UI, PLAN.md decizie
// fixată). Valorile din .env (config.email*) rămân fallback dacă nu există încă rând în DB.

// Identitate de trimitere — `key` e referențiat de Compose/bulk/secvențe (stabil, nu se
// redenumește ușor), label afișat în dropdown-uri. `fromAddress` gol = identitate încă
// neconfigurată (fail-soft la trimitere pe contact, ca outreach-ul azi).
export const EmailIdentitySchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_-]+$/, lazyTr('errors.email.identityKeyFormat')),
  label: z.string().trim().min(1).max(100),
  // Formatul Resend: `Vanadium Systems <sales@vanadium.systems>` sau adresa simplă. Validarea
  // doar pe adresă respingea tot formatul cu nume, deci și identitățile implicite.
  fromAddress: z.union([
    z.literal(''),
    z.string().trim().email(),
    z.string().trim().refine((value) => {
      const match = /^[^<>]+<([^<>]+)>$/.exec(value)
      return z.string().email().safeParse(match?.[1]?.trim()).success
    }, lazyTr('errors.email.addressFormat')),
  ]),
})

export const EmailSettingsUpdateSchema = z.object({
  // Semnătură per identitate de trimitere (2026-09-30): cheie = `identityKey`, valoare = HTML
  // (sau șir gol = fără semnătură). Cheia e validată ca `identityKey`, ca un rând nou să nu
  // poată ajunge o cheie care nu e identitate.
  signatures: z
    .record(z.string().regex(/^[a-z0-9_-]+$/, lazyTr('errors.email.signatureKeyFormat')), z.string().max(2000))
    .optional(),
  autoSpamEnabled: z.boolean().optional(),
  spamThreshold: z.number().int().min(1).max(20).optional(),
  spamKeywords: z.array(z.string().min(1).max(200)).max(200).optional(),
  outreachDailyCap: z.number().int().min(1).max(1000).optional(),
  outreachSendHour: z.number().int().min(0).max(23).optional(),
  outreachSendWeekdaysOnly: z.boolean().optional(),
  identities: z.array(EmailIdentitySchema).min(1).max(10).optional(),
  // Imagini externe încărcate automat la deschiderea mailului (default OFF — pattern Gmail:
  // fără confirmare tăcută către expeditor). ON = fără butonul "Arată imaginile".
  autoLoadImages: z.boolean().optional(),
})

export const LogoUploadSchema = z.object({
  filename: z.string().min(1),
  // base64 — același pattern ca atașamentele de email. ~7.5MB decodat, generos pt. un logo.
  content: z.string().min(1).max(10_000_000),
})
