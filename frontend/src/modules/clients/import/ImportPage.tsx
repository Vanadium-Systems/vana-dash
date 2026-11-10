import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { t, type TKey } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { useAssignees } from '../prospects/use-prospect-data'
import { FileStep } from './FileStep'
import { PreviewStep } from './PreviewStep'
import { ResultStep, RunningStep } from './ResultStep'
import type { Distribution, ImportPreview, ImportResult } from './types'
import { importErrorMessage, useCommitImport, usePreviewImport } from './use-import'

type Step = 'file' | 'preview' | 'running' | 'result'
const STEP_TEXTS = { file: 'clients:import.steps.file', preview: 'clients:import.steps.preview', result: 'clients:import.steps.result' } satisfies Record<string, TKey>
const STEPS = Object.keys(STEP_TEXTS) as Array<keyof typeof STEP_TEXTS>

function Steps({ current }: { current: Step }) {
  const index = STEPS.indexOf(current === 'running' ? 'result' : current)
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {STEPS.map((step, i) => (
        <li key={step} aria-current={i === index ? 'step' : undefined} className={cn(i === index ? 'font-medium' : 'text-muted-foreground')}>
          {i + 1}. {t(STEP_TEXTS[step])}
        </li>
      ))}
    </ol>
  )
}

/** Three steps: the file, the preview with who gets what, the import and its report. */
export function ImportPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const assignees = useAssignees()
  const preview = usePreviewImport()
  const commit = useCommitImport()

  const [step, setStep] = useState<Step>('file')
  const [data, setData] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const readFile = (file: File) => {
    setFileError(null)
    preview.mutate(file, {
      onSuccess: (next) => {
        setData(next)
        setStep('preview')
      },
      onError: (err) => setFileError(importErrorMessage(err)),
    })
  }

  const start = (distribution: Distribution) => {
    if (!data) return
    setStep('running')
    commit.mutate(
      { token: data.token, distribution },
      {
        onSuccess: (done) => {
          setResult(done)
          setFailure(null)
        },
        onError: (err) => {
          setResult(null)
          setFailure(importErrorMessage(err))
        },
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: ['prospects'] })
          setStep('result')
        },
      },
    )
  }

  const reset = () => {
    setData(null)
    setResult(null)
    setFailure(null)
    setFileError(null)
    setStep('file')
  }

  return (
    <div data-density="comfortable" className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t('clients:import.title')}
        description={t('clients:import.description')}
        actions={
          <Button type="button" variant="outline" onClick={() => navigate('/clients')}>
            <ArrowLeft aria-hidden="true" /> {t('common:actions.back')}
          </Button>
        }
      />
      <Steps current={step} />
      {step === 'file' ? <FileStep pending={preview.isPending} error={fileError} onFile={readFile} /> : null}
      {step === 'preview' && data ? <PreviewStep preview={data} assignees={assignees.data ?? []} onBack={reset} onCommit={start} /> : null}
      {step === 'running' && data ? <RunningStep total={data.counts.new + data.counts.update} /> : null}
      {step === 'result' ? <ResultStep result={result} failure={failure} onList={() => navigate('/clients')} onAnother={reset} /> : null}
    </div>
  )
}
