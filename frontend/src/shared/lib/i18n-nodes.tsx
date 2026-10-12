import { Fragment, type ReactNode } from 'react'
import { t, type TKey } from './i18n'

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
