// Tipuri specifice Revolut Business API (b2b.revolut.com/api/1.0).

export interface RevolutTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

/** Răspunsul brut al /auth/token (exchange și refresh). */
export interface RevolutTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface RevolutTransaction {
  id: string
  type: string
  state: 'pending' | 'completed' | 'declined' | 'failed' | 'reverted'
  created_at: string
  completed_at?: string
  reference?: string
  merchant?: { name?: string }
  counterparty?: { id?: string; account_id?: string; account_type?: string }
  legs: RevolutTransactionLeg[]
}

export interface RevolutTransactionLeg {
  leg_id: string
  account_id: string
  amount: number
  currency: string
  description?: string
  counterparty?: {
    account_type?: string
    account_id?: string
    name?: string
  }
}

export interface RevolutAccount {
  id: string
  name?: string
  currency: string
  state: string
}
