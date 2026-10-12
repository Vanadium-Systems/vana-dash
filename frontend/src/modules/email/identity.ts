// "Stefan <stefan@vanadium.systems>" → "stefan@vanadium.systems" (identitățile de trimitere
// stochează formatul RFC 5322 complet; unele UI-uri au nevoie doar de adresa goală).
export function extractEmailAddress(raw: string): string {
  return (/<(.+)>/.exec(raw)?.[1] ?? raw).trim().toLowerCase()
}

// Sugestii scurte lângă unele identități în dropdown-urile "De la" — nu vin din backend
// (identities e doar key/label/fromAddress), doar context util la alegere.
const IDENTITY_HINTS: Record<string, string> = {
  stefan: 'personal',
  outreach: 'cold outreach, plafon de warm-up',
}

export function identityOptionLabel(identity: { key: string; label: string; fromAddress: string }): string {
  const hint = IDENTITY_HINTS[identity.key]
  const address = extractEmailAddress(identity.fromAddress)
  return hint ? `${identity.label} (${hint}) — ${address}` : `${identity.label} — ${address}`
}
