import type { CSSProperties } from 'react'

const MODELS = ['rz-s1', 'rz-s2', 'rz-s3', 'rz-s4', 'rz-s5', 'rz-s7', 'rz-s8', 'rz-s10'] as const

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The class and the pouring of one piece of resin, from a seed of its content (stable across loads). */
export function rasina(seed: string): { className: string; style: CSSProperties } {
  const h = hash(seed)
  const pick = (shift: number, min: number, span: number) => min + ((h >>> shift) % 1000) / 1000 * span
  return {
    className: `rz ${MODELS[h % MODELS.length]}`,
    style: {
      '--x': `${pick(3, 20, 60).toFixed(1)}%`,
      '--y': `${pick(7, 25, 50).toFixed(1)}%`,
      '--a': `${pick(11, 60, 100).toFixed(0)}deg`,
      '--s': pick(15, 0.8, 0.5).toFixed(2),
      '--dl': `-${pick(19, 0, 18).toFixed(1)}s`,
    } as CSSProperties,
  }
}
