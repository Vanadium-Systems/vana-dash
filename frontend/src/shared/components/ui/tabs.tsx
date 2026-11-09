import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'
import { cn } from '@/shared/lib/utils'

const Tabs = TabsPrimitive.Root

/**
 * `line`: the page's own tabs. `segmented`: views of the same list inside a page (Notes / Archive /
 * Trash, Personal / Company), so two rows of tabs never look alike.
 */
type TabsVariant = 'line' | 'segmented'
const VariantContext = React.createContext<TabsVariant>('line')

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }

const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsListProps>(
  ({ variant = 'line', className, children, ...props }, ref) => (
    <VariantContext.Provider value={variant}>
      {variant === 'segmented' ? (
        // Wraps instead of scrolling sideways on a phone, like the line variant.
        <TabsPrimitive.List
          ref={ref}
          className={cn('inline-flex min-h-control-md max-w-full flex-wrap items-center gap-0.5 rounded-md bg-muted p-0.5', className)}
          {...props}
        >
          {children}
        </TabsPrimitive.List>
      ) : (
        <LineTabsList ref={ref} className={className} {...props}>
          {children}
        </LineTabsList>
      )}
    </VariantContext.Provider>
  ),
)
TabsList.displayName = TabsPrimitive.List.displayName

// The active line is one bar under the list that slides to the active tab (MA5), instead of a
// border per tab that jumps. Rows wrap on a phone, so it follows the tab down as well as across.
const LineTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const indicatorRef = React.useRef<HTMLSpanElement>(null)

  React.useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    // The list spans the row, so it keeps its size when a tab grows (web font swap, a count
    // badge, a label in another language); the tabs themselves have to be watched.
    const resize = new ResizeObserver(() => place())
    const place = () => {
      list.querySelectorAll('[role="tab"]').forEach((tab) => resize.observe(tab))
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
    resize.observe(list)
    return () => {
      mutations.disconnect()
      resize.disconnect()
    }
  }, [])

  return (
    // Wraps onto a second row instead of scrolling sideways when the tabs don't fit a phone.
    <TabsPrimitive.List
      ref={(node) => {
        listRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      className={cn('relative flex flex-wrap gap-x-1 border-b', className)}
      {...props}
    >
      {children}
      <span ref={indicatorRef} aria-hidden="true" className="tab-indicator" style={{ opacity: 0 }} />
    </TabsPrimitive.List>
  )
})
LineTabsList.displayName = 'LineTabsList'

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(VariantContext)
  return (
    <TabsPrimitive.Trigger
      ref={ref}
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
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn('mt-6', className)} {...props} />)
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
