import { useMutation, useQuery } from '@tanstack/react-query'
import { Paperclip, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { readFileAsBase64, type PendingAttachment } from '@/shared/lib/attachments'
import type { BulkSendResult, EmailSend, EmailSenderOptions, EmailTemplate, Platform } from '@/shared/lib/types'
import { EngagementBadges } from './EngagementBadges'
import { IdentityField, useIdentityKey } from './IdentityField'
import { isFailureStatus, STATUS_LABEL, STATUS_TONE } from './send-status'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

const RECENT_BATCHES_LIMIT = 5

const MAX_RECIPIENTS = 50
const MAX_ATTACHMENTS = 5
const EMAIL_SHAPE_RE = /^\S+@\S+\.\S+$/

interface ParsedRecipient {
  email: string
  nume?: string
}

interface ParseResult {
  valid: ParsedRecipient[]
  invalid: string[]
}

function parseRecipients(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const valid: ParsedRecipient[] = []
  const invalid: string[] = []
  for (const line of lines) {
    // Doar prima virgulă separă email-ul de nume — un nume cu virgulă ("Popescu, Ion")
    // nu trebuie trunchiat la split pe TOATE virgulele.
    const commaIdx = line.indexOf(',')
    const emailRaw = (commaIdx === -1 ? line : line.slice(0, commaIdx)).trim()
    const numeRaw = commaIdx === -1 ? '' : line.slice(commaIdx + 1).trim()
    if (!emailRaw || emailRaw.toLowerCase() === 'email') continue // linie goală / header CSV
    if (!EMAIL_SHAPE_RE.test(emailRaw)) {
      invalid.push(line)
      continue
    }
    valid.push(numeRaw ? { email: emailRaw, nume: numeRaw } : { email: emailRaw })
  }
  return { valid, invalid }
}

export function BulkSendTab() {
  const [templateId, setTemplateId] = useState('')
  const [raw, setRaw] = useState('')
  const [platformId, setPlatformId] = useState('')
  // Contoare din răspunsul proaspăt al mutației — sărite(dedup)/dezabonați n-au rând în
  // email_sends (nimic de trimis pt. ele), deci nu pot fi reconstruite după un refresh; rămân
  // vizibile doar în sesiunea curentă. Trimise/eșuate SE pot reconstrui (vezi sendsByBatch mai
  // jos) — pt. alea folosim mereu sursa persistată, ca să rămână corecte chiar și proaspăt.
  // 2026-08-11 — ACUMULATE (array), nu un singur rezultat — bug raportat de Stefan: o listă bulk
  // nouă ștergea din vedere rezultatul listei anterioare. `batchIds` (plural) persistă în URL
  // ca listă separată prin virgulă, extinsă la fiecare send reușit, niciodată înlocuită.
  const [freshResults, setFreshResults] = useState<BulkSendResult[]>([])
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const batchIds = useMemo(() => (searchParams.get('batchIds') ?? '').split(',').filter(Boolean), [searchParams])

  // 2026-08-11 — la prima intrare pe tab, fără URL special, seedează batchIds cu ultimele
  // campanii (nu doar ce trimiți în sesiunea curentă) — Stefan a întrebat de ce nu vede istoricul
  // "în mod normal". O singură dată (nu re-suprascrie dacă a acumulat deja ceva în sesiune).
  const recentBatches = useQuery({
    queryKey: ['email', 'sends', 'recent-batches'],
    queryFn: () => api.get<string[]>(`/api/email/sends/recent-batches?limit=${RECENT_BATCHES_LIMIT}`),
    enabled: batchIds.length === 0,
  })
  useEffect(() => {
    if (batchIds.length > 0 || !recentBatches.data?.length) return
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('batchIds', recentBatches.data!.join(','))
      return next
    })
  }, [recentBatches.data])

  const addAttachments = async (files: FileList) => {
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast.error(t('email:bulk.maxAttachments', { MAX_ATTACHMENTS }))
      return
    }
    const toAdd = Array.from(files).slice(0, remaining)
    try {
      const encoded = await Promise.all(toAdd.map(readFileAsBase64))
      setAttachments((prev) => [...prev, ...encoded])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('email:attach.readFailed'))
    }
  }

  const templates = useQuery({
    queryKey: ['email', 'templates'],
    queryFn: () => api.get<EmailTemplate[]>('/api/email/templates'),
  })

  const settings = useQuery({
    queryKey: ['email', 'settings', 'sender-options'],
    queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options'),
  })
  const [from, setFrom] = useIdentityKey('contact', settings.data?.identities)

  const platforms = useQuery({
    queryKey: ['platforms'],
    queryFn: () => api.get<Platform[]>('/api/platforms'),
  })

  // "Trimite la clienții din <platformă>" — încarcă clienții activi (aceiași ca la facturare,
  // vezi invoicing/listClients) direct în textarea, ca un CSV urcat manual. Nu trimite nimic
  // singur — doar populează destinatarii, restul fluxului (template, from, buton Trimite)
  // rămâne neschimbat.
  const loadPlatformClients = useMutation({
    mutationFn: (id: string) => api.get<{ email: string; nume: string }[]>(`/api/email/platform-clients/${id}`),
    onSuccess: (clients, id) => {
      if (clients.length === 0) {
        toast.warning(t('email:bulk.noActiveClients'))
        return
      }
      setRaw(clients.map((c) => `${c.email},${c.nume}`).join('\n'))
      const platformName = platforms.data?.find((p) => p.id === id)?.name ?? t('email:bulk.platformFallback')
      toast.success(t('email:bulk.clientsLoaded', { count: clients.length, platformName }))
    },
    onError: (err) => toast.error(err.message),
  })

  const { valid: recipients, invalid: invalidLines } = useMemo(() => parseRecipients(raw), [raw])
  const tooMany = recipients.length > MAX_RECIPIENTS

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setRaw(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const send = useMutation({
    mutationFn: () =>
      api.post<BulkSendResult>('/api/email/bulk-send', {
        templateId,
        recipients,
        from,
        ...(attachments.length ? { attachments } : {}),
      }),
    onSuccess: (data) => {
      setFreshResults((prev) => [...prev, data])
      // Persistă în URL, ADĂUGAT la lista existentă — un refresh reîncarcă statusul din DB
      // (vezi sendsByBatch mai jos) în loc să piardă totul din state local. Niciun rând creat
      // (toți destinatarii dedup/dezabonați) → niciun batchId nou de adăugat, nimic de persistat.
      const newBatchId = data.results[0]?.batchId
      if (newBatchId) {
        setSearchParams((prev) => {
          const existing = (prev.get('batchIds') ?? '').split(',').filter(Boolean)
          const next = new URLSearchParams(prev)
          next.set('batchIds', [...existing, newBatchId].join(','))
          return next
        })
      }
      const capNote = data.capBlockedRecipients.length ? t('email:bulk.capNote', { count: data.capBlockedRecipients.length }) : ''
      toast.success(t('email:bulk.resultToast', { sent: data.sent, skipped: data.skipped, suppressed: data.suppressed, failed: data.failed, capNote }))
    },
    onError: (err) => toast.error(err.message),
  })

  // Sursa persistată pt. tabelul detaliat — supraviețuiește unui refresh, spre deosebire de
  // freshResults (ephemeral). enabled doar când avem cel puțin un batchId (fie din mutație, fie
  // din URL la încărcarea paginii).
  const sendsByBatch = useQuery({
    queryKey: ['email', 'sends', 'batch', batchIds],
    queryFn: () => api.get<{ items: EmailSend[]; total: number }>(`/api/email/sends?batchIds=${batchIds.join(',')}`),
    enabled: batchIds.length > 0,
  })

  const persistedRows = sendsByBatch.data?.items ?? []
  // status trece prin sent → delivered/bounced/delayed (webhook Resend) — un check `=== 'sent'`
  // arăta "Eșuat" pe orice email deja livrat (bug raportat live de Stefan: primea emailul, dar
  // dash-ul zicea eșuat). `isFailureStatus` = doar failed/bounced/complained sunt probleme reale.
  const sentCount = persistedRows.filter((r) => !isFailureStatus(r.status)).length
  const failedCount = persistedRows.filter((r) => isFailureStatus(r.status)).length
  // Sărit/dezabonat NU creează niciun rând în email_sends (nimic de trimis) — de-aia
  // freshResults[].skippedRecipients/suppressedRecipients (ephemeral, doar din răspunsurile
  // mutației, nu din DB) sunt singura sursă care arată CUI anume, nu doar un număr. Bug raportat
  // live de Stefan: la un batch complet dedup (sent:0), cardul nici nu apărea — acum apare
  // oricând avem fie un batchId de urmărit, fie măcar un răspuns proaspăt de arătat.
  const showResults = batchIds.length > 0 || freshResults.length > 0
  const skippedRows = freshResults.flatMap((r, i) => r.skippedRecipients.map((email) => ({ email, key: `skip-${i}-${email}` })))
  const suppressedRows = freshResults.flatMap((r, i) => r.suppressedRecipients.map((email) => ({ email, key: `sup-${i}-${email}` })))
  const capBlockedRows = freshResults.flatMap((r, i) => r.capBlockedRecipients.map((email) => ({ email, key: `cap-${i}-${email}` })))

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="b-template">{t('email:labels.template')}</Label>
            <Select
              id="b-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={templates.isError}
              required
            >
              <option value="">{t('email:bulk.pickTemplate')}</option>
              {templates.data?.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
            {templates.isError ? <p className="text-sm text-destructive">{t('email:templates.loadFailed')}</p> : null}
          </div>

          <IdentityField id="b-from" value={from} onChange={setFrom} identities={settings.data?.identities} />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t('email:attach.count', { count: attachments.length, MAX_ATTACHMENTS })}</Label>
              <Button
                type="button"
                variant="outline"
                disabled={attachments.length >= MAX_ATTACHMENTS}
                onClick={() => attachmentInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" /> {t('email:attach.addFile')}
              </Button>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void addAttachments(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
            {attachments.length > 0 ? (
              <ul className="space-y-1">
                {attachments.map((a, i) => (
                  <li key={`${a.filename}-${i}`} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                    <span className="truncate">{a.filename}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="b-recipients">{t('email:bulk.recipientsLabel')}</Label>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" /> {t('email:bulk.uploadCsv')}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                  e.target.value = ''
                }}
              />
            </div>
            {platforms.data?.length ? (
              <div className="flex items-center gap-2">
                <Select
                  id="b-platform"
                  className="flex-1"
                  value={platformId}
                  onChange={(e) => setPlatformId(e.target.value)}
                >
                  <option value="">{t('email:bulk.pickPlatform')}</option>
                  {platforms.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!platformId || loadPlatformClients.isPending}
                  onClick={() => loadPlatformClients.mutate(platformId)}
                >
                  {loadPlatformClients.isPending ? t('common:states.loading') : t('email:bulk.sendToClientsOf', { name: platforms.data.find((p) => p.id === platformId)?.name ?? t('email:bulk.platformFallback') })}
                </Button>
              </div>
            ) : null}
            <Textarea
              id="b-recipients"
              className="min-h-40 font-mono"
              placeholder={t('email:bulk.recipientsPlaceholder')}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            <p className={tooMany ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {tooMany
                ? t('email:bulk.detectedTooMany', { count: recipients.length, max: MAX_RECIPIENTS, extra: recipients.length - MAX_RECIPIENTS })
                : t('email:bulk.detected', { count: recipients.length })}
            </p>
            {invalidLines.length > 0 ? (
              <p className="text-sm text-destructive">
                {t('email:bulk.ignoredLines', { count: invalidLines.length, lines: invalidLines.join(' · ') })}
              </p>
            ) : null}
          </div>

          <Button
            className="w-full"
            disabled={send.isPending || !templateId || recipients.length === 0 || tooMany}
            onClick={() => send.mutate()}
          >
            {send.isPending ? t('common:states.sending') : t('email:bulk.sendTo', { count: recipients.length })}
          </Button>
        </CardContent>
      </Card>

      {showResults ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <StatePill tone="success">{t('email:bulk.sentCount', { sentCount })}</StatePill>
                <StatePill tone="critical">{t('email:bulk.failedCount', { failedCount })}</StatePill>
                {skippedRows.length > 0 ? <StatePill>{t('email:bulk.skippedCount', { count: skippedRows.length })}</StatePill> : null}
                {suppressedRows.length > 0 ? <StatePill tone="warning">{t('email:bulk.unsubscribedCount', { count: suppressedRows.length })}</StatePill> : null}
                {capBlockedRows.length > 0 ? (
                  <StatePill tone="warning" title={t('email:bulk.capReachedHint')}>
                    {t('email:bulk.postponedCount', { count: capBlockedRows.length })}
                  </StatePill>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setFreshResults([])
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.delete('batchIds')
                    return next
                  })
                }}
              >
                {t('email:bulk.clearResults')}
              </Button>
            </div>
            {sendsByBatch.isPending && batchIds.length > 0 ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common:labels.recipient')}</TableHead>
                    <TableHead>{t('common:labels.state')}</TableHead>
                    <TableHead priority="md">{t('email:labels.engagement')}</TableHead>
                    <TableHead priority="md">{t('common:labels.details')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {persistedRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell truncate>{r.recipient}</TableCell>
                      <TableCell>
                        <StatePill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatePill>
                      </TableCell>
                      <TableCell priority="md">
                        <EngagementBadges send={r} />
                      </TableCell>
                      <TableCell priority="md" className="text-xs text-muted-foreground">{r.errorMessage ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                  {skippedRows.map(({ email, key }) => (
                    <TableRow key={key}>
                      <TableCell truncate>{email}</TableCell>
                      <TableCell>
                        <StatePill>{t('email:bulk.skipped')}</StatePill>
                      </TableCell>
                      <TableCell priority="md" className="text-xs text-muted-foreground">—</TableCell>
                      <TableCell priority="md" className="text-xs text-muted-foreground">{t('email:bulk.skippedHint')}</TableCell>
                    </TableRow>
                  ))}
                  {suppressedRows.map(({ email, key }) => (
                    <TableRow key={key}>
                      <TableCell truncate>{email}</TableCell>
                      <TableCell>
                        <StatePill tone="warning">{t('email:labels.unsubscribed')}</StatePill>
                      </TableCell>
                      <TableCell priority="md" className="text-xs text-muted-foreground">—</TableCell>
                      <TableCell priority="md" className="text-xs text-muted-foreground">{t('email:bulk.unsubscribedHint')}</TableCell>
                    </TableRow>
                  ))}
                  {capBlockedRows.map(({ email, key }) => (
                    <TableRow key={key}>
                      <TableCell truncate>{email}</TableCell>
                      <TableCell>
                        <StatePill tone="warning">{t('email:bulk.postponed')}</StatePill>
                      </TableCell>
                      <TableCell priority="md" className="text-xs text-muted-foreground">—</TableCell>
                      <TableCell priority="md" className="text-xs text-muted-foreground">{t('email:bulk.postponedHint')}</TableCell>
                    </TableRow>
                  ))}
                  {persistedRows.length === 0 && freshResults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-xs text-muted-foreground">
                        {t('email:bulk.resultsNote')}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
