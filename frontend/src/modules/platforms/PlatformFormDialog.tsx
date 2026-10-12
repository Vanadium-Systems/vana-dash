import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { Platform, PlatformType } from '@/shared/lib/types'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

interface PlatformFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create */
  platform: Platform | null
}

interface MappingDraft {
  metricKey: string
  unit: string
  path: string
}

const emptyMapping = (): MappingDraft => ({ metricKey: '', unit: 'count', path: '/' })

export function PlatformFormDialog({ open, onOpenChange, platform }: PlatformFormDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState('vanagreen')
  const [apiUrl, setApiUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [syncCron, setSyncCron] = useState('*/30 * * * *')
  const [mappings, setMappings] = useState<MappingDraft[]>([])
  const [healthPath, setHealthPath] = useState('')

  const types = useQuery({
    queryKey: ['platforms', 'types'],
    queryFn: () => api.get<PlatformType[]>('/api/platforms/types'),
  })

  useEffect(() => {
    if (open) {
      setName(platform?.name ?? '')
      setType(platform?.type ?? 'vanagreen')
      setApiUrl(platform?.apiUrl ?? '')
      // API key-ul nu vine niciodată din backend — la edit rămâne gol dacă nu-l schimbi
      setApiKey('')
      setSyncCron(platform?.syncCron ?? '*/30 * * * *')
      setMappings(
        (platform?.metricMappings ?? []).map((m) => ({ metricKey: m.metricKey, unit: m.unit ?? '', path: m.path })),
      )
      setHealthPath(platform?.healthPath ?? '')
    }
  }, [open, platform])

  const save = useMutation({
    mutationFn: () => {
      const isGeneric = type === 'generic'
      const genericFields = isGeneric
        ? {
            metricMappings: mappings
              .filter((m) => m.metricKey && m.path.startsWith('/'))
              .map((m) => ({ metricKey: m.metricKey, unit: m.unit || undefined, path: m.path, kind: 'number' as const })),
            healthPath: healthPath.trim() ? healthPath.trim() : null,
          }
        : {}
      if (platform) {
        return api.patch<Platform>(`/api/platforms/${platform.id}`, { name, type, apiUrl, syncCron, ...(apiKey ? { apiKey } : {}), ...genericFields })
      }
      return api.post<Platform>('/api/platforms', { name, type, apiUrl, apiKey, syncCron, ...genericFields })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platforms'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
      toast.success(platform ? t('platforms:form.updated') : t('platforms:form.added'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{platform ? t('platforms:form.editTitle') : t('platforms:add')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="p-name">{t('common:labels.name')}</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-type">{t('common:labels.type')}</Label>
            <Select
              id="p-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {(types.data ?? [{ type: 'vanagreen', displayName: 'VanaGreen' }]).map((platformType) => (
                <option key={platformType.type} value={platformType.type}>
                  {platformType.displayName}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-url">API URL</Label>
            <Input id="p-url" type="url" placeholder="https://app.example.com" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-key">{platform ? t('platforms:form.apiKeyUnchanged') : t('platforms:form.apiKey')}</Label>
            <Input
              id="p-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required={!platform}
            />
          </div>
          {type === 'generic' ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                {t('platforms:form.mappingsHint')}
              </p>
              {mappings.map((m, i) => (
                <div key={i} className="flex items-end gap-1">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`pm-key-${i}`} className="text-xs text-muted-foreground">
                      {t('platforms:form.metricKey')}
                    </Label>
                    <Input
                      id={`pm-key-${i}`}
                      placeholder={t('platforms:form.metricKeyPlaceholder')}
                      value={m.metricKey}
                      onChange={(e) => setMappings((prev) => prev.map((x, j) => (j === i ? { ...x, metricKey: e.target.value } : x)))}
                      className="font-mono"
                    />
                  </div>
                  <div className="w-20 space-y-1">
                    <Label htmlFor={`pm-unit-${i}`} className="text-xs text-muted-foreground">
                      {t('platforms:form.unit')}
                    </Label>
                    <Input
                      id={`pm-unit-${i}`}
                      placeholder="count"
                      value={m.unit}
                      onChange={(e) => setMappings((prev) => prev.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                    />
                  </div>
                  <div className="w-40 space-y-1">
                    <Label htmlFor={`pm-path-${i}`} className="text-xs text-muted-foreground">
                      {t('platforms:form.path')}
                    </Label>
                    <Input
                      id={`pm-path-${i}`}
                      placeholder="/metrics#.stock_kg"
                      value={m.path}
                      onChange={(e) => setMappings((prev) => prev.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))}
                      className="font-mono"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('platforms:form.deleteMapping')}
                    onClick={() => setMappings((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setMappings((prev) => [...prev, emptyMapping()])}>
                <Plus className="h-4 w-4" /> {t('platforms:form.newMapping')}
              </Button>
              <div className="space-y-1">
                <Label htmlFor="pm-health">{t('platforms:form.healthPath')}</Label>
                <Input
                  id="pm-health"
                  placeholder="/health"
                  value={healthPath}
                  onChange={(e) => setHealthPath(e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="p-cron">{t('platforms:labels.syncCron')}</Label>
            <Input id="p-cron" value={syncCron} onChange={(e) => setSyncCron(e.target.value)} required />
            <p className="text-xs text-muted-foreground">{t('platforms:form.cronHint')}</p>
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {save.isPending ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
