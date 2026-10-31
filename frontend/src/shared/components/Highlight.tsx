import { Fragment } from 'react'

const fold = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Where `query` words occur in `text`, ignoring case and diacritics (ș/ş/s, ț/ţ/t, ă/â/a, î/i).
 * Ranges index the ORIGINAL text: folding is done per character, because it can change the length.
 */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
  const words = query.split(/\s+/).map(fold).filter(Boolean)
  if (words.length === 0) return []

  let folded = ''
  const originStart: number[] = []
  const originEnd: number[] = []
  let position = 0
  for (const char of text) {
    for (const foldedChar of fold(char)) {
      for (let i = 0; i < foldedChar.length; i++) {
        originStart.push(position)
        originEnd.push(position + char.length)
      }
      folded += foldedChar
    }
    position += char.length
  }

  const found: Array<[number, number]> = []
  for (const word of words) {
    for (let from = folded.indexOf(word); from !== -1; from = folded.indexOf(word, from + word.length)) {
      found.push([originStart[from]!, originEnd[from + word.length - 1]!])
    }
  }

  found.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of found) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  return merged
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = highlightRanges(text, query)
  if (ranges.length === 0) return <>{text}</>

  let cursor = 0
  return (
    <>
      {ranges.map(([start, end]) => {
        const before = text.slice(cursor, start)
        cursor = end
        return (
          <Fragment key={start}>
            {before}
            <mark className="rounded-sm bg-warning/25 text-inherit">{text.slice(start, end)}</mark>
          </Fragment>
        )
      })}
      {text.slice(cursor)}
    </>
  )
}
