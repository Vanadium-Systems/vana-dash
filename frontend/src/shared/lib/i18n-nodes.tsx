import { Fragment, type ReactNode } from 'react'
import { t, type TKey, type TParams } from './i18n'

const MARK = '\u0000'

/**
 * A translated sentence with React elements in place of some variables: a value in a
 * monospace span, a link, a `<code>`. The translator moves `{{name}}` around as the language
 * needs; the element comes along.
 */
export function tNodes(key: TKey, nodes: Record<string, ReactNode>): ReactNode {
  const marks = Object.fromEntries(Object.keys(nodes).map((name) => [name, `${MARK}${name}${MARK}`]))
  return t(key, marks)
    .split(MARK)
    .map((part, index) => (index % 2 === 1 ? <Fragment key={index}>{nodes[part]}</Fragment> : part))
}

const TAGS = /<(b|code|mono)>(.*?)<\/\1>/g

/**
 * A translated text with light emphasis written in the text itself: `<b>bold</b>`,
 * `<code>code</code>`, `<mono>monospace</mono>`. For long instructions where naming every
 * emphasized word as a variable would hide the sentence from the translator.
 */
export function tRich(key: TKey, params?: TParams): ReactNode {
  const text = t(key, params)
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TAGS)) {
    const [whole, tag, inner] = match
    out.push(text.slice(last, match.index))
    if (tag === 'b') out.push(<strong key={match.index}>{inner}</strong>)
    else if (tag === 'code') out.push(<code key={match.index} className="font-mono">{inner}</code>)
    else out.push(<span key={match.index} className="font-mono">{inner}</span>)
    last = match.index + whole.length
  }
  out.push(text.slice(last))
  return out
}
