import { createElement, forwardRef, type ForwardRefExoticComponent, type RefAttributes, type SVGProps } from 'react'

export type IconNode = Array<[tag: string, attrs: Record<string, string>]>

export interface LucideProps extends SVGProps<SVGSVGElement> {
  size?: string | number
  absoluteStrokeWidth?: boolean
}

export type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>

export function createLucideIcon(iconName: string, iconNode: IconNode): LucideIcon {
  const Component = forwardRef<SVGSVGElement, LucideProps>(
    ({ color = 'currentColor', size = 24, strokeWidth = 2, absoluteStrokeWidth, className, children, ...rest }, ref) =>
      createElement(
        'svg',
        {
          ref,
          xmlns: 'http://www.w3.org/2000/svg',
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: color,
          strokeWidth: absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: className ? `lucide ${className}` : 'lucide',
          ...rest,
        },
        ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
        children,
      ),
  )
  Component.displayName = iconName
  return Component
}
