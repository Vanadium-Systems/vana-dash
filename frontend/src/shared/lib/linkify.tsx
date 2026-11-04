// Plain text with links: only URL-looking parts become links, the rest stays text that React
// escapes. A link always opens in a new tab (in the APK, in the phone's browser), so the page
// the person was reading stays where it was.

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"')\]]+)/g

export function linkify(text: string, linkClassName = 'underline hover:no-underline') {
  return text.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return part
    const trailing = /[.,;:!?)\]]+$/.exec(part)?.[0] ?? ''
    const url = trailing ? part.slice(0, -trailing.length) : part
    const href = url.startsWith('www.') ? `https://${url}` : url
    return (
      <span key={i}>
        <a href={href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
          {url}
        </a>
        {trailing}
      </span>
    )
  })
}
