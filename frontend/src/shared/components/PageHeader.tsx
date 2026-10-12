import { CircleHelp } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import { Link, useInRouterContext, useLocation } from 'react-router-dom'
import { guideRouteOf, visibleGuides } from '@/modules/help/guides'
import { useMe } from '@/shared/hooks/use-me'

interface PageHeaderProps {
  title: string
  // ReactNode, nu doar string — câteva pagini au nevoie de conținut viu sub titlu (breadcrumbs
  // interactive în Arhivă, nu doar text static).
  description?: ReactNode
  actions?: ReactNode
}

/**
 * Pagini contopite sub un singur item de navigație (DESIGN.md: Financiar + Rapoarte, Notițe +
 * Plan + Wishlist, Investiții = Crypto + Acțiuni). Gazda din App.tsx pune titlul secțiunii și
 * tab-urile aici; pagina își păstrează header-ul și acțiunile, fără să știe că e găzduită.
 */
export const PageSectionContext = createContext<{ title: string; nav: ReactNode } | null>(null)

// Primitivă lipsă (16+ module reinventau individual <h1 className="text-2xl font-bold">
// fără subtitlu/acțiuni) — rulată pe toate paginile de nivel top, înlocuiește markup-ul
// hand-rolled ca "bogăția" vizuală a unei pagini să vină din design, nu din accident.
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  const section = useContext(PageSectionContext)
  const inRouter = useInRouterContext()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{section?.title ?? title}</h1>
            {inRouter ? <PageGuidesLink /> : null}
          </div>
          {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {section?.nav}
    </div>
  )
}

/** „?” lângă titlu, doar pe paginile care au ghiduri pentru funcționalitățile omului. */
function PageGuidesLink() {
  const { pathname } = useLocation()
  const { can } = useMe()
  const route = guideRouteOf(pathname)
  if (!visibleGuides(can).some((guide) => guide.route === route)) return null
  return (
    <Link
      to={`/help?pagina=${encodeURIComponent(route)}`}
      aria-label="Ghidurile acestei pagini"
      title="Ghidurile acestei pagini"
      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CircleHelp className="h-4 w-4" aria-hidden="true" />
    </Link>
  )
}
