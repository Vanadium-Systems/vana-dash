import * as React from 'react'
import { cn } from '@/shared/lib/utils'

interface TabsContextValue {
  value: string | undefined
  setValue: (next: string) => void
  baseId: string
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext() {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error('Tabs components must be used within <Tabs>')
  return ctx
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ value, defaultValue, onValueChange, children, ...props }, ref) => {
    const [internalValue, setInternalValue] = React.useState<string | undefined>(defaultValue)
    const isControlled = value !== undefined
    const activeValue = isControlled ? value : internalValue
    const baseId = React.useId()

    const setValue = React.useCallback(
      (next: string) => {
        if (!isControlled) setInternalValue(next)
        onValueChange?.(next)
      },
      [isControlled, onValueChange],
    )

    return (
      <TabsContext.Provider value={{ value: activeValue, setValue, baseId }}>
        <div ref={ref} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    )
  },
)
Tabs.displayName = 'Tabs'

/**
 * `line`: the page's own tabs. `segmented`: views of the same list inside a page (Notes / Archive /
 * Trash, Personal / Company), so two rows of tabs never look alike.
 */
type TabsVariant = 'line' | 'segmented'
const VariantContext = React.createContext<TabsVariant>('line')

type TabsListProps = React.HTMLAttributes<HTMLDivElement> & { variant?: TabsVariant }

const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  ({ variant = 'line', className, children, ...props }, ref) => (
    <VariantContext.Provider value={variant}>
      {variant === 'segmented' ? (
        // Wraps instead of scrolling sideways on a phone, like the line variant.
        <div
          ref={ref}
          role="tablist"
          className={cn('inline-flex min-h-control-md max-w-full flex-wrap items-center gap-0.5 rounded-md bg-muted p-0.5', className)}
          {...props}
        >
          {children}
        </div>
      ) : (
        <LineTabsList ref={ref} className={className} {...props}>
          {children}
        </LineTabsList>
      )}
    </VariantContext.Provider>
  ),
)
TabsList.displayName = 'TabsList'

// The active line is one bar under the list that slides to the active tab (MA5), instead of a
// border per tab that jumps. Rows wrap on a phone, so it follows the tab down as well as across.
const LineTabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const listRef = React.useRef<HTMLDivElement | null>(null)
    const indicatorRef = React.useRef<HTMLSpanElement>(null)

    React.useLayoutEffect(() => {
      const list = listRef.current
      const indicator = indicatorRef.current
      if (!list || !indicator) return
      // The list spans the row, so it keeps its size when a tab grows (web font swap, a count
      // badge, a label in another language); the tabs themselves have to be watched.
      const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null
      const place = () => {
        if (resize) list.querySelectorAll('[role="tab"]').forEach((tab) => resize.observe(tab))
        const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
        if (!active) {
          indicator.style.opacity = '0'
          return
        }
        indicator.style.opacity = '1'
        indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop + active.offsetHeight - 2}px) scaleX(${active.offsetWidth})`
        // The first placement is not animated: the line is where it belongs when the page opens.
        requestAnimationFrame(() => indicator.setAttribute('data-ready', ''))
      }
      place()
      const mutations = new MutationObserver(place)
      mutations.observe(list, { attributes: true, attributeFilter: ['data-state'], subtree: true, childList: true })
      resize?.observe(list)
      return () => {
        mutations.disconnect()
        resize?.disconnect()
      }
    }, [])

    return (
      // Wraps onto a second row instead of scrolling sideways when the tabs don't fit a phone.
      <div
        ref={(node) => {
          listRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        role="tablist"
        className={cn('relative flex flex-wrap gap-x-1 border-b', className)}
        {...props}
      >
        {children}
        <span ref={indicatorRef} aria-hidden="true" className="tab-indicator" style={{ opacity: 0 }} />
      </div>
    )
  },
)
LineTabsList.displayName = 'LineTabsList'

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, disabled, onClick, onKeyDown, ...props }, ref) => {
    const variant = React.useContext(VariantContext)
    const { value: activeValue, setValue, baseId } = useTabsContext()
    const isActive = activeValue === value

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(e)
      if (e.defaultPrevented) return
      const tablist = e.currentTarget.closest('[role="tablist"]')
      if (!tablist) return
      const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')]
      const idx = tabs.indexOf(e.currentTarget)
      if (idx === -1 || tabs.length === 0) return

      let nextIdx: number | null = null
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length
      else if (e.key === 'Home') nextIdx = 0
      else if (e.key === 'End') nextIdx = tabs.length - 1

      if (nextIdx !== null) {
        e.preventDefault()
        const target = tabs[nextIdx]
        target?.focus()
        target?.click()
      }
    }

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        id={`${baseId}-tab-${value}`}
        aria-selected={isActive}
        aria-controls={`${baseId}-panel-${value}`}
        data-state={isActive ? 'active' : 'inactive'}
        tabIndex={isActive ? 0 : -1}
        disabled={disabled}
        onClick={(e) => {
          if (!disabled) setValue(value)
          onClick?.(e)
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          variant === 'segmented'
            ? 'inline-flex h-[calc(var(--control-md)-0.25rem)] items-center rounded-sm px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm'
            : 'border-b-2 border-transparent px-3 py-2 sm:px-4',
          className,
        )}
        {...props}
      />
    )
  },
)
TabsTrigger.displayName = 'TabsTrigger'

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
  forceMount?: boolean
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, forceMount, children, ...props }, ref) => {
    const { value: activeValue, baseId } = useTabsContext()
    const isActive = activeValue === value
    if (!isActive && !forceMount) return null

    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`${baseId}-panel-${value}`}
        aria-labelledby={`${baseId}-tab-${value}`}
        data-state={isActive ? 'active' : 'inactive'}
        hidden={!isActive}
        className={cn('mt-6', className)}
        {...props}
      >
        {children}
      </div>
    )
  },
)
TabsContent.displayName = 'TabsContent'

export { Tabs, TabsList, TabsTrigger, TabsContent }
