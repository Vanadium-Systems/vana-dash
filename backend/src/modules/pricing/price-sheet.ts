import { calculatePrice } from './calc.js'
import type { PricingCalculateInput, PricingConfig } from './schema.js'

/** Heading of the sheet when the platform has no name. The sheet is a Romanian document. */
export const PRICE_SHEET_PLATFORM_FALLBACK = 'Platformă'

// Fișă de prețuri (2026-09-21, Stefan) — un-pager PDF exportat din Config preț, de trimis unui
// prospect alături de contracte, fără date de client. Stilat identic cu documentele contractuale
// (paleta/fonturile din shared/lib/contract-template-bodies.ts: #0f2447, Helvetica Neue, tabele
// identice), dar NU trece prin motorul de șabloane legale (date publice de preț, nu contract
// per-client), fișier separat, propriul stylesheet mic.
//
// Tariful pachetelor NU e doar prețul modulelor din pachet (calc.ts: bundleTotal se adună
// peste bază+operatori+documente), e prețul TOTAL calculat pentru
// configurația implicită a fiecărui pachet (bundleMonthlyInput mai jos), la fel cum vede
// clientul rezultatul din Calculator.

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmt(n: number): string {
  return `${new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(n)} EUR`
}

function addonLabel(addons: PricingConfig['addons'], key: string): string {
  return addons.find((a) => a.key === key)?.label ?? key
}

const STYLE = `
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 12px; line-height: 1.45; margin: 0; padding: 8mm; }
  h1 { font-size: 19px; color: #0f2447; text-align: center; margin: 0 0 4px; }
  .subtitle { text-align: center; font-size: 12px; color: #555; margin: 0 0 20px; }
  h2 { font-size: 14px; color: #0f2447; margin: 16px 0 6px; border-bottom: 1px solid #0f2447; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; table-layout: fixed; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { color: #0f2447; font-weight: bold; }
  td.num, th.num { text-align: right; white-space: nowrap; width: 15%; }
  th.pachet, td.pachet { width: 22%; }
  .config-sub { color: #666; font-size: 10.5px; font-weight: normal; margin-top: 2px; }
  ul.config-list { margin: 4px 0; padding-left: 20px; columns: 2; }
  ul.config-list li { margin-bottom: 3px; break-inside: avoid; }
  .modules-grid { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 4px; }
  .module-chip { background: #eef1f6; color: #0f2447; border-radius: 4px; padding: 4px 10px; font-size: 11px; font-weight: 500; }
  .note { font-size: 10.5px; color: #555; font-style: italic; margin-top: 4px; }
  .custom-row td { color: #555; font-style: italic; }
`

/** Configurația implicită a unui pachet, aceeași sursă ca preset-ul din Calculator (CalculatorTab.tsx). */
function bundleMonthlyInput(config: PricingConfig, bundleKey: string): PricingCalculateInput {
  const bundle = config.bundles.find((b) => b.key === bundleKey)!
  return {
    platformId: '00000000-0000-0000-0000-000000000000',
    flux: 'standard',
    opDesktop: bundle.operatoriDesktop ?? 1,
    opMobil: bundle.operatoriMobil ?? 0,
    puncte: bundle.puncteLucru ?? 1,
    documente: bundle.documente ?? config.documenteIncluse,
    siatd: 0,
    selectedEquipmentIds: [],
    selectedAddonKeys: [],
    selectedBundleKey: bundle.key,
    cantare: bundle.cantare ?? 0,
    addonQuantities: {},
    onboardingHours: null,
    onboardingMarginPercent: null,
  }
}

function configSummary(input: PricingCalculateInput): string {
  return `${input.opDesktop} desktop, ${input.opMobil} mobil, ${input.puncte} puncte, ${input.documente} doc/lună`
}

export function renderPriceSheetHtml(config: PricingConfig, platformName: string): string {
  const dateLabel = new Date().toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })

  const bundleRows = config.bundles
    .map((b) => {
      const input = bundleMonthlyInput(config, b.key)
      const result = calculatePrice(config, input)
      return `
      <tr>
        <td class="pachet"><strong>${esc(b.label)}</strong><div class="config-sub">${configSummary(input)}</div></td>
        <td class="num">${fmt(result.totalMonthly)}/lună</td>
        <td class="num">${fmt(result.onboardingTotal)}</td>
        <td>${b.addonKeys.map((k) => esc(addonLabel(config.addons, k))).join(', ') || '—'}</td>
      </tr>`
    })
    .join('')

  const moduleChips = config.addons.map((a) => `<span class="module-chip">${esc(a.label)}</span>`).join('')

  const configurableItems = [
    'Operatori desktop',
    'Operatori mobil',
    'Puncte de lucru',
    `Documente/lună (${config.documenteIncluse} incluse pe lună, restul pe benzi)`,
    'Flux (Standard / DEEE-DBA)',
    'Cântare smart conectate',
    'Robot SIATD (achiziții automate)',
    ...(config.equipmentItems.length ? ['Echipamente fizice de cântărire'] : []),
  ]

  return `<!doctype html>
<html lang="ro">
<head><meta charset="utf-8"><title>Fișă de prețuri · ${esc(platformName)}</title><style>${STYLE}</style></head>
<body>
  <h1>Fișă de prețuri</h1>
  <div class="subtitle">${esc(platformName)} · ${dateLabel}</div>

  <h2>Pachete</h2>
  <table>
    <tr><th class="pachet">Pachet</th><th class="num">Tarif</th><th class="num">Taxă inițiere</th><th>Module incluse</th></tr>
    ${bundleRows}
    <tr class="custom-row">
      <td class="pachet"><strong>Personalizat</strong><div class="config-sub">configurație variabilă</div></td>
      <td class="num">la cerere</td>
      <td class="num">—</td>
      <td>configurat manual, în funcție de nevoile companiei. Te contactăm cu o ofertă</td>
    </tr>
  </table>

  <h2>Ce poate configura fiecare firmă</h2>
  <ul class="config-list">
    ${configurableItems.map((i) => `<li>${i}</li>`).join('')}
  </ul>

  <h2>Module disponibile</h2>
  <div class="modules-grid">${moduleChips}</div>

  <p class="note">Prețurile pachetelor sunt calculate pentru configurația implicită a fiecăruia; tariful final variază cu configurația exactă (operatori, puncte de lucru, volum de documente).</p>
</body>
</html>`
}
