// Validator CUI/CIF românesc (Cod Unic de Înregistrare). Portat din recyclers_app
// (shared/lib/cui-validator.ts, deja verificat acolo) — algoritm ANAF:
//   1. Strip prefix opțional "RO" + spații.
//   2. 2..10 cifre.
//   3. Toate cifrele mai puțin ultima, left-pad la 9 cu zerouri.
//   4. Înmulțește fiecare cifră cu greutățile [7,5,3,2,1,7,5,3,2].
//   5. Suma * 10, modulo 11. Dacă rezultatul e 10 → 0.
//   6. Rezultatul trebuie să fie egal cu ultima cifră (cifra de control).
const CUI_WEIGHTS = [7, 5, 3, 2, 1, 7, 5, 3, 2] as const

/** Returnează CUI-ul normalizat (fără "RO", fără spații) dacă cifra de control e validă, altfel null. */
export function normalizeCui(input: string): string | null {
  const stripped = input.trim().replace(/\s+/g, '').replace(/^ro/i, '')
  if (!/^\d{2,10}$/.test(stripped)) return null

  const checkDigit = Number(stripped[stripped.length - 1])
  const body = stripped.slice(0, -1).padStart(9, '0')

  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += Number(body[i]) * CUI_WEIGHTS[i]!
  }
  let computed = (sum * 10) % 11
  if (computed === 10) computed = 0

  return computed === checkDigit ? stripped : null
}
