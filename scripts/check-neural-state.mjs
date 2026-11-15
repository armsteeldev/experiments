import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/neuralState.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const state = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const examples = [
  { x: [-1, 1], y: 0 },
  { x: [0.12345678901234567, -0.9876543210987654], y: 1 },
]
assert.deepEqual(state.restoreNeuralSamples(examples), examples, 'custom examples retain their exact bounded coordinates and labels')
assert.deepEqual(state.restoreNeuralSamples([]), [], 'an intentionally blank custom lesson remains valid')
assert.equal(state.restoreNeuralSamples(undefined), null)
assert.equal(state.restoreNeuralSamples(examples.concat({ x: [0, 0], y: 1 }, ...Array.from({ length: state.MAX_SHARED_NEURAL_SAMPLES }, () => ({ x: [0, 0], y: 0 })))), null, 'oversized custom lessons are rejected as a unit')
for (const invalid of [
  [{ x: [0, 0], y: 2 }],
  [{ x: [0, 1.01], y: 1 }],
  [{ x: [0, Number.NaN], y: 1 }],
  [{ x: [0], y: 1 }],
  [{ x: [0, 0], y: '1' }],
  [{ x: [0, 0], y: 1 }, null],
]) assert.equal(state.restoreNeuralSamples(invalid), null, `unsafe training examples are rejected: ${JSON.stringify(invalid)}`)

const worstSized = Array.from({ length: state.MAX_SHARED_NEURAL_SAMPLES }, (_, index) => ({
  x: [index % 2 ? 0.12345678901234567 : -0.12345678901234567, index % 3 ? 0.9876543210987654 : -0.9876543210987654],
  y: index % 2,
}))
const encodedState = Buffer.from(JSON.stringify({ $armsteel: 1, state: { dataset: 'custom', examples: worstSized } }), 'utf8')
assert.ok(encodedState.byteLength <= 16 * 1024, 'maximum custom lesson stays below the shared/local state byte limit')

console.log(`Neural shared-state checks passed: bounded round trip for ${state.MAX_SHARED_NEURAL_SAMPLES} examples, strict recovery, and ${encodedState.byteLength}-byte maximum state.`)
