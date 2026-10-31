import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'
import { cn } from '@/shared/lib/utils'

const Tabs = TabsPrimitive.Root

// The active line is one bar under the list that slides to the active tab (MA5), instead of a
// border per tab that jumps. Rows wrap on a phone, so it follows the tab down as well as across.
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const indicatorRef = React.useRef<HTMLSpanElement>(null)

  React.useLayoutEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    const place = () => {
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
    const resize = new ResizeObserver(place)
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
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm sm:px-4 font-medium text-muted-foreground transition-colors hover:text-foreground',
      'data-[state=active]:text-foreground',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn('mt-6', className)} {...props} />)
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
