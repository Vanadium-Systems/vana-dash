import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { EntityChip } from './EntityChip'

// Randarea textului asistentului (Contract E): markdown GFM + referințele [[type:id|etichetă]]
// extrase ÎNAINTEA randării (pre-pass pe text, nu pe HTML — Contract A). Fără raw HTML:
// react-markdown nu-l randează implicit.

const REF_SPLIT = /(\[\[[a-z_-]+:[^\]|]+\|[^\]]+\]\])/g
const REF_MATCH = /\[\[([a-z_-]+):([^\]|]+)\|([^\]]+)\]\]/

type Segment =
  | { kind: 'md'; text: string }
  | { kind: 'ref'; type: string; id: string; label: string }

function splitSegments(text: string): Segment[] {
  const out: Segment[] = []
  for (const chunk of text.split(REF_SPLIT)) {
    if (!chunk) continue
    const match = chunk.match(REF_MATCH)
    if (match && match[1] && match[2] && match[3]) {
      out.push({ kind: 'ref', type: match[1], id: match[2], label: match[3].trim() })
    } else {
      out.push({ kind: 'md', text: chunk })
    }
  }
  return out
}

export function AssistantText({ text }: { text: string }) {
  return (
    <>
      {splitSegments(text).map((seg, i) =>
        seg.kind === 'ref' ? (
          <EntityChip key={i} type={seg.type} id={seg.id} label={seg.label} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {children}
                </a>
              ),
              table: ({ children }) => (
                // Fixed layout with wrapping cells: a table in an answer never scrolls sideways on a phone.
                <div className="my-2 rounded-md border">
                  <table className="w-full table-fixed border-collapse text-xs">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="break-words border-b bg-muted/50 px-2 py-1 text-left font-medium">{children}</th>
              ),
              td: ({ children }) => <td className="break-words border-b px-2 py-1 align-top">{children}</td>,
              code: ({ children, ...rest }) =>
                // bloc de cod (multi-linie) vs inline
                typeof children === 'string' && !children.includes('\n') ? (
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs" {...rest}>
                    {children}
                  </code>
                ) : (
                  <code className="block whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs" {...rest}>
                    {children}
                  </code>
                ),
              pre: ({ children }) => <pre className="my-2">{children}</pre>,
            }}
          >
            {seg.text}
          </ReactMarkdown>
        ),
      )}
    </>
  )
}
