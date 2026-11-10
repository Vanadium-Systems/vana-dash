/** Stands in for XMLHttpRequest in the voice upload tests: the test decides when and how each request ends. */
export class FakeXhr {
  static all: FakeXhr[] = []
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  status = 0
  responseText = ''
  withCredentials = false
  sent: FormData | null = null
  aborted = false
  constructor() {
    FakeXhr.all.push(this)
  }
  open() {}
  setRequestHeader() {}
  send(body: FormData) {
    this.sent = body
  }
  abort() {
    this.aborted = true
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total })
  }
  finish(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }
}
