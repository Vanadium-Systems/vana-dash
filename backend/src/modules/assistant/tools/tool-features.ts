import { FEATURE_KEYS } from '../../../shared/lib/features.js'

// Ce funcționalitate cere fiecare tool al asistentului (PLAN.md C2, BE-5). Asistentul apelează
// servicii direct, nu prin rute, deci ocolește guard-ul din `onRoute` — singura barieră e
// lista trimisă modelului: tool-urile ale căror funcționalități omul nu le are nu ajung acolo,
// deci modelul nici nu le vede (nu doar nu le poate executa).
//
// Aceeași mapă e citită în două momente: la construirea listei (filtrare) și la confirmarea unei
// acțiuni înregistrate acum 15 minute — dacă funcționalitatea i-a fost oprită între timp,
// acțiunea nu se mai execută. `tools/gating.test.ts` verifică ambele sensuri (fiecare tool
// declară o funcționalitate și fiecare cheie există în catalog), ca un tool nou să nu poată
// scăpa necuplat.
//
// Cheile sunt aceleași din `shared/lib/features.ts`; verificarea de mai jos e doar ca o
// greșeală de tip să nu poată trece neobservată.

export const TOOL_FEATURES: Record<string, string> = {
  // ── Facturi ───────────────────────────────────────────────────────────────
  list_accounting_records: 'facturi.view',
  get_accounting_record: 'facturi.view',
  list_recurring_expenses: 'facturi.cheltuieli',
  get_anaf_status: 'facturi.anaf',
  list_saved_spv_messages: 'facturi.anaf',
  save_spv_message: 'facturi.anaf',
  create_manual_record: 'facturi.emitere',
  update_payment_status: 'facturi.emitere',
  create_recurring_expense: 'facturi.cheltuieli',
  update_recurring_expense: 'facturi.cheltuieli',
  delete_recurring_expense: 'facturi.cheltuieli',
  list_clients: 'facturi.clienti',
  get_client: 'facturi.clienti',
  create_client: 'facturi.clienti',
  update_client: 'facturi.clienti',
  delete_client: 'facturi.clienti',
  list_invoices: 'facturi.view',
  create_draft_invoice: 'facturi.emitere',
  update_draft_invoice: 'facturi.emitere',
  delete_draft_invoice: 'facturi.emitere',
  issue_invoice: 'facturi.emitere',
  get_invoice_sequence: 'facturi.setari',
  update_invoice_sequence: 'facturi.setari',
  list_platform_templates: 'facturi.setari',
  create_platform_template: 'facturi.setari',
  delete_platform_template: 'facturi.setari',

  // ── Financiar ─────────────────────────────────────────────────────────────
  get_metrics_summary: 'financiar.view',
  get_metrics_series: 'financiar.view',
  get_pnl: 'financiar.view',
  get_recurring_revenue: 'financiar.view',
  get_recurring_expenses_monthly: 'financiar.view',
  get_exchange_rate_history: 'financiar.view',
  get_cashflow: 'financiar.view',
  get_mrr_trend: 'financiar.rapoarte',
  get_period_comparison: 'financiar.rapoarte',
  get_expense_breakdown_trend: 'financiar.rapoarte',
  get_monthly_snapshot: 'financiar.rapoarte',

  // ── Reconciliere ──────────────────────────────────────────────────────────
  list_bank_transactions: 'reconciliere.view',
  list_open_invoices: 'reconciliere.view',
  list_vanagreen_tenants: 'reconciliere.view',
  list_bank_accounts: 'reconciliere.conturi',
  create_bank_account: 'reconciliere.conturi',
  update_bank_account: 'reconciliere.conturi',
  delete_bank_account: 'reconciliere.conturi',
  get_vanagreen_settings: 'reconciliere.conturi',
  update_vanagreen_settings: 'reconciliere.conturi',
  create_manual_match: 'reconciliere.potrivire',
  remove_match: 'reconciliere.potrivire',
  mark_invoice_paid_manually: 'reconciliere.potrivire',

  // ── Clienți ───────────────────────────────────────────────────────────────
  get_pricing_config: 'clienti.view',
  list_prospects: 'clienti.view',
  get_prospect: 'clienti.view',
  get_scoring_config: 'clienti.prospectare',
  update_scoring_config: 'clienti.prospectare',
  create_prospect: 'clienti.prospectare',
  update_prospect: 'clienti.prospectare',
  delete_prospect: 'clienti.prospectare',
  recalculate_all_scores: 'clienti.prospectare',
  promote_prospect: 'clienti.prospectare',

  // ── Email ─────────────────────────────────────────────────────────────────
  list_emails: 'email.view',
  read_email: 'email.view',
  update_email_message_flags: 'email.view',
  list_email_templates: 'email.sabloane',
  create_email_draft: 'email.trimitere',
  send_email: 'email.trimitere',
  reply_to_email_thread: 'email.trimitere',
  forward_email: 'email.trimitere',

  // ── Calendar ──────────────────────────────────────────────────────────────
  list_calendar_events: 'calendar.view',
  create_calendar_event: 'calendar.editare',
  update_calendar_event: 'calendar.editare',
  delete_calendar_event: 'calendar.editare',

  // ── Arhivă ────────────────────────────────────────────────────────────────
  list_archive_folders: 'arhiva.view',
  list_archive_files: 'arhiva.view',
  search_archive_files: 'arhiva.view',
  get_archive_storage_usage: 'arhiva.view',
  create_archive_folder: 'arhiva.editare',
  update_archive_folder: 'arhiva.editare',
  delete_archive_folder: 'arhiva.editare',
  update_archive_file: 'arhiva.editare',
  delete_archive_file: 'arhiva.editare',
  permanently_delete_archive_file: 'arhiva.editare',

  // ── Notițe, wishlist, asistent ────────────────────────────────────────────
  list_notes: 'notite.view',
  create_note: 'notite.view',
  update_note: 'notite.view',
  delete_note: 'notite.view',
  list_wishlist_items: 'notite.view',
  get_wishlist_totals: 'notite.view',
  create_wishlist_item: 'notite.view',
  update_wishlist_item: 'notite.view',
  delete_wishlist_item: 'notite.view',
  purchase_wishlist_item: 'notite.view',
  create_reminder: 'asistent.view',
  schedule_report: 'asistent.view',
  cancel_scheduled_run: 'asistent.view',
  list_scheduled_runs: 'asistent.view',

  // ── Investiții ────────────────────────────────────────────────────────────
  crypto_price: 'investitii.view',
  crypto_portfolio: 'investitii.view',
  crypto_place_order: 'investitii.ordine',
  asset_price: 'investitii.view',
  asset_portfolio: 'investitii.view',
  asset_place_order: 'investitii.ordine',
  list_platforms: 'platforme.view',
  get_platform: 'platforme.view',
  list_sync_log: 'platforme.view',
  update_platform: 'platforme.editare',
  delete_platform: 'platforme.editare',

  // ── Alerte ────────────────────────────────────────────────────────────────
  list_alert_rules: 'alerte.view',
  list_alerts: 'alerte.view',
  count_active_alerts: 'alerte.view',
  ack_alert: 'alerte.view',
  snooze_alert: 'alerte.view',
  create_alert_rule: 'alerte.reguli',
  update_alert_rule: 'alerte.reguli',
  delete_alert_rule: 'alerte.reguli',
}

const UNKNOWN_FEATURE_KEYS = Object.values(TOOL_FEATURES).filter((key) => !FEATURE_KEYS.includes(key))
if (UNKNOWN_FEATURE_KEYS.length > 0) {
  throw new Error(`TOOL_FEATURES conține chei care nu sunt în catalog: ${[...new Set(UNKNOWN_FEATURE_KEYS)].join(', ')}`)
}

/** Funcționalitatea de care are nevoie tool-ul, sau `null` dacă numele nu e în registru. */
export function toolFeature(toolName: string): string | null {
  return TOOL_FEATURES[toolName] ?? null
}

/** Drepturile omului asupra tool-ului: funcționalitatea e în lista lui *și* e în catalog. */
export function canUseTool(toolName: string, features: readonly string[]): boolean {
  const feature = toolFeature(toolName)
  return feature !== null && features.includes(feature)
}
