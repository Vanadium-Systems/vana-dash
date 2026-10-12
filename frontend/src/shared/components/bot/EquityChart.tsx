import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartEmpty, ChartError, ChartSkeleton } from '@/shared/components/charts/chart-states'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import { formatPct, REFERENCE_KEY, strategyColor, type BotStrategy, type EquityPoint, type Market } from './types'
import { t } from '@/shared/lib/i18n'
import { intlTag } from '@/shared/lib/format'

const RANGES = [
  { key: '7', label: '7z' },
  { key: '30', label: '30z' },
  { key: '90', label: '90z' },
  { key: 'all', label: t('common:bot.equity.rangeAll') },
] as const
type RangeKey = (typeof RANGES)[number]['key']

const HEIGHT = 280

// Echitatea în % față de capitalul de start al fiecărei strategii — pe crypto MIX are 3000 USDT,
// restul 1000, deci doar procentele sunt comparabile pe aceeași axă.
export function EquityChart({ strategies, market }: { strategies: BotStrategy[]; market: Market }) {
  const [range, setRange] = useState<RangeKey>('30')
  const titleId = useId()
  const equity = useQuery({
    queryKey: ['jeffbot', 'equity', market, range],
    queryFn: () => api.get<EquityPoint[]>(`/api/jeffbot/equity?days=${range}&market=${market}`),
    refetchInterval: 5 * 60_000,
  })

  const startByKey = useMemo(() => new Map(strategies.map((s) => [s.key, s.startEquity])), [strategies])
  const labelByKey = useMemo(() => new Map(strategies.map((s) => [s.key, s.label])), [strategies])

  const { rows, keys } = useMemo(() => {
    const byTs = new Map<string, Record<string, number | string>>()
    const seen = new Set<string>()
    for (const p of equity.data ?? []) {
      const start = startByKey.get(p.key)
      if (!start) continue
      seen.add(p.key)
      const row = byTs.get(p.ts) ?? { ts: p.ts }
      row[p.key] = (p.equity / start - 1) * 100
      byTs.set(p.ts, row)
    }
    // Referința se desenează prima, ca liniile strategiilor să stea deasupra ei.
    const ordered = [...seen].sort((a, b) => (a === REFERENCE_KEY ? -1 : b === REFERENCE_KEY ? 1 : 0))
    const sorted = [...byTs.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
    return { rows: sorted, keys: ordered }
  }, [equity.data, startByKey])

  // Punctele sunt orare: o etichetă per zi, altfel „23 sept." apare de patru ori pe axă.
  const dayTicks = useMemo(() => {
    const seen = new Set<string>()
    return rows.map((r) => String(r.ts)).filter((ts) => {
      const day = ts.slice(0, 10)
      if (seen.has(day)) return false
      seen.add(day)
      return true
    })
  }, [rows])

  return (
    <section className="space-y-3" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-sm font-semibold">
          {t('common:bot.equity.title')}
        </h2>
        <div role="group" aria-label={t('common:labels.period')} className="flex rounded-md bg-muted p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                'h-7 rounded px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
                range === r.key && 'bg-background text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {equity.isPending ? (
        <ChartSkeleton height={HEIGHT} />
      ) : equity.isError ? (
        <ChartError message={t('common:bot.equity.loadFailed')} />
      ) : rows.length < 2 ? (
        <ChartEmpty label={t('common:bot.equity.tooFewPoints')} />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={HEIGHT}>
            <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
              <XAxis
                dataKey="ts"
                ticks={dayTicks}
                interval="preserveStartEnd"
                tickFormatter={formatTick}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
              />
              <YAxis
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={52}
                domain={['auto', 'auto']}
              />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
              <Tooltip
                labelFormatter={(ts: string) =>
                  new Date(ts).toLocaleString(intlTag(), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                }
                formatter={(value: number, key: string) => [formatPct(value), labelByKey.get(key) ?? key]}
                itemSorter={(item) => -(item.value as number)}
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 6,
                  color: 'hsl(var(--popover-foreground))',
                  fontSize: 12,
                }}
              />
              {keys.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={strategyColor(key)}
                  strokeWidth={key === 'mix' ? 2.5 : 2}
                  strokeDasharray={key === REFERENCE_KEY ? '4 4' : undefined}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t('common:bot.equity.legend')}>
            {keys.map((key) => (
              <li key={key} className="inline-flex items-center gap-1.5">
                <svg width="16" height="8" aria-hidden="true">
                  <line
                    x1="0"
                    y1="4"
                    x2="16"
                    y2="4"
                    stroke={strategyColor(key)}
                    strokeWidth="2"
                    strokeDasharray={key === REFERENCE_KEY ? '4 3' : undefined}
                  />
                </svg>
                {labelByKey.get(key) ?? key}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function formatTick(ts: string): string {
  return new Date(ts).toLocaleDateString(intlTag(), {
    day: 'numeric',
    month: 'short',
  })
}
