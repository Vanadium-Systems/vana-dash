import { useMutation } from '@tanstack/react-query'
import { Loader2, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { useMe } from '@/shared/hooks/use-me'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { downloadApk, isNative } from '@/shared/lib/native'
import { AssistantProvidersCard } from './AssistantProvidersCard'
import { CryptoSettingsCard } from '@/modules/crypto/CryptoSettingsCard'
import { AssetsSettingsCard } from '@/modules/assets/AssetsSettingsCard'
import { CompanyProfileCard } from './CompanyProfileCard'
import { OpsJobsSettingsCard } from './OpsJobsSettingsCard'

function MobileAppCard() {
  const download = useMutation({
    mutationFn: downloadApk,
    onSuccess: () => toast.success('APK descărcat — deschide-l din notificare pt. instalare'),
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Aplicație Android</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Shell nativ cu update automat la deploy — conținutul nou ajunge la redeschiderea aplicației, fără reinstalare.
          Reinstalarea e necesară doar la schimbări de plugin-uri native.
        </p>
        <Button disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Descarcă / actualizează APK
        </Button>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  // Setările rămân ale firmei; ale omului sunt la „Profilul meu". Fiecare card are
  // funcționalitatea lui, deci un rol fără una nu vede un card gol (PLAN.md C2).
  const { can } = useMe()
  return (
    <div className="space-y-6" data-density="comfortable">
      <PageHeader title="Setări" />
      {can('setari.firma') ? <CompanyProfileCard /> : null}
      {can('setari.joburi') ? <OpsJobsSettingsCard /> : null}
      {can('setari.asistent') ? <AssistantProvidersCard /> : null}
      {can('investitii.setari') ? (
        <>
          <CryptoSettingsCard />
          <AssetsSettingsCard />
        </>
      ) : null}
      {!isNative ? <MobileAppCard /> : null}
    </div>
  )
}
