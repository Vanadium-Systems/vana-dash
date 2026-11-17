export type CallStatus = 'open' | 'ended' | 'cancelled'
export type CallFilter = 'all' | 'open' | 'ended'
export type CallKind = 'audio' | 'video'
export type CallProvider = 'daily' | 'livekit'

export interface CallRow {
  id: string
  title: string
  publicUrl: string
  kind: CallKind
  provider: CallProvider
  conversationId: string | null
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

export type CallTokenResponse =
  | {
      provider: 'livekit'
      livekitUrl: string
      token: string
      roomName: string
      kind: CallKind
      conversationId: string | null
      guestKey: string | null
    }
  | {
      provider: 'daily'
      roomUrl: string
      token: string
    }

export interface PublicCall {
  status: 'open' | 'ended'
  kind: CallKind
  provider: CallProvider
  opensAt: string | null
  closesAt: string
  roomUrl: string | null
}

export interface PublicCallTokenResponse {
  provider: 'livekit'
  livekitUrl: string
  token: string
  roomName: string
  kind: CallKind
}
