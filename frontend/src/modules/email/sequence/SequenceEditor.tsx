import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ListPlus, Pause, Play, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Switch } from '@/shared/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { EmailSenderOptions, EmailSequence, EmailTemplate } from '@/shared/lib/types'
import { IdentityField, useIdentityKey } from '../IdentityField'
import { EnrollListDialog } from './EnrollListDialog'
import { SequenceDiagnostics } from './SequenceDiagnostics'
import { StepCard } from './StepCard'
import { emptyStep, stepIsComplete, stepsFromSequence, stepsPayload, type StepDraft } from './steps'

interface SequenceEditorProps {
  /** `null` is a new sequence. The parent remounts the editor (key) when the sequence changes. */
  sequence: EmailSequence | null
  onClose: () => void
}

function RuleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange?: (checked: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <Switch size="sm" className="mt-0.5" checked={checked} disabled={!onChange} onCheckedChange={(next) => onChange?.(next)} label={label} />
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

export function SequenceEditor({ sequence, onClose }: SequenceEditorProps) {
  const { can } = useMe()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [name, setName] = useState(sequence?.name ?? '')
  const [steps, setSteps] = useState<StepDraft[]>(() => stepsFromSequence(sequence))
  const [stopOnMeeting, setStopOnMeeting] = useState(sequence?.stopOnMeeting ?? true)
  const [stopOnWonLost, setStopOnWonLost] = useState(sequence?.stopOnWonLost ?? true)
  const [enrollOpen, setEnrollOpen] = useState(false)

  // The route needs email.sabloane; without it the steps just have no template to pick.
  const templates = useQuery({ queryKey: ['email', 'templates'], queryFn: () => api.get<EmailTemplate[]>('/api/email/templates'), enabled: can('email.sabloane') })
  const senderOptions = useQuery({ queryKey: ['email', 'settings', 'sender-options'], queryFn: () => api.get<EmailSenderOptions>('/api/email/sender-options') })
  const [fromIdentity, setFromIdentity] = useIdentityKey(sequence?.fromIdentity ?? 'outreach', senderOptions.data?.identities)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setSteps((prev) => arrayMove(prev, prev.findIndex((s) => s.uid === active.id), prev.findIndex((s) => s.uid === over.id)))
  }

  const snapshot = JSON.stringify({ name, fromIdentity, steps: stepsPayload(steps), stopOnMeeting, stopOnWonLost })
  // The identity default arrives with the sender options, so the baseline is taken once they are in.
  const [baseline, setBaseline] = useState<string | null>(null)
  useEffect(() => {
    if (baseline === null && sequence && !senderOptions.isPending) setBaseline(snapshot)
  }, [baseline, sequence, senderOptions.isPending, snapshot])
  const dirty = sequence ? baseline !== null && snapshot !== baseline : name !== '' || steps.length > 1 || steps.some((s) => s.templateId || s.taskTitle)
  const canSave = name.trim().length > 0 && steps.length > 0 && steps.every(stepIsComplete)

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['email', 'sequences'] })
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), fromIdentity, stopOnMeeting, stopOnWonLost, steps: stepsPayload(steps) }
      return sequence ? api.patch(`/api/email/sequences/${sequence.id}`, body) : api.post('/api/email/sequences', body)
    },
    onSuccess: () => {
      refresh()
      setBaseline(snapshot)
      toast.success(sequence ? t('email:sequences.updated') : t('email:sequences.created'))
      if (!sequence) onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: (active: boolean) => api.patch(`/api/email/sequences/${sequence!.id}`, { active }),
    onSuccess: refresh,
    onError: (err) => toast.error(err.message),
  })

  const leave = () => {
    if (!dirty) return onClose()
    void confirm({ title: t('email:sequences.editor.leaveTitle'), consequence: t('email:sequences.editor.leaveBody'), confirmLabel: t('email:sequences.editor.leaveConfirm'), destructive: true }).then((ok) => ok && onClose())
  }

  const stepsList = (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={steps.map((s) => s.uid)} strategy={verticalListSortingStrategy}>
          {steps.map((step, index) => (
            <StepCard
              key={step.uid}
              step={step}
              index={index}
              templates={templates.data ?? []}
              canRemove={steps.length > 1}
              onChange={(patch) => setSteps((prev) => prev.map((s) => (s.uid === step.uid ? { ...s, ...patch } : s)))}
              onRemove={() => setSteps((prev) => prev.filter((s) => s.uid !== step.uid))}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button type="button" variant="outline" onClick={() => setSteps((prev) => [...prev, emptyStep(3)])}>
        <Plus aria-hidden="true" /> {t('email:sequences.addStep')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('email:sequences.daysHint')}</p>
    </div>
  )

  return (
    <div className="space-y-4" data-density="comfortable">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" onClick={leave}>
          <ArrowLeft aria-hidden="true" /> {t('email:sequences.editor.back')}
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{sequence ? sequence.name : t('email:sequences.new')}</h2>
        {sequence?.pausedAt ? <StatePill tone="warning">{t('email:sequences.editor.pausedAuto')}</StatePill> : null}
        {sequence ? (
          <>
            <Button type="button" variant="outline" onClick={() => setEnrollOpen(true)}>
              <ListPlus aria-hidden="true" /> {t('email:sequences.enrollList.open')}
            </Button>
            <Button type="button" variant="outline" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate(!sequence.active)}>
              {sequence.active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {sequence.active ? t('email:sequences.editor.pause') : t('email:sequences.editor.start')}
            </Button>
          </>
        ) : null}
        <Button type="button" disabled={!canSave || save.isPending || (Boolean(sequence) && !dirty)} onClick={() => save.mutate()}>
          {save.isPending ? t('common:states.saving') : sequence ? t('common:actions.save') : t('email:sequences.create')}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="seq-name">{t('common:labels.name')}</Label>
                <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <IdentityField id="seq-from" value={fromIdentity} onChange={setFromIdentity} identities={senderOptions.data?.identities} />
            </div>
            {sequence ? (
              <Tabs defaultValue="steps">
                <TabsList variant="segmented">
                  <TabsTrigger value="steps">{t('email:sequences.steps')}</TabsTrigger>
                  <TabsTrigger value="diagnostics">{t('email:sequences.diag.tab')}</TabsTrigger>
                </TabsList>
                <TabsContent value="steps" className="mt-3">
                  {stepsList}
                </TabsContent>
                <TabsContent value="diagnostics" className="mt-3">
                  <SequenceDiagnostics sequence={sequence} />
                </TabsContent>
              </Tabs>
            ) : (
              <div className="space-y-2">
                <Label>{t('email:sequences.steps')}</Label>
                {stepsList}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardContent className="space-y-4 pt-6">
            <h3 className="text-sm font-semibold">{t('email:sequences.editor.rules')}</h3>
            <RuleRow label={t('email:sequences.editor.stopOnReply')} hint={t('email:sequences.editor.stopOnReplyHint')} checked />
            <RuleRow label={t('email:sequences.editor.stopOnMeeting')} hint={t('email:sequences.editor.stopOnMeetingHint')} checked={stopOnMeeting} onChange={setStopOnMeeting} />
            <RuleRow label={t('email:sequences.editor.stopOnWonLost')} hint={t('email:sequences.editor.stopOnWonLostHint')} checked={stopOnWonLost} onChange={setStopOnWonLost} />
            <div>
              <p className="text-sm">{t('email:sequences.editor.window')}</p>
              <p className="text-xs text-muted-foreground">{t('email:sequences.editor.windowHint')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {sequence ? <EnrollListDialog open={enrollOpen} sequence={sequence} onOpenChange={setEnrollOpen} /> : null}
    </div>
  )
}
