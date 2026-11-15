import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/gravityState.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const codec = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const snapshot = {
  bodies: [
    { id: 1, x: 0, y: 0, vx: .2, vy: -.4, mass: 980, color: '#f1bf79' },
    { id: 20, x: 2.4, y: -.6, vx: 1.35, vy: 7.2, mass: 2.6, color: '#afa3ea' },
  ],
  view: { x: .4, y: -.25, zoom: 1.8 },
}
assert.deepEqual(codec.restoreGravitySnapshot(snapshot.bodies, snapshot.view), snapshot, 'starting bodies and view restore exactly')
assert.deepEqual(codec.restoreGravitySnapshot([], { x: 0, y: 0, zoom: 1 }), { bodies: [], view: { x: 0, y: 0, zoom: 1 } }, 'an intentionally empty custom scene is valid')
assert.equal(codec.nextGravityBodyId(snapshot.bodies, 20), 21, 'new body IDs do not collide with restored IDs')
assert.equal(codec.nextGravityBodyId([{ id: 1 }, { id: 2 }], 1), 3, 'ID allocation scans beyond occupied choices')

for (const bodies of [null, Array(33).fill(snapshot.bodies[0]), [{ ...snapshot.bodies[0], id: 0 }], [snapshot.bodies[0], { ...snapshot.bodies[1], id: 1 }], [{ ...snapshot.bodies[1], x: 1e9 }], [{ ...snapshot.bodies[1], vx: 36 }], [{ ...snapshot.bodies[1], mass: 1201 }], [{ ...snapshot.bodies[1], mass: 0 }], [{ ...snapshot.bodies[1], color: 'red' }]]) {
  assert.equal(codec.restoreGravitySnapshot(bodies, snapshot.view), null, 'malformed or out-of-model bodies are rejected')
}
for (const view of [null, { x: 1e9, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 0 }, { x: 0, y: 0, zoom: 101 }]) {
  assert.equal(codec.restoreGravityView(view), null, 'malformed camera state is rejected')
}

const maximum = { bodies: Array.from({ length: 32 }, (_, index) => ({ id: index + 1, x: index * 1.5, y: -index * .75, vx: .1 * index, vy: -.2 * index, mass: 1 + index, color: '#92d2e4' })), view: { x: 0, y: 0, zoom: 7 } }
assert.equal(codec.restoreGravitySnapshot(maximum.bodies, maximum.view)?.bodies.length, 32, 'the supported body limit restores')
assert.ok(Buffer.from(JSON.stringify({ $armsteel: 1, state: { scene: 'solar', ...maximum } })).toString('base64url').length < 16_000, 'the largest supported starting system fits the notebook and URL state budget')

console.log('Gravity state checks passed: body and camera restoration, numerical bounds, 32-body budget and collision-free IDs.')
