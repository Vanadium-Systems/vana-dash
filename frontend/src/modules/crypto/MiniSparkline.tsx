interface MiniSparklineProps {
  values: number[]
  width?: number
  height?: number
}

/** SVG pur, fără axe — aceeași filozofie ca RuleSparkline din Alerts. */
export function MiniSparkline({ values, width = 96, height = 28 }: MiniSparklineProps) {
  if (values.length < 2) return <span className="text-xs text-muted-foreground">—</span>

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = width / (values.length - 1)
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${(height - 1 - ((v - min) / span) * (height - 2)).toFixed(2)}`)
    .join(' ')
  const up = values[values.length - 1]! >= values[0]!

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <path d={path} fill="none" strokeWidth="1.5" className={up ? 'stroke-success-text' : 'stroke-destructive-text'} />
    </svg>
  )
}
