import './load-env.js'
import { isDisplayCurrency, isLocale, type DisplayCurrency, type Locale } from './lib/locale.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  masterEncryptionKey: required('MASTER_ENCRYPTION_KEY'),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5174',

  // What a new person, a visitor before login and every job start with. Each person can then
  // change both in My profile. An unknown value falls back instead of stopping the server.
  defaultLocale: (isLocale(process.env.DEFAULT_LOCALE) ? process.env.DEFAULT_LOCALE : 'ro') as Locale,
  defaultDisplayCurrency: (isDisplayCurrency(process.env.DEFAULT_DISPLAY_CURRENCY)
    ? process.env.DEFAULT_DISPLAY_CURRENCY
    : 'RON') as DisplayCurrency,

  // Fișiere generate/descărcate (XML e-Factura, PDF facturi). Relativ la cwd în dev,
  // volum Docker în prod.
  storageDir: process.env.STORAGE_DIR ?? './storage',

  // ANAF SPV / e-Factura. sandbox = api.anaf.ro/test (recomandat până la validarea
  // XML-urilor pe schematron), prod = api.anaf.ro/prod. Client ID/secret vin din
  // aplicația OAuth înregistrată de Stefan pe portalul ANAF — goale până atunci.
  anafEnv: (process.env.ANAF_ENV ?? 'sandbox') as 'sandbox' | 'prod',
  anafClientId: process.env.ANAF_CLIENT_ID ?? '',
  anafClientSecret: process.env.ANAF_CLIENT_SECRET ?? '',
  anafRedirectUri: process.env.ANAF_REDIRECT_URI ?? 'http://localhost:3001/api/accounting/anaf/callback',

  // Profilul firmei — apare pe facturile emise (PDF + XML UBL).
  company: {
    name: process.env.COMPANY_NAME ?? '',
    cif: process.env.COMPANY_CIF ?? '',
    regCom: process.env.COMPANY_REG_COM ?? '',
    address: process.env.COMPANY_ADDRESS ?? '',
    city: process.env.COMPANY_CITY ?? 'Bucuresti',
    // Cod județ CIUS-RO (ex: RO-B, RO-CJ) — obligatoriu în XML.
    countyCode: process.env.COMPANY_COUNTY_CODE ?? 'RO-B',
    iban: process.env.COMPANY_IBAN ?? '',
    bank: process.env.COMPANY_BANK ?? '',
    email: process.env.COMPANY_EMAIL ?? '',
    vatPayer: process.env.COMPANY_VAT_PAYER === 'true',
    // The special VAT code under art. 317 of the Fiscal Code (RO + digits). Used only on the
    // D301/D390 declarations for services bought in the EU
    // (reverse_charge_type='eu_services'), not on e-Factura. Public information, not a secret.
    vatIntraCommunityCode: process.env.COMPANY_VAT_INTRA_CODE ?? '',
    // The administrator who signs the contracts, and the support phone printed on the contract
    // and its annex. Both are on every generated PDF, so they are not secrets.
    representative: process.env.COMPANY_REPRESENTATIVE ?? '',
    phone: process.env.COMPANY_PHONE ?? '',
  },

  // Declarant persoană fizică (Stefan, administrator) — câmpuri obligatorii pe D301/D390
  // (nume_declarant/prenume_declarant/functia_declarant), distincte de profilul firmei.
  declarant: {
    firstName: process.env.DECLARANT_FIRST_NAME ?? '',
    lastName: process.env.DECLARANT_LAST_NAME ?? '',
    role: process.env.DECLARANT_ROLE ?? 'Administrator',
  },

  // Revolut Business API (sandbox: https://sandbox-b2b.revolut.com/api/1.0)
  revolutApiUrl: process.env.REVOLUT_API_URL ?? 'https://b2b.revolut.com/api/1.0',
  // Callback OAuth Revolut. `client_id` NU e global (spre deosebire de ANAF, care
  // e singleton pe CIF) — fiecare rând bank_accounts are propriul client_id + cert,
  // fiindcă un cont Revolut Business poate avea nevoie de mai multe integrări.
  revolutRedirectUri: process.env.REVOLUT_REDIRECT_URI ?? 'http://localhost:5174/reconciliation/revolut-callback',

  // Alert emails (Resend, fetch brut — vezi shared/lib/email.ts). Fără RESEND_API_KEY
  // → email dezactivat, doar log.
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  alertEmailFrom: process.env.ALERT_EMAIL_FROM ?? '',
  alertEmailTo: process.env.ALERT_EMAIL_TO ?? '',
  // Plan gratuit Resend (2026-07-21) — folosit doar pt. avertisment vizual în tab-ul
  // Trimise, nu impune nicio limită hard în cod (Resend însuși respinge peste limită).
  // 100/zi (2026-09-07) — Resend a scăzut plafonul planului gratuit la 2 domenii verificate;
  // urcă din nou dacă Stefan trece pe un plan plătit.
  resendDailyLimit: Number(process.env.RESEND_DAILY_LIMIT ?? 100),
  resendMonthlyLimit: Number(process.env.RESEND_MONTHLY_LIMIT ?? 3000),

  // The sending identities of the Email module: personal (the account owner), business
  // (contact, most of what is sent), automatic (no-reply) and outreach. Resend format:
  // "Display Name <address>". Any local part works on a domain verified in Resend.
  emailFromStefan: process.env.EMAIL_FROM_STEFAN ?? '',
  emailFromContact: process.env.EMAIL_FROM_CONTACT ?? '',
  emailFromNoreply: process.env.EMAIL_FROM_NOREPLY ?? '',
  // The outreach identity (cold B2B outreach, sent from a dedicated subdomain). Empty by
  // default: resolveFromAddress('outreach') then falls back to emailFromContact, so the rest
  // of the app works before the subdomain is set up.
  emailFromOutreach: process.env.EMAIL_FROM_OUTREACH ?? '',

  // The signature attached to messages, one line of text per identity. The logo is optional:
  // a public URL, put in the HTML only when set.
  emailSignatureStefanText: process.env.EMAIL_SIGNATURE_STEFAN_TEXT ?? '',
  emailSignatureContactText: process.env.EMAIL_SIGNATURE_CONTACT_TEXT ?? '',
  emailLogoUrl: process.env.EMAIL_LOGO_URL ?? '',

  // Footer de dezabonare, anexat automat pe orice email trimis prin bulk-send
  // (modul Email, Sprint B) — text static, ajustabil doar prin .env (nu UI/tabelă,
  // nu justifică o config table pentru un text fix, regula #10 no bloat).
  emailUnsubscribeText:
    process.env.EMAIL_UNSUBSCRIBE_TEXT ??
    "Pentru a nu mai primi acest tip de email, răspunde cu 'dezabonare'.",

  // Secret Svix pt. verificarea semnăturii webhook-ului Resend inbound
  // (`POST /api/webhooks/resend-inbound`, modul Email — singura rută publică
  // din tot proiectul în afară de /health și /login). Gol până Stefan configurează
  // domeniul de primire + webhook-ul în dashboard Resend (dormant până la deploy,
  // vezi PLAN.md) — fără el, ruta respinge orice payload (fail-closed, nu skip).
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? '',

  // Deprecated: SMTP nu mai e folosit de shared/lib/email.ts (înlocuit cu Resend).
  // Păstrate nesterse — OPS le poate marca opțional în .env.example într-un wave viitor.
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',

  // Track A (monitorizare server) — secretul dedicat pt. POST /api/monitoring/host-metrics
  // (apelant: script cron pe host-ul VPS, nu o sesiune de browser). Gol implicit = ruta
  // respinge orice request (fail-closed, nu skip silențios — vezi monitoring/routes.ts).
  hostMetricsIngestToken: process.env.HOST_METRICS_INGEST_TOKEN ?? '',
  // pg_dump zilnic (jobs/backup.ts) — director + retenție. Fără DATABASE_URL separat,
  // reuse config.databaseUrl (aceeași bază, evident).
  backupDir: process.env.BACKUP_DIR ?? '/backups',
  backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 7),

  // 2026-07-30 — secretul dedicat pt. POST /api/webhooks/vanagreen-alert (apelant: backend-ul
  // vanagreen, shared/lib/vanadash-alert.ts — nu o sesiune de browser). Aceeași valoare trebuie
  // setată în vanagreen ca VANADASH_ALERT_INGEST_TOKEN. Gol implicit = ruta respinge orice
  // request (fail-closed, pattern identic host-metrics — vezi monitoring/routes.ts).
  vanagreenAlertIngestToken: process.env.VANAGREEN_ALERT_INGEST_TOKEN ?? '',

  // 2026-08-03 — secrete dedicate pt. POST /api/v1/integrations/vanagreen/pricing/calculate și
  // /billing-clients (apelant: recyclers_app, wizard-ul de self-serve signup — nu o sesiune de
  // browser). Fiecare cu secretul lui, distincte între ele ȘI de vanagreenAlertIngestToken de mai
  // sus. Aceleași valori trebuie setate în recyclers_app ca VANADASH_PRICING_INGEST_TOKEN /
  // VANADASH_BILLING_INGEST_TOKEN. Gol implicit = ruta respinge orice request (fail-closed,
  // pattern identic vanagreenAlertIngestToken).
  vanagreenPricingIngestToken: process.env.VANAGREEN_PRICING_INGEST_TOKEN ?? '',
  vanagreenBillingIngestToken: process.env.VANAGREEN_BILLING_INGEST_TOKEN ?? '',

  // Sprint D, Track 5 — secretul dedicat pt. POST /api/webhooks/cloudflare-inbound (apelant:
  // Worker-ul infra/cloudflare-email-worker/, nu o sesiune de browser). Gol implicit = ruta
  // respinge orice request (fail-closed, pattern identic host-metrics — vezi monitoring/routes.ts).
  cloudflareEmailIngestToken: process.env.CLOUDFLARE_EMAIL_INGEST_TOKEN ?? '',

  // Secret for POST /api/v1/integrations/jeffbot/snapshot, sent by an external trading bot.
  // Empty by default: the route then rejects every request, and the Bot tabs, their feature and
  // their alerts job stay off (see `available` in shared/lib/features.ts).
  jeffbotIngestToken: process.env.JEFFBOT_INGEST_TOKEN ?? '',
  // Programări publice (docs/BOOKING.md): secretul cu care Function-ul din vana-site cheamă
  // /api/v1/public/booking/*. Gol = rutele publice resping orice (fail-closed).
  bookingToken: process.env.BOOKING_TOKEN ?? '',
  // Pagina de pe site pe care duce linkul de anulare din emailul de confirmare.
  bookingCancelUrl: process.env.BOOKING_CANCEL_URL ?? '',

  // 2026-08-11 — cheia HMAC pt. link-ul de dezabonare din footer-ul bulk-send
  // (modules/email/unsubscribe-token.ts). Token stateless (email + semnătură, fără tabel de
  // token-uri) — GET /api/email/unsubscribe/:token (rută publică) verifică semnătura înainte
  // să marcheze adresa în email_suppressions. Gol implicit = ruta respinge orice token
  // (fail-closed, pattern identic celorlalte secrete de mai sus).
  emailUnsubscribeSecret: process.env.EMAIL_UNSUBSCRIBE_SECRET ?? '',

  // The Client Secret of the Sentry integration (Internal Integration, or Issue Alert →
  // webhook) for POST /api/webhooks/sentry. Sentry signs the raw body with HMAC-SHA256 in the
  // Sentry-Hook-Signature header. Empty by default: the route then rejects every request.
  sentryWebhookSecret: process.env.SENTRY_WEBHOOK_SECRET ?? '',

  // Modul Arhivă — Cloudflare R2 (S3-compatible), un singur bucket/cont, credențiale globale
  // (pattern identic anafClientId/anafClientSecret, nu per-rând ca bank_accounts.api_key_enc).
  // Gol implicit — Stefan completează după ce creează bucket-ul + API token în dashboard
  // Cloudflare; până atunci shared/lib/r2.ts aruncă explicit la prima folosire, nu la boot.
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucketName: process.env.R2_BUCKET_NAME ?? '',
    // Plan gratuit Cloudflare R2 (2026-07-21) — doar pt. avertisment vizual în Arhivă.
    freeTierLimitGb: Number(process.env.R2_STORAGE_LIMIT_GB ?? 10),
  },

  // Web Push (Sprint 2) — chei VAPID generate o singură dată (`npx web-push generate-vapid-keys`).
  // Gol implicit — shared/lib/push.ts sare peste trimitere silențios (log warn) până Stefan le
  // configurează, pattern identic RESEND_API_KEY. Cheia privată nu ajunge NICIODATĂ în response.
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? '',
  },

  // Agent Claude in-app (PLAN_INAPP_AGENT.md) — modules/assistant/. Gol implicit = ruta de chat
  // aruncă explicit la prima folosire, nu la boot (pattern identic R2/VAPID). Model configurabil
  // fără redeploy — decizie de cost Opus vs Sonnet rămâne la Stefan, doar env var.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_ASSISTANT_MODEL ?? 'claude-opus-4-8',
  },

  // Provider secundar al asistentului (sprint multi-provider 2026-08-25) — OpenRouter,
  // API OpenAI-compatible. Gol implicit = cheia se pune din Setări → Asistent (criptat în DB);
  // env rămâne fallback pt. instalări proaspete.
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
  },

  // Notificări native APK prin FCM (PLAN.md Contract C) — service account JSON-ul complet al
  // proiectului Firebase, ca string. Gol implicit = sendFcm() e no-op silențios (pattern
  // identic VAPID), web-push-ul browserelor continuă neafectat.
  firebase: {
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  },
}
