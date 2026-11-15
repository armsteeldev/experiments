import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/experimentState.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const state = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

assert.equal(state.boundedStateNumber('3.5', 1, 0, 4), 3.5, 'legacy numeric strings remain readable')
assert.equal(state.boundedStateNumber(-12, 1, 0, 4), 0, 'values below the supported range clamp to the boundary')
assert.equal(state.boundedStateNumber(12, 1, 0, 4), 4, 'values above the supported range clamp to the boundary')
for (const invalid of [undefined, null, '', 'nope', true, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  assert.equal(state.boundedStateNumber(invalid, 2, 0, 4), 2, `invalid numeric value ${String(invalid)} uses its model default`)
}
assert.equal(state.boundedStateInteger(2.6, 2, 1, 5), 3, 'integer parameters are rounded after bounding')
assert.equal(state.boundedStateSeed(-1, 7), 0, 'negative seeds clamp rather than wrap to an unrelated value')
assert.equal(state.boundedStateSeed(0xffff_ffff, 7), 0xffff_ffff, 'the full uint32 seed domain remains available')
assert.equal(state.boundedStateSeed(0x1_0000_0000, 7), 0xffff_ffff, 'oversized seeds clamp to the documented uint32 maximum')
assert.equal(state.stateChoice('fern', ['fern', 'tree'], 'tree'), 'fern', 'known state choices survive')
assert.equal(state.stateChoice('invalid', ['fern', 'tree'], 'tree'), 'tree', 'unknown state choices recover to a valid option')
assert.equal(state.stateChoice(1, ['fern', 'tree'], 'tree'), 'tree', 'non-string choices recover safely')

console.log('Experiment state checks passed: finite bounds, legacy numbers, integer rounding, uint32 seeds and enum recovery.')
