import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, X } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { EmailTemplate } from '@/shared/lib/types'
import { cn, parseRoDecimal } from '@/shared/lib/utils'
import { STEP_KINDS, type StepDraft } from './steps'

interface StepCardProps {
  step: StepDraft
  index: number
  templates: EmailTemplate[]
  canRemove: boolean
  onChange: (patch: Partial<StepDraft>) => void
  onRemove: () => void
}

function TemplateSelect({ id, label, value, templates, onChange }: { id: string; label: string; value: string; templates: EmailTemplate[]; onChange: (value: string) => void }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onValueChange={onChange}>
        <option value="">{t('email:bulk.pickTemplate')}</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </Select>
    </div>
  )
}

export function StepCard({ step, index, templates, canRemove, onChange, onRemove }: StepCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.uid })
  const isEmail = step.kind === 'email'
  const hasB = isEmail && step.hasVariantB
  const setB = (open: boolean) => onChange({ hasVariantB: open, variantBTemplateId: open ? step.variantBTemplateId : '' })

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('space-y-3 rounded-md border p-3', isDragging && 'opacity-50')}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          aria-label={t('email:sequences.editor.drag', { n: formatNumber(index + 1) })}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="text-sm font-medium tabular-nums">{formatNumber(index + 1)}</span>
        <Select
          className="w-auto min-w-0 flex-1 sm:flex-none"
          aria-label={t('email:sequences.editor.kind')}
          value={step.kind}
          onValueChange={(kind) => onChange({ kind: kind as StepDraft['kind'] })}
          options={STEP_KINDS.map((entry) => ({ value: entry.kind, label: t(entry.label) }))}
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {index === 0 ? t('email:sequences.editor.delayFirst') : t('email:sequences.editor.delayAfter')}
          <Input
            inputMode="numeric"
            className="w-16"
            aria-label={t('email:sequences.editor.delay')}
            value={step.delayDays}
            onChange={(e) => onChange({ delayDays: Math.max(0, Math.round(parseRoDecimal(e.target.value) || 0)) })}
          />
          {t('email:sequences.days')}
        </label>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={!canRemove} aria-label={t('email:sequences.editor.removeStep')} onClick={onRemove}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {isEmail ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <TemplateSelect id={`${step.uid}-a`} label={hasB ? t('email:sequences.editor.variantA') : t('email:sequences.editor.template')} value={step.templateId} templates={templates} onChange={(templateId) => onChange({ templateId })} />
            {hasB ? (
              <>
                <TemplateSelect id={`${step.uid}-b`} label={t('email:sequences.editor.variantB')} value={step.variantBTemplateId} templates={templates} onChange={(variantBTemplateId) => onChange({ variantBTemplateId })} />
                <Button type="button" variant="ghost" onClick={() => setB(false)}>
                  {t('email:sequences.editor.removeB')}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={() => setB(true)}>
                <Plus aria-hidden="true" /> {t('email:sequences.editor.addB')}
              </Button>
            )}
          </div>
          {hasB ? <p className="text-xs text-muted-foreground">{t('email:sequences.editor.splitHint')}</p> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor={`${step.uid}-title`}>{t('email:sequences.editor.taskTitle')}</Label>
            <Input id={`${step.uid}-title`} value={step.taskTitle} onChange={(e) => onChange({ taskTitle: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${step.uid}-desc`}>{t('email:sequences.editor.taskDescription')}</Label>
            <Textarea id={`${step.uid}-desc`} rows={2} value={step.taskDescription} onChange={(e) => onChange({ taskDescription: e.target.value })} />
          </div>
          <p className="text-xs text-muted-foreground">{t('email:sequences.editor.taskHint')}</p>
        </div>
      )}
    </div>
  )
}
