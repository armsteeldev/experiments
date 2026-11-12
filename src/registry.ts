import type { ExperimentDefinition } from './types'
import Mandelbrot from './experiments/Mandelbrot'
import Fluid from './experiments/Fluid'
import Boids from './experiments/Boids'
import Attractors from './experiments/Attractors'
import ReactionDiffusion from './experiments/ReactionDiffusion'
import LSystems from './experiments/LSystems'

export const experiments: ExperimentDefinition[] = [
  {
    id: 'mandelbrot', number: '01', title: 'The Infinite Shore', category: 'Mathematics',
    subtitle: 'A map of the immeasurable',
    description: 'At the edge of a simple equation, an impossible coastline unfolds without end.',
    about: 'The Mandelbrot set is formed by repeating a tiny instruction: square a complex number, then add it back to where you began. Points that remain bounded belong to the set. At its boundary, a change smaller than a breath reveals new structure at every scale.',
    method: 'Complex dynamics · zₙ₊₁ = zₙ² + c', year: '1980', updated: 'Just added', featured: true,
    Component: Mandelbrot,
  },
  {
    id: 'fluid', number: '02', title: 'A Quiet Current', category: 'Physics',
    subtitle: 'Colour carried by motion',
    description: 'Stir the invisible: a small gesture becomes a river of colour.',
    about: 'An incompressible fluid carries pigment as it moves. Velocity is advected through the field, pressure removes divergence, and the dye follows the corrected current. The familiar folds and tendrils are the geometry of motion made visible.',
    method: 'Stable fluids · semi-Lagrangian advection', year: '1999', updated: 'Just added',
    Component: Fluid,
  },
  {
    id: 'boids', number: '03', title: 'A Murmuration', category: 'Artificial Life',
    subtitle: 'Many bodies, no conductor',
    description: 'Hundreds of small decisions gather into one astonishing movement.',
    about: 'Each agent follows three local rules: keep a little distance, match nearby direction, and drift toward the group. No bird knows the shape of the flock. Its sweeping turns emerge from neighbours, one at a time.',
    method: 'Boids · separation, alignment, cohesion', year: '1986', updated: 'Just added',
    Component: Boids,
  },
  {
    id: 'attractors', number: '04', title: 'Weather, Remembered', category: 'Mathematics',
    subtitle: 'The shape of sensitive beginnings',
    description: 'A trajectory loops around a form it can never quite repeat.',
    about: 'A strange attractor is a long-term pattern in a system that never settles. In the Lorenz equations, tiny changes in the starting point grow until paths diverge, while remaining folded into the same delicate butterfly-shaped region.',
    method: 'Lorenz & Rössler systems · fourth-order integration', year: '1963', updated: 'Recently added',
    Component: Attractors,
  },
  {
    id: 'reaction', number: '05', title: 'The Pattern Beneath', category: 'Artificial Life',
    subtitle: 'Two simple ingredients, a living surface',
    description: 'Watch chemistry draw the boundaries of an imagined organism.',
    about: 'Two virtual chemicals diffuse and react across a surface. One feeds its own production; the other suppresses it. A narrow balance between feed and kill yields spots, labyrinths, and branching forms found throughout the living world.',
    method: 'Gray–Scott reaction–diffusion', year: '1983', updated: 'Recently added',
    Component: ReactionDiffusion,
  },
  {
    id: 'lsystem', number: '06', title: 'A Grammar of Growth', category: 'Generative Art',
    subtitle: 'A sentence that learns to branch',
    description: 'A handful of symbols opens into forests, ferns and impossible gardens.',
    about: 'Lindenmayer systems replace symbols with short strings, then repeat the replacement. A turtle reads the final sentence as instructions for drawing. Simple grammars, iterated a few times, begin to resemble the branching strategies of plants.',
    method: 'L-systems · parallel rewriting and turtle graphics', year: '1968', updated: 'Recently added',
    Component: LSystems,
  },
]

export const categories = ['All works', 'Mathematics', 'Physics', 'Artificial Life', 'Generative Art', 'Favourites'] as const
export type Filter = typeof categories[number]
