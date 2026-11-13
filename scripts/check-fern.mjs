import assert from 'node:assert/strict'
import { generateFernGeometry } from '../src/simulations/fern.ts'

const first = generateFernGeometry(6, 0.13, 7)
const repeated = generateFernGeometry(6, 0.13, 7)
assert.deepEqual(repeated, first, 'the same fern seed must generate the same curve order and geometry')
assert.ok(first.segments.length > 5_000, 'the default fern should retain dense frond detail')
assert.equal(first.maxDepth, 3)
assert.ok(first.segments.some((segment) => segment.depth === 0), 'the fern should include rachises')
assert.ok(first.segments.some((segment) => segment.depth === 1), 'the fern should include pinnae')
assert.ok(first.segments.some((segment) => segment.depth === 2 && segment.leafSize), 'the fern should include paired leaflets')
assert.notDeepEqual(generateFernGeometry(6, 0.13, 8), first, 'wind variation must respond to the seed')
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

console.log(`Fern checks passed: ${first.segments.length.toLocaleString()} deterministic curves, seeded wind, bounded geometry, and three branching levels.`)
