import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/forcesState.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const codec = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const snapshot = {
  charges: [{ x: -1.05, y: 0, q: 1 }, { x: 1.05, y: 0, q: -1 }, { x: 2.4, y: .3, q: -1.65 }],
  view: { x: .15, y: -.2, zoom: 1.8 },
}
assert.deepEqual(codec.restoreForcesSnapshot(snapshot.charges, snapshot.view), snapshot, 'edited charges and view restore exactly')
assert.deepEqual(codec.restoreForcesSnapshot([], { x: 0, y: 0, zoom: 1 }), { charges: [], view: { x: 0, y: 0, zoom: 1 } }, 'an intentionally cleared board is preserved')
assert.deepEqual(codec.restoreForcesView({ x: 4, y: -2, zoom: 2 }), { x: 4, y: -2, zoom: 2 }, 'camera framing can restore for named arrangements')
assert.deepEqual(codec.restoreForcesView({ x: 0, y: 0, zoom: codec.MIN_FORCES_ZOOM }), { x: 0, y: 0, zoom: codec.MIN_FORCES_ZOOM }, 'the supported zoom minimum restores')
assert.deepEqual(codec.restoreForcesView({ x: 0, y: 0, zoom: codec.MAX_FORCES_ZOOM }), { x: 0, y: 0, zoom: codec.MAX_FORCES_ZOOM }, 'the supported zoom maximum restores')

for (const charges of [null, Array(17).fill(snapshot.charges[0]), [{ ...snapshot.charges[0], x: 1001 }], [{ ...snapshot.charges[0], y: Infinity }], [{ ...snapshot.charges[0], q: 0 }], [{ ...snapshot.charges[0], q: 3 }], [{ ...snapshot.charges[0], q: NaN }], [{ x: 0, y: 0, q: '1' }]]) {
  assert.equal(codec.restoreForcesSnapshot(charges, snapshot.view), null, 'malformed or oversized source charges are rejected')
}
for (const view of [null, { x: Infinity, y: 0, zoom: 1 }, { x: 0, y: -1001, zoom: 1 }, { x: 0, y: 0, zoom: 0 }, { x: 0, y: 0, zoom: codec.MAX_FORCES_ZOOM + .01 }]) {
  assert.equal(codec.restoreForcesView(view), null, 'non-finite or out-of-range camera framing is rejected')
}

const maximum = { charges: Array.from({ length: 16 }, (_, index) => ({ x: index / 7, y: -index / 9, q: index % 2 ? -2 : 2 })), view: { x: 0, y: 0, zoom: 7.56 } }
assert.equal(codec.restoreForcesSnapshot(maximum.charges, maximum.view)?.charges.length, 16, 'the supported sixteen-charge limit restores')
assert.ok(Buffer.from(JSON.stringify({ $armsteel: 1, state: { preset: 'custom', ...maximum } })).toString('base64url').length < 16_000, 'the largest supported charge arrangement fits the notebook and URL state budget')

console.log('Invisible Forces state checks passed: source charges, empty arrangements, camera framing, field bounds and shared-state size.')
