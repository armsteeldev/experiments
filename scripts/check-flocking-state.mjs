import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/flockingState.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const codec = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const markers = [
  { x: 0.2, y: 0.75, kind: 'food' },
  { x: 0.81, y: 0.36, kind: 'obstacle' },
  { x: 1, y: 0, kind: 'repel' },
]
assert.deepEqual(codec.restoreFlockingMarkers(markers), markers, 'normalized marker arrangements restore exactly')
assert.deepEqual(codec.restoreFlockingMarkers([]), [], 'an intentionally cleared field remains clear')
const maximum = Array.from({ length: 16 }, (_, index) => ({ x: index / 15, y: 1 - index / 15, kind: ['food', 'attract', 'repel', 'obstacle'][index % 4] }))
assert.equal(codec.restoreFlockingMarkers(maximum)?.length, 16, 'the supported marker limit restores')
assert.ok(Buffer.from(JSON.stringify({ $armsteel: 1, state: { scenario: 'murmuration', seed: 17, markers: maximum } })).toString('base64url').length < 16_000, 'the full marker arrangement fits the shared-state budget')

for (const invalid of [null, Array(17).fill(markers[0]), [{ ...markers[0], x: -0.01 }], [{ ...markers[0], x: 1.01 }], [{ ...markers[0], y: Infinity }], [{ ...markers[0], kind: 'predator' }], [{ x: '0.5', y: 0.5, kind: 'food' }], [Object.create({ ...markers[0] })]]) {
  assert.equal(codec.restoreFlockingMarkers(invalid), null, 'malformed, non-finite, out-of-bounds or unsupported markers are rejected')
}

console.log('Flocking state checks passed: normalized field markers, explicit empty arrangements, marker bounds and shared-state size.')
