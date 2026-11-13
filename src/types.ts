import type { ComponentType, LazyExoticComponent } from 'react'

export type Category = 'Mathematics' | 'Physics' | 'Computing' | 'Electronics' | 'Artificial Life' | 'Generative Art'

export type ExperimentControls = {
  paused: boolean
  controlsVisible: boolean
  stateFromUrl: Record<string, unknown> | null
  onShareState: (state: Record<string, unknown>) => void
  onCloseControls: () => void
}

export type ExperimentDefinition = {
  id: string
  number: string
  title: string
  category: Category
  subtitle: string
  description: string
  about: string
  method: string
  year: string
  updated: string
  featured?: boolean
  Component: ComponentType<ExperimentControls> | LazyExoticComponent<ComponentType<ExperimentControls>>
}
