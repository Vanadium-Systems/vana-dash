import type { BotService, BotStrategy, BotTrade, ReviewMeta } from '@/shared/components/bot/types'

// Contract B (PLAN.md, sprint jeffbot 2026-09-25) — GET /api/jeffbot/overview, partea crypto.
// Tipurile comune cu bursa stau în shared/components/bot/types.ts.

export interface BotNews {
  title: string
  url: string
  publishedAt: string | null
  sentiment: string | null
  importance: number | null
  coins: string[]
}

export interface BotSnapshot {
  schemaVersion: 1
  generatedAt: string
  host: string
  services: BotService[]
  data: {
    prices: { symbol: string; lastCandleAgeSec: number | null; price: number | null }[]
    news: { total: number; last24h: number; labeled: number; lastLabeledAgeSec: number | null }
    sourceErrors: { source: string; error: string; sinceSec: number | null }[]
    fearGreed: { value: number; label: string } | null
  }
  model: {
    promoted: boolean
    file: string | null
    holdoutRetPct: number | null
    trainedAt: string | null
    trainLogTail: string[]
  }
  strategies: BotStrategy[]
  news: BotNews[]
}

export interface BotOverview {
  receivedAt: string
  stale: boolean
  snapshot: BotSnapshot
  trades: BotTrade[]
  reviews: ReviewMeta[]
}
