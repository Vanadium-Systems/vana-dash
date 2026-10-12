import { useMemo, useState } from 'react'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
}

interface CandleChartProps {
  candles: Candle[]
  height?: number
}

/** Grafic OHLC în candele — SVG pur (aceeași abordare ca MiniSparkline/RuleSparkline):
 *  Recharts nu are candlesticks native, iar o librărie de charts nouă doar pt. asta ar fi
 *  bloat. Hover pe candele → tooltip nativ <title> (zero JS de mouse-handling). */
export function CandleChart({ candles, height = 320 }: CandleChartProps) {
  const [hovered, setHovered] = useState<Candle | null>(null)
  const W = 1000
  const H = height
  const PAD = { top: 12, right: 64, bottom: 26, left: 8 }

  const { xs, bodyW, wickW, min, max, priceTicks, timeTicks, candleAt } = useMemo(() => {
    if (candles.length < 2) {
      return {
        xs: [] as number[],
        bodyW: 0,
        wickW: 0,
        min: 0,
        max: 0,
        priceTicks: [] as Array<{ v: number; y: number }>,
        timeTicks: [] as Array<{ x: number; label: string }>,
        candleAt: (_x: number) => null as Candle | null,
      }
    }
    const lows = candles.map((c) => c.l)
    const highs = candles.map((c) => c.h)
    const rawMin = Math.min(...lows)
    const rawMax = Math.max(...highs)
    const span = rawMax - rawMin || rawMax || 1
    const min = rawMin - span * 0.05
    const max = rawMax + span * 0.05

    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const slot = innerW / candles.length
    const bodyW = Math.max(2, Math.min(18, slot * 0.6))
    const wickW = Math.max(1, bodyW * 0.18)
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH
    const x = (i: number) => PAD.left + slot * i + slot / 2

    const priceTicks = Array.from({ length: 5 }, (_, i) => {
      const v = min + ((max - min) * i) / 4
      return { v, y: y(v) }
    })

    const labelEvery = Math.max(1, Math.ceil(candles.length / 6))
    const timeTicks = candles
      .map((c, i) => ({ i, c }))
      .filter(({ i }) => i % labelEvery === 0)
      .map(({ i, c }) => ({
        x: x(i),
        label: new Date(c.t).toLocaleString(intlTag(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      }))

    const candleAt = (px: number): Candle | null => {
      const i = Math.floor((px - PAD.left) / slot)
      return candles[i] ?? null
    }

    return { xs: candles.map((_, i) => x(i)), bodyW, wickW, min, max, priceTicks, timeTicks, candleAt }
  }, [candles, H])

  if (candles.length < 2) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{t('crypto:chart.candlesUnavailable')}</p>
  }

  const fmt = (v: number) => formatPrice(v)

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        style={{ height }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          setHovered(candleAt(px))
        }}
        onMouseLeave={() => setHovered(null)}
        data-testid="crypto-candle-chart"
      >
        {/* grid + etichete de preț */}
        {priceTicks.map((tick) => (
          <g key={tick.v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={tick.y} y2={tick.y} className="stroke-border" strokeDasharray="3 3" strokeWidth={1} />
            <text x={W - PAD.right + 6} y={tick.y + 4} fontSize={11} className="fill-muted-foreground font-mono">
              {fmt(tick.v)}
            </text>
          </g>
        ))}

        {/* candele: fiting (linie subțire) + corp (rect) */}
        {candles.map((c, i) => {
          const up = c.c >= c.o
          const colorClass = up ? 'stroke-success-text fill-success-text' : 'stroke-destructive-text fill-destructive-text'
          const cx = xs[i]!
          const bodyTop = Math.min(c.o, c.c)
          const bodyBottom = Math.max(c.o, c.c)
          const innerH = H - PAD.top - PAD.bottom
          const yOf = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH
          const bodyY = yOf(bodyBottom)
          const bodyH = Math.max(1, yOf(bodyTop) - bodyY)
          return (
            <g key={c.t} className={colorClass}>
              <line x1={cx} x2={cx} y1={yOf(c.h)} y2={yOf(c.l)} strokeWidth={wickW} />
              <rect x={cx - bodyW / 2} y={bodyY} width={bodyW} height={bodyH} rx={1}>
                <title>{`${new Date(c.t).toLocaleString(intlTag())} — O: ${fmt(c.o)}  H: ${fmt(c.h)}  L: ${fmt(c.l)}  C: ${fmt(c.c)}`}</title>
              </rect>
            </g>
          )
        })}

        {/* etichete de timp */}
        {timeTicks.map((tick) => (
          <text key={tick.x} x={tick.x} y={H - 8} fontSize={11} textAnchor="middle" className="fill-muted-foreground">
            {tick.label}
          </text>
        ))}
      </svg>

      {hovered ? (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border bg-popover px-2 py-1 font-mono text-xs shadow-sm">
          <span className="text-muted-foreground">{new Date(hovered.t).toLocaleString(intlTag(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          {'  '}O {fmt(hovered.o)} H {fmt(hovered.h)} L {fmt(hovered.l)} C{' '}
          <span className={hovered.c >= hovered.o ? 'text-success-text' : 'text-destructive-text'}>{fmt(hovered.c)}</span>
        </div>
      ) : null}
    </div>
  )
}

function formatPrice(v: number): string {
  if (Math.abs(v) >= 1000) return `${v.toLocaleString(intlTag(), { maximumFractionDigits: 0 })}$`
  if (Math.abs(v) >= 1) return `${v.toLocaleString(intlTag(), { maximumFractionDigits: 2 })}$`
  return `${v.toPrecision(4)}$`
}
