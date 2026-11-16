import type { ComponentType } from 'react'
import type { WidgetSize } from '../home-layout'

export interface WidgetProps {
  size: WidgetSize
  /** Rendered small in the catalog: links and buttons do nothing there. */
  preview?: boolean
}

export interface WidgetDef {
  id: string
  /** The feature that gates it; null = anyone. Same as the backend's `modules/overview/widgets.ts`. */
  feature: string | null
  sizes: WidgetSize[]
  /** Group in the catalog: the module the data comes from. */
  module: () => string
  title: () => string
  /** One line for the catalog. */
  description: () => string
  component: ComponentType<WidgetProps>
}
