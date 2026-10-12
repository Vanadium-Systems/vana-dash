export type TenderSource = 'direct_acquisition' | 'contract_notice'

export interface NormalizedTenderRow {
  source: TenderSource
  externalId: string
  title: string
  cpvCode: string | null
  cpvDescription: string | null
  contractingAuthority: string | null
  estimatedValueRon: number | null
  procedureType: string | null
  stateText: string | null
  isOpen: boolean
  publicationDate: Date | null
  deadlineAt: Date | null
  detailUrl: string
  raw: unknown
}
