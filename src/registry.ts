import { lazy } from 'react'
import type { ExperimentDefinition } from './types'

const Mandelbrot = lazy(() => import('./experiments/Mandelbrot'))
const Fluid = lazy(() => import('./experiments/Fluid'))
const Boids = lazy(() => import('./experiments/Boids'))
const Attractors = lazy(() => import('./experiments/Attractors'))
const ReactionDiffusion = lazy(() => import('./experiments/ReactionDiffusion'))
const LSystems = lazy(() => import('./experiments/LSystems'))
const GravityPlayground = lazy(() => import('./experiments/GravityPlayground'))
const InsideMachine = lazy(() => import('./experiments/InsideMachine'))
const NeuralNetworks = lazy(() => import('./experiments/NeuralNetworks'))
const LogicLaboratory = lazy(() => import('./experiments/LogicLaboratory'))
const InvisibleForces = lazy(() => import('./experiments/InvisibleForces'))
const CellularAutomata = lazy(() => import('./experiments/CellularAutomata'))
const Adder = lazy(() => import('./experiments/Adder'))

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
  {
    id: 'gravity', number: '07', title: 'Gravity Playground', category: 'Space',
    subtitle: 'Worlds held together by motion',
    description: 'Launch a moon, disturb an orbit, and watch mass bend the paths of every neighbour.',
    about: 'Every body attracts every other body according to Newton’s inverse-square law. Velocity-Verlet advances positions and velocities in two half-kicks around each drift, keeping orbital energy stable at interactive step sizes. Collisions can merge, bounce elastically, or pass through.',
    method: 'N-body gravity · velocity-Verlet integration', year: '1687', updated: 'Just added',
    Component: GravityPlayground,
  },
  {
    id: 'machine', number: '08', title: 'Inside the Machine', category: 'Computing',
    subtitle: 'A little computer, instruction by instruction',
    description: 'Watch a real instruction travel from memory through registers, the decoder and the ALU.',
    about: 'This small 8-bit teaching processor has four registers, 16 memory cells, a program counter, an instruction register and a decoder. Each clock fetches one assembly instruction, decodes its operands, then commits the result through the data bus. Arithmetic wraps modulo 256.',
    method: 'Fetch · decode · execute · 8-bit register machine', year: '1945', updated: 'Just added',
    Component: InsideMachine,
  },
  {
    id: 'neural', number: '09', title: 'Neural Networks', category: 'Computing',
    subtitle: 'A boundary learned from examples',
    description: 'Train a compact neural network and watch its decision surface move with every update.',
    about: 'A feedforward network applies weighted sums, biases and an activation function layer by layer. Stochastic gradient descent computes the squared-error gradient by backpropagating through those exact operations. The color field samples the trained model’s real prediction across a two-dimensional input plane.',
    method: 'Feedforward network · backpropagation · gradient descent', year: '1986', updated: 'Just added',
    Component: NeuralNetworks,
  },
  {
    id: 'logic', number: '10', title: 'Logic Laboratory', category: 'Electronics',
    subtitle: 'Make the invisible bit resolve',
    description: 'Connect a few gates and watch a question become a one or a zero.',
    about: 'Boolean gates are evaluated from source inputs in topological order. Each wire carries the source’s actual zero or one. Unconnected pins remain unknown, and combinational feedback is reported as a cycle instead of being assigned a misleading output.',
    method: 'Boolean algebra · combinational circuits · topological evaluation', year: '1854', updated: 'Just added',
    Component: LogicLaboratory,
  },
  {
    id: 'forces', number: '11', title: 'Invisible Forces', category: 'Physics',
    subtitle: 'Trace the shape of an electric field',
    description: 'Move charges through the dark and make potential, direction and motion visible.',
    about: 'The field is the vector sum of each charge’s Coulomb contribution; electric potential is the scalar sum. Equipotential contours and field lines describe these fields. Test particles are separate bodies accelerated by qE/m and do not travel along the drawn field lines.',
    method: 'Electrostatics · Coulomb superposition · E = −∇Φ', year: '1785', updated: 'Just added',
    Component: InvisibleForces,
  },
  {
    id: 'automata', number: '12', title: 'Cellular Automata', category: 'Artificial Life',
    subtitle: 'A world from one local rule',
    description: 'Paint a small beginning, then follow the pattern as it writes its own future.',
    about: 'Each cell updates from the states of its eight neighbours. Explore Conway’s Life, HighLife, Seeds and Brian’s Brain on a wrapped grid. Cell age changes the rendering, while every generation still follows the selected discrete rule exactly.',
    method: 'Discrete dynamical systems · local transition rules', year: '1970', updated: 'Just added',
    Component: CellularAutomata,
  },
  {
    id: 'adder', number: '13', title: 'The Adder', category: 'Computing',
    subtitle: 'One sum. Every gate.',
    description: 'Watch binary arithmetic resolve through a living circuit of real logic gates.',
    about: 'The Adder builds a Boolean gate graph for each calculation. Ripple mode resolves half and full adders bit by bit. Look-ahead mode builds a Kogge–Stone prefix network from propagate and generate pairs. Every output bit, carry and signed overflow flag is evaluated from those gates; playback reveals their deterministic resolution order.',
    method: 'Gate-level arithmetic · ripple carry · Kogge–Stone prefix', year: '2026', updated: 'Just added',
    Component: Adder,
  },
]

const disciplines = [...new Set(experiments.map((item) => item.category))]
export const categories = ['All works', ...disciplines, 'Favourites'] as const
export type Filter = typeof categories[number]
