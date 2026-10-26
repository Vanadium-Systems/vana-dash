export type CallStatus = 'open' | 'ended' | 'cancelled'
export type CallFilter = 'all' | 'open' | 'ended'

export interface CallRow {
  id: string
  title: string
  publicUrl: string
  scheduledAt: string | null
  expiresAt: string
  status: CallStatus
  durationSeconds: number | null
  participantCount: number | null
  bookingId: string | null
  prospect: { id: string; name: string } | null
  billingClient: { id: string; name: string } | null
  createdAt: string
}

export interface PublicCall {
  status: 'open' | 'ended'
  opensAt: string | null
  closesAt: string
  roomUrl: string | null
}
