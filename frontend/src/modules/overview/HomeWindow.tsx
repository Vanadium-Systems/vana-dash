import { ArrowRight } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useMe } from '@/shared/hooks/use-me'
import { companyTimeZone, intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { rasina } from '@/shared/lib/rasina'
import { cn } from '@/shared/lib/utils'
import { homeForecast, type HomeSignals } from './home-forecast'
import { MOMENT_LIGHT, momentAt, type Moment } from './moment'

/** The time and the moment of the day, re-read every minute. */
function useClock(): { now: Date; moment: Moment } {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return { now, moment: momentAt(now, companyTimeZone()) }
}

/** The light of the moment for the resin on Home (DESIGN.md: the resin takes its light from the window). */
export function momentLight(moment: Moment): CSSProperties {
  const [c1, c2, c3, c4] = MOMENT_LIGHT[moment]
  return { '--c1': c1, '--c2': c2, '--c3': c3, '--c4': c4 } as CSSProperties
}

interface HomeWindowProps {
  signals: HomeSignals | null
  /** Where the resin button goes: the first thing that asks for attention. */
  firstTo: string | null
}

/**
 * The window of Home (DESIGN.md "Two layers"): a photo that follows the time of day in the
 * company's zone, a readability veil on the left only, 6% grain. On it: the title, the time,
 * the company's weather in one sentence and the resin button with what needs doing. The photo
 * loads after the data, at low priority: the window never delays the figures.
 */
export function HomeWindow({ signals, firstTo }: HomeWindowProps) {
  const { session } = useMe()
  const { now, moment } = useClock()
  const [photoReady, setPhotoReady] = useState(false)
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200))
    idle(() => setPhotoReady(true))
  }, [])

  const forecast = signals ? homeForecast(signals) : null
  const clock = new Intl.DateTimeFormat(intlTag(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: companyTimeZone() }).format(now)
  const resin = rasina('home-window')
  const title = session?.tenant?.name ?? t('common:nav.today')

  return (
    <section className="home-window" data-moment={moment} style={momentLight(moment)} aria-label={t('overview:window.label')}>
      {photoReady ? (
        <picture>
          <source media="(max-width: 599px)" srcSet={`/home/${moment}-640.webp`} />
          <img
            className="home-window-photo"
            src={`/home/${moment}-1280.webp`}
            srcSet={`/home/${moment}-1280.webp 1280w, /home/${moment}-1920.webp 1920w`}
            sizes="(max-width: 1023px) 100vw, 75vw"
            alt=""
            decoding="async"
            // Loaded last: the window is the backdrop, the figures under it are what people came for.
            {...{ fetchpriority: 'low' }}
            onLoad={(event) => event.currentTarget.setAttribute('data-loaded', '')}
          />
        </picture>
      ) : null}
      <div className="home-window-veil" aria-hidden="true" />
      <div className="home-window-text">
        <h1 className="truncate text-2xl font-semibold tracking-title">{title}</h1>
        <p className="mt-1 text-sm opacity-80 first-letter:uppercase">{clock}</p>
        {forecast ? <p className="mt-1 max-w-md truncate text-sm">{t(`overview:window.weather.${forecast.weather}`, { count: forecast.count, first: forecast.first ? t(`overview:window.cloud.${forecast.first}`) : '' })}</p> : null}
        {forecast && forecast.count > 0 && firstTo ? (
          <Link to={firstTo} className={cn(resin.className, 'home-window-button lit')} style={resin.style}>
            <b>{forecast.count}</b>
            {t('overview:window.needsAttention', { count: forecast.count })}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </section>
  )
}
