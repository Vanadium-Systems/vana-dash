import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Textarea } from '@/shared/components/ui/textarea'
import { api, ApiError } from '@/shared/lib/api'
import { errorText } from '@/shared/lib/errors'
import { formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

interface PublicRequest {
  company: string
  title: string
  signerName: string
  signerEmail: string
  status: 'opened' | 'signed' | 'declined' | 'revoked' | 'expired' | 'locked'
  expiresAt: string
  canDownload: boolean
}

type Step = 'intro' | 'code' | 'read' | 'done' | 'declined'

const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 200

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">{children}</div>
    </main>
  )
}

/** Drawn with a finger or the mouse; typed names are drawn on the same canvas, so the server always gets a PNG. */
function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [typed, setTyped] = useState('')

  const context = () => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return null
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#14213d'
    ctx.fillStyle = '#14213d'
    return ctx
  }

  const clear = () => {
    context()?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    onChange(null)
  }

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH, y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT }
  }

  useEffect(() => {
    if (mode !== 'type') return
    const ctx = context()
    if (!ctx) return
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    if (!typed.trim()) return onChange(null)
    ctx.font = 'italic 56px "Brush Script MT", "Segoe Script", cursive'
    ctx.textBaseline = 'middle'
    ctx.fillText(typed.trim(), 20, CANVAS_HEIGHT / 2, CANVAS_WIDTH - 40)
    onChange(canvasRef.current!.toDataURL('image/png'))
  }, [typed, mode]) // onChange is a state setter from the parent, stable across renders

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('signing:pad.mode')}>
        <Button type="button" size="sm" variant={mode === 'draw' ? 'default' : 'outline'} onClick={() => { setMode('draw'); clear() }}>
          {t('signing:pad.draw')}
        </Button>
        <Button type="button" size="sm" variant={mode === 'type' ? 'default' : 'outline'} onClick={() => { setMode('type'); clear() }}>
          {t('signing:pad.type')}
        </Button>
      </div>
      {mode === 'type' ? (
        <Field label={t('signing:pad.typedLabel')}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="name" />
        </Field>
      ) : null}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        aria-label={t('signing:pad.canvas')}
        className="w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => {
          if (mode !== 'draw') return
          drawing.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          const ctx = context()
          const p = point(e)
          ctx?.beginPath()
          ctx?.moveTo(p.x, p.y)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = context()
          const p = point(e)
          ctx?.lineTo(p.x, p.y)
          ctx?.stroke()
        }}
        onPointerUp={() => {
          if (!drawing.current) return
          drawing.current = false
          onChange(canvasRef.current!.toDataURL('image/png'))
        }}
      />
      {mode === 'draw' ? (
        <Button type="button" size="sm" variant="ghost" onClick={clear}>
          <X className="h-4 w-4" /> {t('signing:pad.clear')}
        </Button>
      ) : null}
    </div>
  )
}

export function PublicSignPage() {
  const { token = '' } = useParams()
  const base = `/api/public/sign/${token}`
  const [step, setStep] = useState<Step>('intro')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [signature, setSignature] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const qesInput = useRef<HTMLInputElement>(null)

  const request = useQuery({ queryKey: ['public-sign', token], queryFn: () => api.get<PublicRequest>(base), retry: false })

  const sendCode = useMutation({
    mutationFn: () => api.post<{ sentTo: string }>(`${base}/otp`),
    onSuccess: () => setStep('code'),
  })
  const verify = useMutation({
    mutationFn: () => api.post<{ pageCount: number }>(`${base}/verify`, { code }),
    onSuccess: (data) => {
      setPageCount(data.pageCount)
      setCodeError(null)
      setStep('read')
    },
    onError: (err) => setCodeError(errorText(err)),
  })
  // The 15-minute session after the code has run out: back to the code, with the reason.
  const onSessionError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      setCode('')
      setCodeError(t('signing:sessionExpired'))
      setStep('intro')
      return
    }
    setSignError(errorText(err))
  }
  const sign = useMutation({
    mutationFn: () => api.post(`${base}/sign`, { signaturePng: signature, consent: true }),
    onSuccess: () => {
      setStep('done')
      void request.refetch()
    },
    onError: onSessionError,
  })
  const decline = useMutation({
    mutationFn: () => api.post(`${base}/decline`, { reason: reason.trim() }),
    onSuccess: () => setStep('declined'),
    onError: onSessionError,
  })
  const uploadQes = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload(`${base}/upload-qes`, form)
    },
    onSuccess: () => {
      setStep('done')
      void request.refetch()
    },
    onError: onSessionError,
  })

  if (request.isPending) {
    return (
      <Shell>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </Shell>
    )
  }

  const data = request.data
  const closedReason = request.isError
    ? errorText(request.error)
    : data && data.status !== 'opened' && data.status !== 'signed'
      ? t(`signing:closed.${data.status}`)
      : null

  if (closedReason || !data) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">{t('signing:closed.title')}</h1>
        <p className="text-muted-foreground">{closedReason}</p>
      </Shell>
    )
  }

  const header = (
    <header className="space-y-1">
      <p className="text-sm text-muted-foreground">{t('signing:from', { company: data.company })}</p>
      <h1 className="text-2xl font-semibold">{data.title}</h1>
    </header>
  )

  if (data.status === 'signed' || step === 'done') {
    return (
      <Shell>
        {header}
        <p>{t('signing:done.body', { name: data.signerName })}</p>
        {data.canDownload ? (
          <Button asChild>
            <a href={`${base}/download`}>
              <Download className="h-4 w-4" /> {t('signing:done.download')}
            </a>
          </Button>
        ) : null}
      </Shell>
    )
  }

  if (step === 'declined') {
    return (
      <Shell>
        {header}
        <p>{t('signing:declined')}</p>
      </Shell>
    )
  }

  if (step === 'intro' || step === 'code') {
    return (
      <Shell>
        {header}
        <p>{t('signing:intro', { name: data.signerName, company: data.company, date: formatDate(data.expiresAt, { dateStyle: 'long' }) })}</p>
        {step === 'intro' ? (
          <div className="space-y-2">
            {codeError ? <p className="text-sm text-destructive">{codeError}</p> : null}
            <Button disabled={sendCode.isPending} onClick={() => sendCode.mutate()}>
              {t('signing:sendCode', { email: data.signerEmail })}
            </Button>
            {sendCode.isError ? <p className="text-sm text-destructive">{errorText(sendCode.error)}</p> : null}
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!/^\d{6}$/.test(code)) return setCodeError(t('signing:codeFormat'))
              verify.mutate()
            }}
          >
            <Field label={t('signing:codeLabel', { email: data.signerEmail })} error={codeError}>
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="w-40 text-lg tracking-widest" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={verify.isPending}>
                {t('signing:confirmCode')}
              </Button>
              <Button type="button" variant="ghost" disabled={sendCode.isPending} onClick={() => sendCode.mutate()}>
                {t('signing:resendCode')}
              </Button>
            </div>
            {sendCode.isError ? <p className="text-sm text-destructive">{errorText(sendCode.error)}</p> : null}
          </form>
        )}
      </Shell>
    )
  }

  return (
    <Shell>
      {header}
      <p className="text-sm text-muted-foreground">{t('signing:readFirst')}</p>
      <div className="space-y-3">
        {Array.from({ length: pageCount }, (_, i) => (
          <img
            key={i}
            src={`${base}/pages/${i + 1}`}
            alt={t('signing:pageAlt', { n: i + 1, total: pageCount })}
            loading="lazy"
            className="w-full rounded-md border bg-white"
          />
        ))}
      </div>
      <a className="inline-flex items-center gap-2 text-sm underline underline-offset-4" href={`${base}/download`}>
        <Download className="h-4 w-4" /> {t('signing:downloadToRead')}
      </a>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-semibold">{t('signing:signTitle')}</h2>
        <SignaturePad onChange={setSignature} />
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
          <span>{t('signing:consent', { company: data.company })}</span>
        </label>
        <p className="text-xs text-muted-foreground">{t('signing:privacy', { company: data.company })}</p>
        {signError ? <p className="text-sm text-destructive">{signError}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={sign.isPending}
            onClick={() => {
              if (!signature) return setSignError(t('signing:needSignature'))
              if (!consent) return setSignError(t('signing:needConsent'))
              setSignError(null)
              sign.mutate()
            }}
          >
            {sign.isPending ? t('signing:signing') : t('signing:sign')}
          </Button>
          <Button variant="ghost" onClick={() => setDeclining((v) => !v)}>
            {t('signing:decline')}
          </Button>
        </div>
        {declining ? (
          <div className="space-y-2">
            <Field label={t('signing:declineReason')}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </Field>
            <Button variant="outline" disabled={!reason.trim() || decline.isPending} onClick={() => decline.mutate()}>
              {t('signing:declineConfirm')}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-2 border-t pt-6">
        <h2 className="text-base font-semibold">{t('signing:qesTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('signing:qesBody')}</p>
        <input
          ref={qesInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadQes.mutate(file)
            e.target.value = ''
          }}
        />
        <Button variant="outline" disabled={uploadQes.isPending} onClick={() => qesInput.current?.click()}>
          {t('signing:qesUpload')}
        </Button>
      </section>
    </Shell>
  )
}
