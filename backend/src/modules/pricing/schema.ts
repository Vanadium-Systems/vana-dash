import { z } from 'zod'
import { tr } from '../../shared/lib/i18n.js'

// Sprint D, Track 4 — config calculator de preț, generic per platformă (NU vanagreen-
// specific în cod, doar prin platformId — CLAUDE.md regula #3). Shape 1:1 cu CONFIG din
// vanagreen-price-calculator.html (research Stefan), portat din <script> în DB+UI editabilă.
// Validat Zod STRICT aici — jsonb-ul din DB e liber, dar tot ce intră/iese prin API trece
// prin schema asta.

const DocumentBandSchema = z.object({
  // null = Infinity (ultima bandă, "peste X documente/lună"). Trebuie să fie ULTIMA
  // bandă din array — validat mai jos (assertStrictlyIncreasing).
  upTo: z.number().positive().nullable(),
  // null = peste prag, NU se calculează automat (manualReviewNeeded=true la /calculate).
  rate: z.number().nonnegative().nullable(),
})

// Axa de multiplier pt. prețul de bază. Era `caBands` (cifra de afaceri a clientului) —
// scoasă 2026-08-01 (Stefan): a cere CA-ul unui prospect ÎN TIMPUL discuției de preț strică
// discuția ("mă rupe"). `puncte` (puncte de lucru) e deja un input firesc de cerut live și
// corelează bine cu mărimea reală a firmei în domeniul ăsta.
const PuncteBandSchema = z.object({
  max: z.number().positive().nullable(), // null = Infinity, ultima bandă
  mult: z.number().positive(),
  label: z.string().min(1),
  // Nume de plan (ex: "Start"/"Business"/"Enterprise") — optional, config-urile existente nu-l
  // au (jsonb liber, fără migrare). Dacă lipsește, /calculate întoarce planName: null, nu ghicește.
  planName: z.string().min(1).optional(),
})

// Sprint 4 — echipamente fizice (signature pad, scanner acte) vândute per client. Fiecare item
// e independent (spre deosebire de documentBands/caBands, nu are ordine/monotonie de validat).
const EquipmentItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1), // text liber ("Signature pad STU-430") — Stefan știe ce vinde
  purchasePrice: z.number().nonnegative(), // one-time, ce plătește Stefan furnizorului
  integrationPrice: z.number().nonnegative(), // one-time, marja/serviciul lui
  monthlyFee: z.number().nonnegative(), // recurent, cât timp echipamentul rămâne integrat
})
export type EquipmentItem = z.infer<typeof EquipmentItemSchema>

// Wave 0/1, sprint de-hardcodare (2026-08-20) — înlocuiește cele 12 câmpuri `addon*Price` fixe
// (addonTratariPrice…addonAiAssistantPrice) cu un catalog generic, editabil din UI fără deploy.
// `key`-urile add-on-urilor existente sunt EXACT valorile din enum-ul `addons` al
// `SelfServePricingCalculateSchema` (modules/vanagreen-ingest/schema.ts) — contract fix cu
// recyclers_app, păstrat neschimbat (vezi VANAGREEN.md). Un add-on nou adăugat manual din
// Config preț (nu prin self-serve) poate avea orice `key` liber — doar cele 12 existente
// coincid cu vocabularul self-serve.
//
// Benzi pe cantitate (sprint de-hardcodare 2026-08-25): opțional, ex. ai_assistant pe pachete
// de tokeni sau hr per angajat. Prezența benzilor face prețul fix ignorat la calcul — cantitatea
// cade într-o treaptă și se taxează cantitate × unitPrice. Fără benzi = preț fix (comportarea
// de până acum).
const AddonBandSchema = z.object({
  // null = Infinity (ultima bandă, "nelimitat") — validat strict crescător mai jos.
  upTo: z.number().positive().nullable(),
  unitPrice: z.number().nonnegative(),
})

const PricingAddonBaseSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  price: z.number().nonnegative(),
  bands: z.array(AddonBandSchema).min(1).optional(),
})

// Bundles of add-ons. `addonKeys` reference `key`s in `PricingConfig['addons']` and are not
// cross-validated here (Zod n-are context între câmpuri fără .superRefine pe tot obiectul;
// un `key` orfan e tratat ca preț 0 la calcul, la fel ca un add-on individual necunoscut).
export const PricingAddonSchema = PricingAddonBaseSchema

export const PricingBundleSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  addonKeys: z.array(z.string().min(1)).min(1),
  // The bundle costs the sum of its modules minus this percentage (Stefan, 2026-10-30), so a
  // module price change carries into every bundle that contains it. Replaces the old fixed
  // `price`, which drifted away from the modules it was supposed to discount. Bundles saved
  // before this have no value and price at the full sum until it's set.
  discountPercent: z.number().min(0).max(100).default(0),
  // Preset opțional pt. calculatorul manual (cerut de Stefan, 2026-08-20) — NU intră în formula
  // de calcul, doar precompletează puncte/opDesktop/opMobil/documente/cantare la selectarea
  // bundle-ului în CalculatorTab.tsx; rămân editabile după. Self-serve (recyclers_app) trimite
  // propriile valori explicite, indiferent de bundle — conceptul de "preset" e strict UI internă.
  puncteLucru: z.number().int().nonnegative().optional(),
  operatoriDesktop: z.number().int().nonnegative().optional(),
  operatoriMobil: z.number().int().nonnegative().optional(),
  documente: z.number().int().nonnegative().optional(),
  cantare: z.number().int().nonnegative().optional(),
  // Estimated setup hours for this bundle; missing = the config's `onboardingDefaultHours`.
  onboardingHours: z.number().nonnegative().optional(),
})

/**
 * Benzile trebuie să fie strict crescătoare pe `key` (altfel calculul pe benzi produce
 * rezultate greșite — o bandă mai mică decât precedenta "mănâncă" incorect din overage).
 * `null` (Infinity) e permis DOAR ca ultima bandă.
 */
function assertStrictlyIncreasingBands<T extends Record<string, unknown>>(
  bands: T[],
  key: keyof T & string,
  ctx: z.RefinementCtx,
  path: string,
) {
  let prev = -Infinity
  bands.forEach((band, i) => {
    const raw = band[key] as number | null
    const value = raw === null ? Infinity : raw
    if (value <= prev) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: tr('errors.pricing.bandNotIncreasing', { path, i, key }),
        path: [path, i, key],
      })
    }
    if (value === Infinity && i !== bands.length - 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: tr('errors.pricing.infiniteBandLast', { path, key }),
        path: [path, i, key],
      })
    }
    prev = value
  })
}

export const PricingConfigSchema = z
  .object({
    basePrice: z.number().nonnegative(),
    operatorDesktopRate: z.number().nonnegative(),
    operatorMobilRate: z.number().nonnegative(),
    // punctRate eliminat 2026-08-05 (Stefan) — dubla multiplierul benzii de puncte (care deja
    // scalează `basePrice` mai sus, vezi puncteBands mai jos), la fel ca onboardingPunctRate
    // eliminat mai jos: două căi separate care taxau "puncte extra" pe același total lunar,
    // confuz. Config-urile EXISTENTE în DB încă au câmpul în jsonb — parse-ul Zod îl ignoră
    // silențios (obiect non-strict), nicio migrare necesară.
    documenteIncluse: z.number().nonnegative(),
    documentBands: z.array(DocumentBandSchema).min(1),
    fluxDeeeDelta: z.number().nonnegative(),
    // Catalog generic de add-on-uri (Wave 0/1, sprint de-hardcodare 2026-08-20) — înlocuiește
    // cele 12 câmpuri `addon*Price` fixe. `.default([])` obligatoriu: config-urile existente
    // din DB nu au acest câmp până la rularea `scripts/migrate-pricing-addons.ts` (aditiv, nu
    // distructiv — vezi comentariul din script), altfel getConfig() crapă pe rândurile vechi.
    addons: z.array(PricingAddonSchema).default([]),
    // Bundle-uri de add-on-uri la preț fix (2026-08-20, cerere Stefan) — `.default([])`:
    // config-urile existente nu au acest câmp, jsonb liber, fără migrare.
    bundles: z.array(PricingBundleSchema).default([]),
    // Legătură cântar smart — preț PER CÂNTAR conectat (nu boolean, ca operatorMobilRate),
    // un tenant poate conecta mai multe cântare. NU influențează onboarding.
    cantarRate: z.number().nonnegative().default(10),
    siatdFloorPrice: z.number().nonnegative(),
    siatdFloorUnits: z.number().nonnegative(),
    siatdUnitPrice: z.number().nonnegative(),
    lunileAnuale: z.number().positive(),
    // Adăugat 2026-08-01 (redenumire din `caBands`) — config-urile EXISTENTE în DB au încă
    // `caBands` (cifra de afaceri), nu `puncteBands`, jsonb liber, fără migrare de date.
    // `.default(...)` obligatoriu, altfel getConfig() crapă cu ZodError pe rândurile vechi
    // (whitescreen Calculator + Config preț, exact bug-ul din 2026-07-24 pe equipmentItems,
    // repetat aici). Default = o singură bandă neutră (mult 1) — NU o ghicire a pragurilor
    // reale, doar deblochează citirea; Stefan completează benzile reale din Config preț.
    puncteBands: z.array(PuncteBandSchema).min(1).default([{ max: null, mult: 1, label: tr('pricing.breakdown.needsSetup') }]),
    // Setup is priced by the hour (Stefan, 2026-10-30): the same product can take 5 hours at
    // one client and 25 at another, which the old per-component fees (onboardingBase ×
    // multiplier, per-operator, DEEE, SIATD, scale setup) couldn't express. Those fields are
    // still in the stored jsonb and are dropped silently on parse.
    onboardingHourlyRate: z.number().nonnegative().default(40),
    // Used when nobody estimated the hours: self-serve quotes and the calculator's prefill.
    onboardingDefaultHours: z.number().nonnegative().default(5),
    // Buffer on top of the estimate, for the client who ends up taking 25 hours instead of 20.
    onboardingMarginPercent: z.number().min(0).default(20),
    // Campaign discount on everything except equipment bought at cost (Stefan, 2026-10-30).
    discountPercent: z.number().min(0).max(100).default(0),
    // Sprint 4 — .default([])/.default(0) obligatoriu: config-urile EXISTENTE în DB (jsonb liber,
    // fără migrare) nu au aceste câmpuri, trebuie să parseze în continuare fără eroare.
    equipmentItems: z.array(EquipmentItemSchema).default([]),
  })
  .superRefine((cfg, ctx) => {
    assertStrictlyIncreasingBands(cfg.documentBands, 'upTo', ctx, 'documentBands')
    assertStrictlyIncreasingBands(cfg.puncteBands, 'max', ctx, 'puncteBands')
    cfg.addons.forEach((addon, i) => {
      if (addon.bands) assertStrictlyIncreasingBands(addon.bands, 'upTo', ctx, `addons[${i}].bands`)
    })
  })

export type PricingConfig = z.infer<typeof PricingConfigSchema>

export const PricingConfigQuerySchema = z.object({ platformId: z.string().uuid() })

export const PricingConfigUpsertSchema = z.object({
  platformId: z.string().uuid(),
  config: PricingConfigSchema,
})

export const PricingCalculateSchema = z.object({
  platformId: z.string().uuid(),
  flux: z.enum(['standard', 'deee']),
  opDesktop: z.number().int().nonnegative(),
  opMobil: z.number().int().nonnegative(),
  puncte: z.number().int().nonnegative(),
  documente: z.number().int().nonnegative(),
  siatd: z.number().int().nonnegative(),
  // Sprint 4 — .default([]): clienți FE vechi (cache offline, PWA neactualizat) care nu
  // trimit deloc câmpul tot trebuie să calculeze corect (fără echipamente).
  selectedEquipmentIds: z.array(z.string().uuid()).default([]),
  // Wave 0/1, sprint de-hardcodare (2026-08-20) — înlocuiește cele 12 flag-uri booleene
  // (addonTratari…addonAiAssistant) cu o listă generică de `key`-uri din catalogul
  // `PricingConfig['addons']`. `.default([])`: clienți FE vechi (cache offline, PWA
  // neactualizat) care nu trimit deloc câmpul tot trebuie să calculeze corect (fără add-on-uri).
  selectedAddonKeys: z.array(z.string()).default([]),
  // Bundle-uri (2026-08-20) — un singur pachet selectat (`PricingConfig['bundles']`),
  // combinabil cu add-on-uri individuale în afara pachetului (calc.ts exclude din
  // selectedAddonKeys orice key deja inclus în pachet, ca să nu se taxeze de două ori).
  // `.default(null)`: clienți FE vechi tot trebuie să calculeze corect fără bundle-uri.
  selectedBundleKey: z.string().nullable().default(null),
  cantare: z.number().int().nonnegative().default(0),
  // Cantități pt. add-on-urile cu benzi (sprint de-hardcodare 2026-08-25) — cheie = `key`-ul
  // add-on-ului; lipsa = 1 (add-on-urile fără benzi ignoră cantitatea). FE vechi care nu trimite
  // câmpul calculează identic ca înainte.
  addonQuantities: z.record(z.string(), z.number().int().positive()).default({}),
  // null = the bundle's hours, else the config default. Self-serve never sends these.
  onboardingHours: z.number().nonnegative().nullable().default(null),
  onboardingMarginPercent: z.number().min(0).nullable().default(null),
})
export type PricingCalculateInput = z.infer<typeof PricingCalculateSchema>

// Kill-switch preț self-serve (Stefan, 2026-08-04) — vezi modules/vanagreen-ingest/service.ts.
export const SelfServePricingToggleUpdateSchema = z.object({ enabled: z.boolean() })
