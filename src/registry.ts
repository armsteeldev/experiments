import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import metadata from './data/experiments.json'
import type { ExperimentControls, ExperimentDefinition } from './types'

const components = {
  mandelbrot: lazy(() => import('./experiments/Mandelbrot')),
  fluid: lazy(() => import('./experiments/Fluid')),
  boids: lazy(() => import('./experiments/Boids')),
  attractors: lazy(() => import('./experiments/Attractors')),
  reaction: lazy(() => import('./experiments/ReactionDiffusion')),
  lsystem: lazy(() => import('./experiments/LSystems')),
  gravity: lazy(() => import('./experiments/GravityPlayground')),
  machine: lazy(() => import('./experiments/InsideMachine')),
  neural: lazy(() => import('./experiments/NeuralNetworks')),
  logic: lazy(() => import('./experiments/LogicLaboratory')),
  forces: lazy(() => import('./experiments/InvisibleForces')),
  automata: lazy(() => import('./experiments/CellularAutomata')),
  adder: lazy(() => import('./experiments/Adder')),
  waves: lazy(() => import('./experiments/WaveChamber')),
  optics: lazy(() => import('./experiments/GeometryOfLight')),
  sound: lazy(() => import('./experiments/ShapeOfSound')),
  garden: lazy(() => import('./experiments/LivingGarden')),
  network: lazy(() => import('./experiments/LivingNetwork')),
  lensing: lazy(() => import('./experiments/WhereLightFalls')),
} satisfies Record<string, LazyExoticComponent<ComponentType<ExperimentControls>>>

type ExperimentMetadata = Omit<ExperimentDefinition, 'Component'> & { metaDescription: string }
const records = metadata as ExperimentMetadata[]

export const experiments: ExperimentDefinition[] = records.map((item) => ({
  ...item,
  Component: components[item.id as keyof typeof components],
}))

export const categories = ['All works', ...new Set(experiments.map((item) => item.category)), 'Favourites'] as const
export type Filter = typeof categories[number]
