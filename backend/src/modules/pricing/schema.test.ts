/**
 * modules/pricing/schema.ts — validarea ordinii benzilor (documentBands/puncteBands trebuie
 * strict crescătoare, null=Infinity doar ca ultima bandă). Risc semnalat explicit în plan:
 * benzi neordonate produc rezultate greșite la calculul pe benzi (calc.ts).
 */
import { describe, expect, it } from 'vitest'
import { PricingConfigSchema } from './schema.js'

function validConfig() {
  return {
    basePrice: 90,
    operatorDesktopRate: 20,
    operatorMobilRate: 15,
    documenteIncluse: 150,
    documentBands: [
      { upTo: 500, rate: 0.9 },
      { upTo: 1500, rate: 0.35 },
      { upTo: null, rate: null },
    ],
    fluxDeeeDelta: 30,
    siatdFloorPrice: 65,
    siatdFloorUnits: 40,
    siatdUnitPrice: 1.5,
    lunileAnuale: 10,
    puncteBands: [
      { max: 3, mult: 1.0, label: '1-3 puncte' },
      { max: null, mult: 1.65, label: 'peste 3 puncte' },
    ],
    onboardingBase: 150,
    onboardingOpRate: 15,
    onboardingDeeeDelta: 50,
    onboardingSiatdSetup: 40,
  }
}

describe('PricingConfigSchema', () => {
  it('accepts a well-formed config with strictly increasing bands', () => {
    expect(PricingConfigSchema.safeParse(validConfig()).success).toBe(true)
  })

  it('rejects documentBands out of order', () => {
    const cfg = validConfig()
    cfg.documentBands = [
      { upTo: 1500, rate: 0.35 },
      { upTo: 500, rate: 0.9 }, // descrescător — invalid
      { upTo: null, rate: null },
    ]
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(false)
  })

  it('rejects documentBands with a duplicate upTo value (not STRICTLY increasing)', () => {
    const cfg = validConfig()
    cfg.documentBands = [
      { upTo: 500, rate: 0.9 },
      { upTo: 500, rate: 0.35 },
      { upTo: null, rate: null },
    ]
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(false)
  })

  it('rejects a documentBands with null (Infinity) NOT as the last band', () => {
    const cfg = validConfig()
    cfg.documentBands = [
      { upTo: null, rate: null },
      { upTo: 500, rate: 0.9 },
    ]
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(false)
  })

  it('rejects puncteBands out of order', () => {
    const cfg = validConfig()
    cfg.puncteBands = [
      { max: null, mult: 1.65, label: 'peste 3 puncte' },
      { max: 3, mult: 1.0, label: '1-3 puncte' },
    ]
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(false)
  })

  it('allows a config with NO null band at the end (all finite upper bounds)', () => {
    const cfg = validConfig()
    cfg.documentBands = [
      { upTo: 500, rate: 0.9 },
      { upTo: 1500, rate: 0.35 },
    ]
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(true)
  })

  it('rejects an empty documentBands array (min(1))', () => {
    const cfg = validConfig()
    cfg.documentBands = []
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(false)
  })
})

describe('PricingConfigSchema — Sprint 4: echipamente opționale', () => {
  it('config existent (fără equipmentItems/addons) parsează cu default-uri — jsonb liber, fără migrare', () => {
    const parsed = PricingConfigSchema.safeParse(validConfig())
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.equipmentItems).toEqual([])
      expect(parsed.data.addons).toEqual([])
    }
  })

  it('acceptă echipamente valide, fiecare independent (fără ordine de validat)', () => {
    const cfg = {
      ...validConfig(),
      equipmentItems: [
        { id: '11111111-1111-1111-1111-111111111111', name: 'Signature pad', purchasePrice: 800, integrationPrice: 200, monthlyFee: 15 },
        { id: '22222222-2222-2222-2222-222222222222', name: 'Scanner ID', purchasePrice: 0, integrationPrice: 0, monthlyFee: 0 }, // 0 permis (nonnegative, nu positive)
      ],
    }
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(true)
  })

  it('respinge un echipament cu id non-uuid', () => {
    const cfg = { ...validConfig(), equipmentItems: [{ id: 'not-a-uuid', name: 'X', purchasePrice: 1, integrationPrice: 1, monthlyFee: 1 }] }
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(false)
  })

  it('respinge un echipament cu preț negativ', () => {
    const cfg = {
      ...validConfig(),
      equipmentItems: [{ id: '11111111-1111-1111-1111-111111111111', name: 'X', purchasePrice: -1, integrationPrice: 0, monthlyFee: 0 }],
    }
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(false)
  })

  it('respinge un echipament cu nume gol', () => {
    const cfg = {
      ...validConfig(),
      equipmentItems: [{ id: '11111111-1111-1111-1111-111111111111', name: '', purchasePrice: 1, integrationPrice: 1, monthlyFee: 1 }],
    }
    expect(PricingConfigSchema.safeParse(cfg).success).toBe(false)
  })

  it('rejects cantarRate/cantarSetupPrice negative', () => {
    expect(PricingConfigSchema.safeParse({ ...validConfig(), cantarRate: -1 }).success).toBe(false)
    expect(PricingConfigSchema.safeParse({ ...validConfig(), cantarSetupPrice: -1 }).success).toBe(false)
  })
})

describe('PricingConfigSchema — catalog generic addons (Wave 0/1, sprint de-hardcodare 2026-08-20)', () => {
  it('acceptă un array de add-on-uri {key, label, price}', () => {
    const parsed = PricingConfigSchema.safeParse({
      ...validConfig(),
      addons: [
        { key: 'treatment', label: 'Tratări', price: 40 },
        { key: 'hr', label: 'Modul HR', price: 30 },
      ],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.addons).toHaveLength(2)
  })

  it('rejects un add-on cu preț negativ', () => {
    const parsed = PricingConfigSchema.safeParse({ ...validConfig(), addons: [{ key: 'hr', label: 'Modul HR', price: -1 }] })
    expect(parsed.success).toBe(false)
  })

  it('rejects un add-on cu key sau label gol', () => {
    expect(PricingConfigSchema.safeParse({ ...validConfig(), addons: [{ key: '', label: 'X', price: 1 }] }).success).toBe(false)
    expect(PricingConfigSchema.safeParse({ ...validConfig(), addons: [{ key: 'x', label: '', price: 1 }] }).success).toBe(false)
  })
})

describe('PricingConfigSchema — bundle-uri (2026-08-20, cerere Stefan)', () => {
  it('acceptă un array de bundle-uri {key, label, addonKeys, price}', () => {
    const parsed = PricingConfigSchema.safeParse({
      ...validConfig(),
      bundles: [{ key: 'starter', label: 'Pachet Starter', addonKeys: ['treatment', 'pickup'], price: 55 }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.bundles).toHaveLength(1)
  })

  it('config existent (fără bundles) parsează cu default [] — jsonb liber, fără migrare', () => {
    const parsed = PricingConfigSchema.safeParse(validConfig())
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.bundles).toEqual([])
  })

  it('rejects un bundle cu preț negativ', () => {
    const parsed = PricingConfigSchema.safeParse({ ...validConfig(), bundles: [{ key: 'x', label: 'X', addonKeys: ['a'], price: -1 }] })
    expect(parsed.success).toBe(false)
  })

  it('rejects un bundle cu addonKeys gol (min 1)', () => {
    const parsed = PricingConfigSchema.safeParse({ ...validConfig(), bundles: [{ key: 'x', label: 'X', addonKeys: [], price: 1 }] })
    expect(parsed.success).toBe(false)
  })

  it('rejects un bundle cu key sau label gol', () => {
    expect(
      PricingConfigSchema.safeParse({ ...validConfig(), bundles: [{ key: '', label: 'X', addonKeys: ['a'], price: 1 }] }).success,
    ).toBe(false)
    expect(
      PricingConfigSchema.safeParse({ ...validConfig(), bundles: [{ key: 'x', label: '', addonKeys: ['a'], price: 1 }] }).success,
    ).toBe(false)
  })

  it('onboardingPrice implicit 0 dacă lipsește (bundle-uri create înainte de acest câmp)', () => {
    const parsed = PricingConfigSchema.safeParse({ ...validConfig(), bundles: [{ key: 'x', label: 'X', addonKeys: ['a'], price: 1 }] })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.bundles[0]!.onboardingPrice).toBe(0)
  })

  it('acceptă preset-urile opționale (puncteLucru/operatoriDesktop/operatoriMobil/documente/cantare) + onboardingPrice explicit', () => {
    const parsed = PricingConfigSchema.safeParse({
      ...validConfig(),
      bundles: [
        {
          key: 'business',
          label: 'Pachet Business',
          addonKeys: ['a'],
          price: 100,
          puncteLucru: 3,
          operatoriDesktop: 2,
          operatoriMobil: 1,
          documente: 300,
          cantare: 2,
          onboardingPrice: 150,
        },
      ],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const bundle = parsed.data.bundles[0]!
      expect(bundle.puncteLucru).toBe(3)
      expect(bundle.operatoriDesktop).toBe(2)
      expect(bundle.operatoriMobil).toBe(1)
      expect(bundle.documente).toBe(300)
      expect(bundle.cantare).toBe(2)
      expect(bundle.onboardingPrice).toBe(150)
    }
  })

  it('rejects onboardingPrice sau preset-uri negative', () => {
    expect(
      PricingConfigSchema.safeParse({ ...validConfig(), bundles: [{ key: 'x', label: 'X', addonKeys: ['a'], price: 1, onboardingPrice: -1 }] })
        .success,
    ).toBe(false)
    expect(
      PricingConfigSchema.safeParse({ ...validConfig(), bundles: [{ key: 'x', label: 'X', addonKeys: ['a'], price: 1, puncteLucru: -1 }] })
        .success,
    ).toBe(false)
  })
})
