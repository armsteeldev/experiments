import assert from 'node:assert/strict'
import { AttractorTrailBuffer, attractorRenderStride, ATTRACTOR_RENDER_INTERVAL_MS, shouldRenderAttractorFrame } from '../src/simulations/attractorTrail.ts'

const trail = new AttractorTrailBuffer(3)
trail.push(1, 2, 3)
trail.push(4, 5, 6)
trail.push(7, 8, 9)
trail.push(10, 11, 12)
assert.equal(trail.length, 3)
assert.deepEqual([0, 1, 2].map((index) => [trail.xAt(index), trail.yAt(index), trail.zAt(index)]), [[4, 5, 6], [7, 8, 9], [10, 11, 12]], 'the fixed-capacity ring retains newest points in order')
trail.clear()
assert.equal(trail.length, 0)
assert.throws(() => trail.xAt(0), RangeError, 'cleared points cannot leak into the next simulation')
assert.equal(attractorRenderStride(14_000), 1)
assert.equal(attractorRenderStride(28_000), 2)
assert.ok(Math.ceil(28_000 / attractorRenderStride(28_000)) <= 14_000, 'the 28k trail stays within its rendering point budget')
assert.equal(ATTRACTOR_RENDER_INTERVAL_MS, 1000 / 30)
assert.equal(shouldRenderAttractorFrame(20, 0), false, 'the luminous canvas should skip the intermediate 60 Hz redraw')
assert.equal(shouldRenderAttractorFrame(34, 0), true, 'the full trail should redraw by the next 30 Hz interval')

console.log('Attractor trail checks passed: fixed memory, ordered ring wrap, clear, and bounded render sampling.')
