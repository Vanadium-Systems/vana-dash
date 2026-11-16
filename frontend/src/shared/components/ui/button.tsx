import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps, cn } from '@/shared/lib/utils'
import * as React from 'react'

const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:size-4 [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border-strong bg-card hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      // Heights come from --control-* (DESIGN.md): md 36 everywhere (40 on a phone). `sm` and
      // `icon-sm` (32) are for the actions on a table row only.
      size: {
        sm: 'h-control-sm px-2.5 text-btn',
        md: 'h-control-md px-3.5',
        lg: 'h-control-lg px-4',
        icon: 'h-control-md w-control-md',
        'icon-sm': 'h-control-sm w-control-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
