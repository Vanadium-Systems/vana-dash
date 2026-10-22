// Env defaults pentru teste — rulează înainte de orice import de config.
// DB-ul de test e Postgres-ul de dev din infra/docker-compose.yml.
process.env.DATABASE_URL ??= 'postgres://vanadash:vanadash@localhost:5433/vanadash'
process.env.JWT_SECRET ??= 'test-jwt-secret-not-for-production-use'
process.env.MASTER_ENCRYPTION_KEY ??= 'a'.repeat(64)
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5174'
// Pinat explicit (nu doar default din config.ts) ca testele să nu depindă de
// ce are dezvoltatorul în .env local (ex: sandbox Revolut pt. test manual).
process.env.REVOLUT_API_URL ??= 'https://b2b.revolut.com/api/1.0'
// Modul Email (Sprint B) — inbound webhook. Valori fixe pt. teste de integrare care
// semnează payload-uri Svix cu acest secret; email.test.ts își setează propriile
// valori per-test (vi.resetModules + dynamic import), deci nu e afectat.
process.env.RESEND_WEBHOOK_SECRET ??= 'whsec_dGVzdC13ZWJob29rLXNlY3JldC12YW5hLWRhc2g='
process.env.RESEND_API_KEY ??= 'test-resend-api-key'
// Storage separat pt. teste — `./storage` (default) poate fi deținut de root într-un
// mediu unde app-ul a rulat cândva în Docker; testele nu trebuie să depindă de
// permisiunile acelui folder și nici să-l polueze cu fișiere de test.
process.env.STORAGE_DIR ??= './storage-test'
// Track A (monitorizare server) — token fix pt. teste de integrare pe ruta de ingest,
// director separat pt. semnalul de backup (nu `/backups`, care poate să nu existe/fie
// scriptibil în mediul de test).
process.env.HOST_METRICS_INGEST_TOKEN ??= 'test-host-metrics-ingest-token'
process.env.BACKUP_DIR ??= './backup-test'
// Sprint D, Track 5 — token fix pt. teste de integrare pe ruta de ingest email Cloudflare
// (pattern identic host-metrics de mai sus).
process.env.CLOUDFLARE_EMAIL_INGEST_TOKEN ??= 'test-cloudflare-email-ingest-token'
// Sprint D, Track C — parola fixă a rolului 'accountant', pt. testele de integrare pe login +
// permisiuni Arhivă/Accounting.
process.env.ACCOUNTANT_LOGIN_PASSWORD ??= 'test-accountant-password-not-for-prod'
// 2026-08-03 — token-uri fixe pt. testele de integrare pe rutele de ingest self-serve
// (POST /api/v1/integrations/vanagreen/pricing/calculate + /billing-clients), pattern identic
// host-metrics/cloudflare-email de mai sus.
process.env.VANAGREEN_PRICING_INGEST_TOKEN ??= 'test-vanagreen-pricing-ingest-token'
process.env.VANAGREEN_BILLING_INGEST_TOKEN ??= 'test-vanagreen-billing-ingest-token'
// 2026-09-25 — token fix pt. ingestul jeffbot (pattern identic host-metrics).
process.env.JEFFBOT_INGEST_TOKEN ??= 'test-jeffbot-ingest-token'
// Programări publice — token fix pt. testele pe rutele /api/v1/public/booking/*.
process.env.BOOKING_TOKEN ??= 'test-booking-token'
// Calls exist only with a Daily key; the tests never reach Daily (fetch is stubbed).
process.env.DAILY_API_KEY ??= 'test-daily-key'
process.env.DAILY_DOMAIN ??= 'acme'
// A clean checkout (CI, a new contributor) has no .env. The values below are the ones a few
// tests need from a developer's .env: a complete company profile for invoice PDFs and the HMAC
// key of the unsubscribe link. All invented.
process.env.COMPANY_NAME ??= 'Test Company SRL'
process.env.COMPANY_CIF ??= 'RO12345678'
process.env.COMPANY_REG_COM ??= 'J40/1/2020'
process.env.COMPANY_ADDRESS ??= 'Str. Test nr. 1'
process.env.COMPANY_IBAN ??= 'RO49AAAA1B31007593840000'
process.env.COMPANY_BANK ??= 'Test Bank'
process.env.EMAIL_UNSUBSCRIBE_SECRET ??= 'test-unsubscribe-secret-not-for-production-use'

// The sending identities and the other addresses have no default in config.ts. The email
// tests need the three identities to exist, as they would after Settings is filled in.
process.env.EMAIL_FROM_STEFAN ??= 'Stefan <stefan@vanadium.systems>'
process.env.EMAIL_FROM_CONTACT ??= 'Vanadium Systems <contact@vanadium.systems>'
process.env.EMAIL_FROM_NOREPLY ??= 'Vanadium Systems <no-reply@vanadium.systems>'
process.env.EMAIL_SIGNATURE_STEFAN_TEXT ??= 'Stefan\nVanadium Systems'
process.env.EMAIL_SIGNATURE_CONTACT_TEXT ??= 'Vanadium Systems'
process.env.ALERT_EMAIL_FROM ??= 'alerts@example.com'
process.env.ALERT_EMAIL_TO ??= 'admin@example.com'
process.env.COMPANY_EMAIL ??= 'office@example.com'
process.env.BOOKING_CANCEL_URL ??= 'https://example.com/booking/cancel'

