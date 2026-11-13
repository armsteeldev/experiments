import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/lib/storage.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const store = new Map()
let blocked = false
globalThis.window = {
  localStorage: {
    getItem(key) {
      if (blocked) throw new Error('storage unavailable')
      return store.get(key) ?? null
    },
    setItem(key, value) {
      if (blocked) throw new Error('storage unavailable')
      store.set(key, value)
    },
  },
}
const storage = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const ids = ['mandelbrot', 'fluid', 'adder']

store.set('armsteel:favorites', '{malformed')
assert.deepEqual(storage.getFavorites(ids), [], 'malformed favorites reset safely')
assert.deepEqual(storage.toggleFavorite('adder', ids), ['adder'], 'a valid favorite can be saved')
store.set('armsteel:favorites', JSON.stringify(['fluid', 'obsolete-study', 'fluid', 7]))
assert.deepEqual(storage.getFavorites(ids), ['fluid'], 'unknown, duplicate, and non-string favorites are removed')
assert.deepEqual(storage.toggleFavorite('mandelbrot', ids), ['mandelbrot', 'fluid'], 'favorite order is stable and newest first')

assert.deepEqual(storage.rememberVisit('fluid', ids), ['fluid'])
assert.deepEqual(storage.rememberVisit('not-a-study', ids), ['fluid'], 'unknown visits are ignored')
assert.deepEqual(storage.rememberVisit('adder', ids), ['adder', 'fluid'])
assert.deepEqual([...store.keys()], ['armsteel:favorites'], 'recent visits are kept only in memory')

const shared = { preset: 'aurora', value: 12, label: 'ström' }
const encoded = storage.encodeState(shared)
assert.deepEqual(storage.decodeState(`?state=${encoded}`), shared, 'shared state round-trips Unicode')
assert.equal(storage.decodeState('?state=%%%'), null, 'invalid state is ignored')
assert.equal(storage.decodeState(`?state=${'A'.repeat(40_000)}`), null, 'oversized state is rejected')
assert.equal(storage.decodeState(`?state=${storage.encodeState([])}`), null, 'arrays are not accepted as state objects')

blocked = true
assert.deepEqual(storage.getFavorites(ids), ['mandelbrot', 'fluid'], 'blocked browser storage falls back to memory')
assert.deepEqual(storage.toggleFavorite('fluid', ids), ['mandelbrot'], 'favorites remain usable when storage writes fail')

console.log('Storage checks passed: favorites, volatile visits, invalid records, shared state, and blocked storage.')
