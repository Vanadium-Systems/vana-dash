// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UploadPanel } from './UploadPanel'
import { enqueueUploads, resetUploads } from './uploads'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeXhr {
  static all: FakeXhr[] = []
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number }) => void) | null } = { onprogress: null }
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
  progress(loaded: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded })
  }
  finish(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }
}

let container: HTMLDivElement
let root: Root
const RealXhr = globalThis.XMLHttpRequest

beforeEach(() => {
  FakeXhr.all = []
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<UploadPanel />))
})

afterEach(() => {
  act(() => resetUploads())
  act(() => root.unmount())
  container.remove()
  globalThis.XMLHttpRequest = RealXhr
})

const file = (name: string, size: number) => new File([new Uint8Array(size)], name)
const queue = (...files: File[]) => act(() => enqueueUploads(files, { folderId: 'folder-1', folderName: 'Contracte' }))
const text = () => container.textContent ?? ''

describe('UploadPanel', () => {
  it('shows nothing until a file is queued', () => {
    expect(container.querySelector('section')).toBeNull()
  })

  it('sends the folder before the file and shows the progress of the transfer', () => {
    queue(file('factura.pdf', 1000))
    const xhr = FakeXhr.all[0]!
    expect([...xhr.sent!.keys()]).toEqual(['folderId', 'file'])
    expect(xhr.withCredentials).toBe(true)

    act(() => xhr.progress(500))
    expect(text()).toContain('factura.pdf')
    expect(text()).toContain('50%')
    expect(text()).toContain('Se încarcă 1 fișier')
  })

  it('marks a finished file and the batch', () => {
    queue(file('a.pdf', 100))
    act(() => FakeXhr.all[0]!.finish(200, { success: true, data: {} }))
    expect(container.querySelector('[data-upload-status="done"]')).not.toBeNull()
    expect(text()).toContain('1 fișier încărcat')
  })

  it('says the storage is full on that file, not in a generic message', () => {
    queue(file('mare.zip', 100))
    const gb = 1024 ** 3
    act(() => FakeXhr.all[0]!.finish(413, { success: false, error: 'plin', code: 'STORAGE_FULL', usedBytes: 10 * gb, limitBytes: 10 * gb }))
    const row = container.querySelector('[data-upload-status="error"]')!
    expect(row.textContent).toContain('Arhiva e plină')
    expect(row.textContent).toContain('10.0 GB')
  })

  it('tells a file that is too big from a full archive', () => {
    queue(file('uriasa.mov', 100))
    act(() => FakeXhr.all[0]!.finish(413, { success: false, error: 'prea mare' }))
    expect(container.querySelector('[data-upload-status="error"]')!.textContent).toContain('200 MB')
  })

  it('retries a failed file with a new request', () => {
    queue(file('a.pdf', 100))
    act(() => FakeXhr.all[0]!.finish(502, { success: false, error: 'Încărcarea a eșuat' }))
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Reîncearcă'))!
    act(() => retry.click())
    expect(FakeXhr.all).toHaveLength(2)
    act(() => FakeXhr.all[1]!.finish(200, { success: true, data: {} }))
    expect(container.querySelector('[data-upload-status="done"]')).not.toBeNull()
  })

  it('cancels a transfer in flight', () => {
    queue(file('a.pdf', 100))
    const cancel = container.querySelector<HTMLButtonElement>('button[aria-label="Anulează"]')!
    act(() => cancel.click())
    expect(FakeXhr.all[0]!.aborted).toBe(true)
    expect(container.querySelector('[data-upload-status="canceled"]')).not.toBeNull()
  })

  it('runs three at a time and starts the next when one ends', () => {
    queue(file('1', 1), file('2', 1), file('3', 1), file('4', 1))
    expect(FakeXhr.all).toHaveLength(3)
    act(() => FakeXhr.all[0]!.finish(200, { success: true, data: {} }))
    expect(FakeXhr.all).toHaveLength(4)
  })
})
