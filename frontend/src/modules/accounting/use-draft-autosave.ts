import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '@/shared/lib/api'
import { useInvalidateRecords } from './records-api'
import type { DocumentKind, DraftPayload } from './invoice-editor-logic'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

const base = (kind: DocumentKind) => (kind === 'proforma' ? '/api/invoicing/proformas' : '/api/invoicing/invoices')

interface Options {
  kind: DocumentKind
  /** The draft as loaded; null = nothing on the server yet. */
  initial: { id: string; updatedAt: string | undefined } | null
  /** Serialized form when valid, null otherwise. Equal strings = nothing to save. */
  key: string | null
  payload: DraftPayload | null
}

const CREATE_DELAY_MS = 300
const SAVE_DELAY_MS = 1500

export function useDraftAutosave({ kind, initial, key, payload }: Options) {
  const navigate = useNavigate()
  const invalidate = useInvalidateRecords()
  const [draftId, setDraftId] = useState(initial?.id ?? null)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // The key last confirmed by the server; the first render's key is the loaded draft, so loading saves nothing.
  const [savedKey, setSavedKey] = useState(key)
  const [tick, setTick] = useState(0)
  const updatedAt = useRef(initial?.updatedAt)
  const idRef = useRef(draftId)
  const inFlight = useRef(false)
  const failedKey = useRef<string | null>(null)
  const latest = useRef({ key, payload })
  latest.current = { key, payload }
  const savedOnce = useRef(false)

  useEffect(() => {
    if (!key || key === savedKey || key === failedKey.current || status === 'conflict' || inFlight.current) return
    const timer = setTimeout(() => void run(), idRef.current ? SAVE_DELAY_MS : CREATE_DELAY_MS)
    return () => clearTimeout(timer)
    // run reads everything through refs, so it is not a dependency
  }, [key, savedKey, status, tick])

  // The lists and the record page must not keep showing the draft as it was before editing.
  useEffect(() => () => {
    if (savedOnce.current) invalidate()
  }, [])

  async function run() {
    const { key: sentKey, payload: body } = latest.current
    if (!sentKey || !body) return
    inFlight.current = true
    setStatus('saving')
    try {
      const id = idRef.current
      const saved = id
        ? await api.patch<{ id: string; updatedAt: string }>(`${base(kind)}/${id}`, { ...body, expectedUpdatedAt: updatedAt.current })
        : await api.post<{ id: string; updatedAt: string }>(base(kind), body)
      updatedAt.current = saved.updatedAt
      savedOnce.current = true
      failedKey.current = null
      setSavedKey(sentKey)
      setSavedAt(new Date())
      setErrorMessage(null)
      setStatus('saved')
      if (!id) {
        idRef.current = saved.id
        setDraftId(saved.id)
        // A reload keeps the draft; the same page instance stays mounted, so typing is not interrupted.
        navigate(`/accounting/records/${saved.id}/edit`, { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DRAFT_CHANGED') {
        setStatus('conflict')
      } else {
        failedKey.current = sentKey
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    } finally {
      inFlight.current = false
      setTick((n) => n + 1)
    }
  }

  const pending = Boolean(key) && key !== savedKey && status !== 'conflict' && status !== 'error'
  return { draftId, status, savedAt, errorMessage, savedKey, pending, saving: status === 'saving' }
}
