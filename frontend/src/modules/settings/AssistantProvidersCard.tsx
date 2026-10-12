import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import { cn, parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'

interface ProviderModel {
  id: string
  label: string
  contextWindow?: number
  inputPricePerMtok?: number
  outputPricePerMtok?: number
}

interface ProviderSettings {
  provider: string
  enabled: boolean
  isDefault: boolean
  baseUrl: string | null
  effectiveBaseUrl: string | null
  apiKeyPreview: string | null
  hasEnvFallbackKey: boolean
  models: ProviderModel[]
  defaultModel: string | null
}

const PROVIDER_META: Record<string, { title: string; hint: string }> = {
  anthropic: { title: 'Anthropic (Claude)', hint: 'Cheie din env folosită când nu setezi una aici.' },
  openrouter: { title: 'OpenRouter', hint: 'Modele ox/OpenAI-compatible prin API-ul chat/completions.' },
}

function ProviderCard({ settings }: { settings: ProviderSettings }) {
  const queryClient = useQueryClient()
  const meta = PROVIDER_META[settings.provider] ?? { title: settings.provider, hint: '' }
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl ?? '')
  const [models, setModels] = useState<ProviderModel[]>(settings.models)
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel ?? '')
  // stare locală — altfel toggle-ul de "activ" ar suprascrie restul câmpurilor nesalvate
  const [enabled, setEnabled] = useState(settings.enabled)

  // resincronizat la răspunsul de după save — cheia rămâne goală (write-only)
  useEffect(() => {
    setModels(settings.models)
    setDefaultModel(settings.defaultModel ?? '')
    setEnabled(settings.enabled)
  }, [settings.models, settings.defaultModel, settings.enabled])

  const update = useMutation({
    mutationFn: (patch?: { isDefault?: boolean }) =>
      api.put<ProviderSettings[]>(`/api/assistant/providers/${settings.provider}`, {
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl !== (settings.baseUrl ?? '') ? { baseUrl: baseUrl || undefined } : {}),
        models,
        defaultModel: defaultModel || undefined,
        enabled,
        ...(patch?.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['assistant', 'providers'], data)
      queryClient.invalidateQueries({ queryKey: ['assistant', 'models'] })
      setApiKey('')
      toast.success(`${meta.title}: salvat`)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle className="text-sm">{meta.title}</CardTitle>
        {settings.isDefault ? (
          <Badge variant="default">implicit</Badge>
        ) : (
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ isDefault: true })}>
            setează implicit
          </Button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          activ
        </label>
      </div>
      {meta.hint ? <p className="text-xs text-muted-foreground">{meta.hint}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`key-${settings.provider}`}>Cheie API</Label>
          <Input
            id={`key-${settings.provider}`}
            type="password"
            autoComplete="off"
            placeholder={settings.apiKeyPreview ?? (settings.hasEnvFallbackKey ? 'din env (fallback)' : 'neconfigurat')}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {settings.apiKeyPreview ? <p className="text-xs text-muted-foreground">Stocată: {settings.apiKeyPreview}</p> : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`url-${settings.provider}`}>Base URL (opțional)</Label>
          <Input id={`url-${settings.provider}`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={settings.effectiveBaseUrl ?? ''} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Modele</Label>
        <p className="text-xs text-muted-foreground">
          Context window (tokeni) și preț ($/Mtok tokeni intrare/ieșire) alimentează meter-ul din Asistent — goale = fără estimare.
        </p>
        <div className="space-y-2">
          {models.map((m, i) => (
            <div key={`${m.id}-${i}`} className="space-y-1 rounded-md border p-2">
              <div className="flex gap-1">
                <Input
                  value={m.id}
                  onChange={(e) => setModels((prev) => prev.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
                  placeholder="id model (ex. stealth/ox-alpha)"
                  className="flex-1 font-mono"
                />
                <Input
                  value={m.label}
                  onChange={(e) => setModels((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  placeholder="etichetă"
                  className="w-36"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Șterge modelul"
                  onClick={() => setModels((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                <Input
                  inputMode="numeric"
                  value={m.contextWindow ?? ''}
                  onChange={(e) => setModels((prev) => prev.map((x, j) => (j === i ? { ...x, contextWindow: e.target.value === '' ? undefined : parseRoDecimal(e.target.value) } : x)))}
                  placeholder="context window (ex. 200000)"
                  className="w-44 font-mono tnum"
                  title="Context window (tokeni)"
                />
                <PriceInput
                  value={m.inputPricePerMtok}
                  onCommit={(value) => setModels((prev) => prev.map((x, j) => (j === i ? { ...x, inputPricePerMtok: value } : x)))}
                  placeholder="$ / Mtok intrare"
                  className="w-32"
                  title="Preț $ per milion tokeni de intrare"
                />
                <PriceInput
                  value={m.outputPricePerMtok}
                  onCommit={(value) => setModels((prev) => prev.map((x, j) => (j === i ? { ...x, outputPricePerMtok: value } : x)))}
                  placeholder="$ / Mtok ieșire"
                  className="w-28"
                  title="Preț $ per milion tokeni de ieșire"
                />
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={() => setModels((prev) => [...prev, { id: '', label: '' }])}>
          <Plus className="h-4 w-4" /> Model nou
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`def-${settings.provider}`}>Model implicit</Label>
        <Select
          id={`def-${settings.provider}`}
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
        >
          <option value="">—</option>
          {models.filter((m) => m.id).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.id})
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {settings.apiKeyPreview ? 'Cheie din DB' : settings.hasEnvFallbackKey ? 'Fallback pe env' : 'Fără cheie'}
        </span>
        <Button disabled={update.isPending} onClick={() => update.mutate(undefined)}>
          {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvează
        </Button>      </div>
    </div>
  )
}

export function AssistantProvidersCard() {
  const providers = useQuery({
    queryKey: ['assistant', 'providers'],
    queryFn: () => api.get<ProviderSettings[]>('/api/assistant/providers'),
  })

  if (providers.isPending) return null

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <CardTitle className="text-base">Asistent — provideri</CardTitle>
        <p className="text-sm text-muted-foreground">
          Cheile se salvează criptat și nu mai părăsesc serverul. Fără cheie configurată, Anthropic cade pe env.
        </p>
        {(providers.data ?? []).map((s) => (
          <ProviderCard key={s.provider} settings={s} />
        ))}
      </CardContent>
    </Card>
  )
}

// Prețul se ține ca text cât se tastează („0,") și devine număr la ieșirea din câmp; altfel
// un input controlat pe număr ar mânca virgula la fiecare apăsare.
function PriceInput({ value, onCommit, placeholder, className, title }: { value: number | undefined; onCommit: (value: number | undefined) => void; placeholder: string; className: string; title: string }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value])
  return (
    <Input
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = parseRoDecimal(draft)
        onCommit(Number.isNaN(parsed) ? undefined : parsed)
      }}
      placeholder={placeholder}
      className={cn('font-mono tnum', className)}
      title={title}
    />
  )
}
