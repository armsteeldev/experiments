import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/automataState.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const codec = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const sparse = new Uint8Array(codec.AUTOMATA_CELL_COUNT)
sparse[12] = 1
sparse[13] = 1
sparse[codec.AUTOMATA_WIDTH + 12] = 1
sparse[codec.AUTOMATA_WIDTH + 13] = 1
const packedSparse = codec.encodeAutomataCells(sparse)
assert.ok(packedSparse?.startsWith('s:'), 'sparse live/dead patterns use the delta format')
assert.ok(packedSparse.length < 32, 'a sparse drawing stays compact instead of serializing the empty grid')
assert.deepEqual(codec.decodeAutomataCells(packedSparse), sparse, 'a Life pattern round-trips exactly')
assert.ok(Buffer.from(JSON.stringify({ $armsteel: 1, state: { pattern: 'custom', cells: packedSparse } })).toString('base64url').length < 250, 'a sparse custom board yields a short share state')

const refractory = sparse.slice()
refractory[codec.AUTOMATA_WIDTH * 7 + 8] = 2
const packedRefractory = codec.encodeAutomataCells(refractory)
assert.ok(packedRefractory?.startsWith('s:'), 'sparse Brian’s Brain states preserve refractory values in the delta format')
assert.deepEqual(codec.decodeAutomataCells(packedRefractory), refractory, 'sparse firing and refractory states round-trip exactly')

const dense = new Uint8Array(codec.AUTOMATA_CELL_COUNT)
for (let index = 0; index < dense.length; index++) dense[index] = index % 3 === 0 ? 2 : 1
const packedDense = codec.encodeAutomataCells(dense)
assert.ok(packedDense?.startsWith('b2:'), 'dense three-state boards use the bounded two-bit bitmap')
assert.ok(packedDense.length < 6800, 'dense three-state boards remain within the notebook state budget')
assert.deepEqual(codec.decodeAutomataCells(packedDense), dense, 'dense firing and refractory states round-trip exactly')

assert.equal(codec.encodeAutomataCells(new Uint8Array(3)), null, 'wrong grid dimensions are rejected')
const invalidCell = sparse.slice()
invalidCell[2] = 3
assert.equal(codec.encodeAutomataCells(invalidCell), null, 'unknown model states are rejected')
assert.equal(codec.decodeAutomataCells('b1:AAAA'), null, 'truncated grids are rejected')
assert.equal(codec.decodeAutomataCells(`x1:${packedSparse.slice(3)}`), null, 'unknown format versions are rejected')
assert.equal(codec.decodeAutomataCells('s:AA'), null, 'truncated sparse records are rejected')
const reservedState = new Uint8Array(Math.ceil(codec.AUTOMATA_CELL_COUNT / 4))
reservedState[0] = 3
const encodedReserved = Buffer.from(reservedState).toString('base64url')
assert.equal(codec.decodeAutomataCells(`b2:${encodedReserved}`), null, 'reserved two-bit values are rejected')

console.log('Cellular state checks passed: compact 1-/2-bit codecs, exact dimensions, model values and invalid format recovery.')
