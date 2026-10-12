import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { useMe } from '@/shared/hooks/use-me'
import { activeAdminName, useTeamMembers } from '@/shared/hooks/use-team'
import type { FeatureKey } from '@/shared/lib/types'

// Ruta deschisă direct, fără funcționalitatea ei: nu e 404 și nici ecran gol, ci o pagină
// care spune ce lipsește și cine poate da (PLAN.md C2, §5.17). Ascundem ce nu poate face
// niciodată omul în rolul lui — aici însă omul a venit cu link, deci răspundem.

export function RequireFeature({ feature, page, children }: { feature: FeatureKey; page: string; children: ReactNode }) {
  const { can } = useMe()
  if (can(feature)) return <>{children}</>
  return <AccessDenied page={page} />
}

export function AccessDenied({ page }: { page: string }) {
  const admin = activeAdminName(useTeamMembers().data)
  return (
    <div data-density="comfortable" className="max-w-md py-8">
      <h1 className="text-lg font-semibold">Nu ai acces la {page}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {admin ? `Cere-l de la ${admin}.` : 'Cere-le unui administrator să îți deschidă pagina.'}
      </p>
      <Button variant="outline" asChild className="mt-4">
        <Link to="/team">Vezi echipa</Link>
      </Button>
    </div>
  )
}
