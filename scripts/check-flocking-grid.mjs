import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/simulations/flockingGrid.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const grid = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

for (let cellCount = 1; cellCount <= 24; cellCount++) {
  for (let reach = 0; reach <= 8; reach++) {
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
      const span = grid.wrappedCellSpan(cellCount, reach)
      const start = grid.wrappedCellStart(cellIndex, cellCount, reach)
      const actual = Array.from({ length: span }, (_, offset) => (start + offset) % cellCount)
      const reference = []
      const seen = new Set()
      for (let offset = -reach; offset <= reach; offset++) {
        const wrapped = ((cellIndex + offset) % cellCount + cellCount) % cellCount
        if (!seen.has(wrapped)) { reference.push(wrapped); seen.add(wrapped) }
      }
      assert.deepEqual(actual, reference, `wrapped window preserves neighbourhood order for ${cellCount} cells, reach ${reach}, cell ${cellIndex}`)
    }
  }
}

for (const [x, y, maximum] of [[0, 0, .1], [3, 4, 5], [6, 8, 5], [-3, 4, 4], [1e-8, -1e-8, .000001]]) {
  const length = Math.hypot(x, y)
  assert.equal(grid.limitedVectorScale(x, y, maximum), length > maximum ? maximum / length : 1, 'allocation-free vector scaling retains the original force limit')
}

assert.equal(grid.nearestToroidalPoint([{ id: 'edge', x: 1, y: 50 }], 99, 50, 100, 100, 5)?.id, 'edge', 'nearest-predator search observes a target across the wrap seam')
let seed = 431
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
for (let trial = 0; trial < 24; trial++) {
  const width = 320 + Math.floor(random() * 1280), height = 240 + Math.floor(random() * 760), radius = 28 + Math.floor(random() * 105)
  const columns = Math.ceil(width / radius), rows = Math.ceil(height / radius)
  const agents = Array.from({ length: 180 }, (_, index) => ({ id: index, x: random() * width, y: random() * height, species: index < 8 ? 2 : 1 }))
  const predators = agents.filter((agent) => agent.species === 2)
  const cells = Array.from({ length: columns * rows }, () => [])
  for (const agent of agents) cells[Math.floor(agent.y / radius) * columns + Math.floor(agent.x / radius)].push(agent)
  for (const prey of agents.filter((agent) => agent.species === 1).slice(0, 40)) {
    const gx = Math.floor(prey.x / radius), gy = Math.floor(prey.y / radius)
    const startColumn = grid.wrappedCellStart(gx, columns, 3), startRow = grid.wrappedCellStart(gy, rows, 3)
    let expected = null, expectedDistance2 = Infinity
    for (let rowOffset = 0; rowOffset < grid.wrappedCellSpan(rows, 3); rowOffset++) {
      for (let columnOffset = 0; columnOffset < grid.wrappedCellSpan(columns, 3); columnOffset++) {
        const column = (startColumn + columnOffset) % columns, row = (startRow + rowOffset) % rows
        for (const candidate of cells[row * columns + column]) {
          if (candidate.species !== 2) continue
          let dx = candidate.x - prey.x, dy = candidate.y - prey.y
          if (dx > width / 2) dx -= width; else if (dx < -width / 2) dx += width
          if (dy > height / 2) dy -= height; else if (dy < -height / 2) dy += height
          const distance2 = dx * dx + dy * dy
          if (distance2 <= radius * radius * 6.25 && distance2 < expectedDistance2) { expectedDistance2 = distance2; expected = candidate }
        }
      }
    }
    const actual = grid.nearestToroidalPoint(predators, prey.x, prey.y, width, height, radius * 2.5)
    assert.equal(actual?.id ?? null, expected?.id ?? null, 'direct species-list search matches the former mixed-cell predator result')
  }
}

console.log('Flocking grid checks passed: wrapped-cell order, force limits, toroidal seams and direct predator searches match the former grid result.')
