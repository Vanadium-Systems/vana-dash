// Euristică de spam homegrown — scor, NU ML, nimic la nivelul filtrării Google (confirmat din
// research, PLAN.md). Comutabilă din UI (dashboard_config `email.auto_spam_enabled`), pt. cazul
// în care se dovedește prea agresivă sau inutilă. Funcție pură — apelantul (inbound-service.ts)
// aduce datele (sender cunoscut sau nu, cuvinte-cheie configurate).

const SUSPICIOUS_TLDS = ['.top', '.xyz', '.click', '.loan', '.work', '.gq', '.cf', '.tk', '.ml']
const URL_RE = /https?:\/\/[^\s<>"']+/gi
const MAX_LINK_POINTS = 3

export interface SpamScoreInput {
  fromKnownBefore: boolean
  subject: string
  bodyText: string | null
  keywords: string[]
}

export interface SpamScoreResult {
  score: number
  threshold: number
  isSpam: boolean
}

function isAllCapsSubject(subject: string): boolean {
  const letters = subject.replace(/[^A-Za-z]/g, '')
  if (letters.length < 6) return false
  const upper = letters.replace(/[^A-Z]/g, '')
  return upper.length / letters.length > 0.7
}

function suspiciousLinkPoints(bodyText: string | null): number {
  if (!bodyText) return 0
  const urls = bodyText.match(URL_RE) ?? []
  let points = 0
  for (const url of urls) {
    if (SUSPICIOUS_TLDS.some((tld) => url.toLowerCase().includes(`${tld}/`) || url.toLowerCase().endsWith(tld))) {
      points += 1
    }
  }
  return Math.min(points, MAX_LINK_POINTS)
}

export function computeSpamScore(input: SpamScoreInput, threshold: number): SpamScoreResult {
  let score = 0

  if (!input.fromKnownBefore) score += 2

  const haystack = `${input.subject} ${input.bodyText ?? ''}`.toLowerCase()
  if (input.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) score += 2

  score += suspiciousLinkPoints(input.bodyText)

  if (isAllCapsSubject(input.subject)) score += 1

  return { score, threshold, isSpam: score >= threshold }
}
