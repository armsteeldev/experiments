import assert from 'node:assert/strict'
import { generateFernGeometry } from '../src/simulations/fern.ts'
import { generateParametricTree } from '../src/simulations/parametricTree.ts'

const first = generateFernGeometry(6, 0.13, 7)
const repeated = generateFernGeometry(6, 0.13, 7)
assert.deepEqual(repeated, first, 'the same fern seed must generate the same curve order and geometry')
assert.ok(first.segments.length > 5_000, 'the default fern should retain dense frond detail')
assert.equal(first.maxDepth, 3)
assert.ok(first.segments.filter((segment) => segment.depth === 0).length >= 7 * 40, 'seven long curved rachises form an uneven frond fan')
assert.ok(first.segments.some((segment) => segment.depth === 0), 'the fern should include rachises')
assert.ok(first.segments.some((segment) => segment.depth === 1), 'the fern should include pinnae')
assert.ok(first.segments.some((segment) => segment.depth === 2 && segment.leafSize), 'the fern should include paired leaflets')
assert.notDeepEqual(generateFernGeometry(6, 0.13, 8), first, 'wind variation must respond to the seed')
assert.notDeepEqual(generateFernGeometry(6, 0.26, 7, 72), generateFernGeometry(6, 0.26, 7, 18), 'branch angle must change the parametric fern silhouette')
assert.ok(generateFernGeometry(4, 0.13, 7).segments.length < first.segments.length, 'generation detail must change curve density')

for (const [index, segment] of first.segments.entries()) {
  for (const coordinate of [segment.x1, segment.y1, segment.cx, segment.cy, segment.x2, segment.y2]) {
    assert.ok(Number.isFinite(coordinate), `segment ${index} must contain finite coordinates`)
  }
  assert.equal(segment.order, index, 'curve order must remain sequential for growth playback')
  assert.ok(segment.x1 >= first.bounds.minX && segment.x1 <= first.bounds.maxX)
  assert.ok(segment.x2 >= first.bounds.minX && segment.x2 <= first.bounds.maxX)
  assert.ok(segment.y1 >= first.bounds.minY && segment.y1 <= first.bounds.maxY)
  assert.ok(segment.y2 >= first.bounds.minY && segment.y2 <= first.bounds.maxY)
}

const tree = generateParametricTree(6, 0.26, 7, 52)
assert.deepEqual(generateParametricTree(6, 0.26, 7, 52), tree, 'the same tree seed must reproduce its recursive branches')
assert.ok(tree.segments.length >= 3_000 && tree.segments.length <= 5_000, 'the tree should have enough branches for a detailed crown without unbounded geometry')
assert.equal(tree.maxDepth, 6, 'the tree should retain six branching generations')
assert.ok((tree.bounds.maxX - tree.bounds.minX) / (tree.bounds.maxY - tree.bounds.minY) > 0.7, 'the default tree should have a broad, balanced crown')
assert.notDeepEqual(generateParametricTree(6, 0.26, 7, 24), tree, 'branch angle should change the crown shape')
assert.notDeepEqual(generateParametricTree(6, 0.08, 7, 52), tree, 'seeded wind should change branch curvature')
assert.ok(generateParametricTree(4, 0.26, 7, 52).segments.length < tree.segments.length, 'generation detail should change tree branch density')
assert.ok(tree.segments.some((segment) => Math.abs(segment.cx - (segment.x1 + segment.x2) / 2) > 1e-5), 'tree limbs should curve instead of forming a straight recursive lattice')
for (const [index, segment] of tree.segments.entries()) {
  for (const coordinate of [segment.x1, segment.y1, segment.cx, segment.cy, segment.x2, segment.y2]) assert.ok(Number.isFinite(coordinate), `tree segment ${index} must contain finite coordinates`)
  assert.equal(segment.order, index)
}

console.log(`Growth checks passed: ${first.segments.length.toLocaleString()} fern curves, ${tree.segments.length.toLocaleString()} recursive tree curves, deterministic seeds, variable silhouettes, and bounded geometry.`)
