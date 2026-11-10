import { Upload, UserPlus } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { t } from '@/shared/lib/i18n'

// A made-up list, blurred, behind the call to action: shows what the screen will hold without
// pretending to be data. Bars only, no text, so nothing in it can be read as a real prospect.
const PREVIEW_ROWS = [72, 55, 88, 64, 47]

/** A new account: nothing imported or created yet. */
export function NewAccountEmpty({ onImport, onNew }: { onImport: () => void; onNew: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-md">
      <div aria-hidden="true" className="pointer-events-none select-none space-y-3 p-4 blur-sm">
        {PREVIEW_ROWS.map((width, index) => (
          <div key={index} className="flex items-center gap-4">
            <span className="size-4 rounded-sm bg-muted" />
            <span className="h-3 rounded bg-muted" style={{ width: `${width}%`, maxWidth: '14rem' }} />
            <span className="ml-auto h-3 w-16 rounded bg-muted" />
            <span className="hidden h-3 w-24 rounded bg-muted sm:block" />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 px-4 text-center">
        <p className="text-sm font-medium">{t('clients:prospects.empty.newTitle')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('clients:prospects.empty.newBody')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={onImport}>
            <Upload aria-hidden="true" /> {t('clients:prospects.import')}
          </Button>
          <Button type="button" variant="outline" onClick={onNew}>
            <UserPlus aria-hidden="true" /> {t('clients:prospects.new.trigger')}
          </Button>
        </div>
      </div>
    </div>
  )
}
