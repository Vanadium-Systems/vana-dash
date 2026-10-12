import { anafConnector } from './anaf/index.js'
import { genericConnector } from './generic/index.js'
import { revolutConnector } from './revolut/index.js'
import type { AccountingConnector, BankConnector, PlatformConnector } from './types.js'
import { vanagreenConnector } from './vanagreen/index.js'

export const connectors: Record<string, PlatformConnector> = {
  vanagreen: vanagreenConnector,
  generic: genericConnector,
}

// Registre separate — semantici diferite (documente/tranzacții, nu metrici).
// Nu se amestecă cu connectors (platforme).
export const accountingConnectors: Record<string, AccountingConnector> = {
  anaf: anafConnector,
}

export const bankConnectors: Record<string, BankConnector> = {
  revolut: revolutConnector,
}

export function getConnector(type: string): PlatformConnector {
  const connector = connectors[type]
  if (!connector) throw new Error(`Unknown platform type: ${type}`)
  return connector
}

export function getBankConnector(provider: string): BankConnector {
  const connector = bankConnectors[provider]
  if (!connector) throw new Error(`Unknown bank provider: ${provider}`)
  return connector
}
