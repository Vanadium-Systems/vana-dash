/** Whether rich-text HTML has anything a reader would see: text or an image. Parsed, not regex-stripped. */
export function htmlHasContent(html: string): boolean {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  return Boolean(body.querySelector('img')) || (body.textContent ?? '').replace(/\u00a0/g, ' ').trim() !== ''
}
