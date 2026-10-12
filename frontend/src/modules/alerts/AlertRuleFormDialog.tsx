import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { AlertCondition, AlertRule, AlertRuleTestResult, AlertSeverity } from '@/shared/lib/types'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { parseRoDecimal } from '@/shared/lib/utils'
import { Select } from '@/shared/components/ui/select'


const CONDITION_LABELS: Record<AlertCondition, string> = { lt: '<', lte: '≤', gt: '>', gte: '≥' }

interface AlertRuleFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create. */
  rule: AlertRule | null
}

export function AlertRuleFormDialog({ open, onOpenChange, rule }: AlertRuleFormDialogProps) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [metricKey, setMetricKey] = useState('')
  const [condition, setCondition] = useState<AlertCondition>('lt')
  const [threshold, setThreshold] = useState('')
  const [windowHours, setWindowHours] = useState('24')
  const [severity, setSeverity] = useState<AlertSeverity>('warning')
  const [enabled, setEnabled] = useState(true)
  const [testResult, setTestResult] = useState<AlertRuleTestResult | null>(null)

  useEffect(() => {
    if (!open) return
    setName(rule?.name ?? '')
    setMetricKey(rule?.metricKey ?? '')
    setCondition(rule?.condition ?? 'lt')
    setThreshold(rule?.threshold ?? '')
    setWindowHours(String(rule?.windowHours ?? 24))
    setSeverity(rule?.severity ?? 'warning')
    setEnabled(rule?.enabled ?? true)
    setTestResult(null)
  }, [open, rule])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        metricKey,
        condition,
        threshold: parseRoDecimal(threshold),
        windowHours: parseRoDecimal(windowHours),
        severity,
        enabled,
      }
      return rule ? api.patch<AlertRule>(`/api/alert-rules/${rule.id}`, body) : api.post<AlertRule>('/api/alert-rules', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success(rule ? 'Regulă actualizată' : 'Regulă creată')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/alert-rules/${rule?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success('Regulă ștearsă')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const test = useMutation({
    mutationFn: () => api.post<AlertRuleTestResult>(`/api/alert-rules/${rule?.id}/test`),
    onSuccess: (result) => setTestResult(result),
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? 'Editează regula' : 'Regulă nouă'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="ar-name">Nume</Label>
            <Input id="ar-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ar-metric">Metric key</Label>
            <Input
              id="ar-metric"
              value={metricKey}
              onChange={(e) => setMetricKey(e.target.value)}
              placeholder="ex: revenue"
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ar-condition">Condiție</Label>
              <Select id="ar-condition" value={condition} onChange={(e) => setCondition(e.target.value as AlertCondition)}>
                {(Object.keys(CONDITION_LABELS) as AlertCondition[]).map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ar-threshold">Prag</Label>
              <Input id="ar-threshold" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ar-window">Fereastră (ore)</Label>
              <Input id="ar-window" inputMode="numeric" value={windowHours} onChange={(e) => setWindowHours(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ar-severity">Severitate</Label>
              <Select id="ar-severity" value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 rounded border-input" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Activă
              </label>
            </div>
          </div>

          {rule ? (
            <div className="rounded-md border p-3">
              <Button type="button" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
                {test.isPending ? 'Se testează…' : 'Testează acum'}
              </Button>
              {testResult ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Valoare curentă: <strong>{testResult.value}</strong> —{' '}
                  {testResult.triggered ? <span className="text-destructive">s-ar declanșa</span> : <span>nu se declanșează</span>}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {save.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
            {rule ? (
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  void confirm({ title: `Șterge regula „${rule.name}”`, consequence: 'Alertele declanșate de ea rămân în istoric.', confirmLabel: 'Șterge regula', destructive: true }).then((ok) => ok && remove.mutate())
                }}
              >
                Șterge
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
