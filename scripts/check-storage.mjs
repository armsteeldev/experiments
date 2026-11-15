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

const firstSave = storage.saveExperimentState('mandelbrot', '  Shore view  ', { preset: 'seahorse', zoom: 5 }, ids)
assert.equal(firstSave.status, 'saved', 'a supported configuration is saved locally')
assert.equal(firstSave.experiments[0].name, 'Shore view', 'saved names are trimmed')
assert.deepEqual(storage.getSavedExperiments(ids)[0].state, { preset: 'seahorse', zoom: 5 }, 'saved settings round-trip')
assert.equal(JSON.parse(store.get('armsteel:saved-scenes')).version, 1, 'saved notebook records have an explicit schema version')
assert.equal(storage.saveExperimentState('obsolete-study', 'Unknown', { preset: 'x' }, ids).status, 'invalid', 'unknown exhibit IDs are rejected')
assert.equal(storage.saveExperimentState('fluid', 'Empty', {}, ids).status, 'invalid', 'empty configurations are rejected')
assert.equal(storage.saveExperimentState('fluid', 'Unsupported', { date: new Date() }, ids).status, 'invalid', 'non-plain values are rejected')

store.set('armsteel:saved-scenes', '{malformed')
assert.deepEqual(storage.getSavedExperiments(ids), [], 'malformed notebook data resets safely')
store.set('armsteel:saved-scenes', 'x'.repeat(140_000))
assert.deepEqual(storage.getSavedExperiments(ids), [], 'oversized notebook data is rejected before parsing')
store.set('armsteel:saved-scenes', '{malformed')
const recovered = storage.saveExperimentState('fluid', 'Flow', { viscosity: 0.7 }, ids)
assert.equal(recovered.status, 'saved', 'a corrupted notebook can be used again')
const record = JSON.parse(store.get('armsteel:saved-scenes'))
record.experiments.push({ id: 'scene-obsolete', exhibitId: 'removed-exhibit', name: 'Old', savedAt: new Date().toISOString(), state: { preset: 'old' } })
store.set('armsteel:saved-scenes', JSON.stringify(record))
assert.deepEqual(storage.getSavedExperiments(ids).map((item) => item.exhibitId), ['fluid'], 'records for removed exhibits are ignored')
const removable = storage.getSavedExperiments(ids)[0]
assert.equal(storage.removeSavedExperiment(removable.id, ids).experiments.length, 0, 'saved configurations can be removed')

store.set('armsteel:saved-scenes', JSON.stringify({ version: 1, experiments: Array.from({ length: 9 }, (_, index) => ({
  id: `scene-seeded-${String(index).padStart(2, '0')}`,
  exhibitId: 'fluid', name: `Entry ${index}`, savedAt: new Date().toISOString(), state: { payload: 'x'.repeat(14_000) },
})) }))
assert.equal(storage.getSavedExperiments(ids).length, 9, 'entries within the aggregate notebook budget remain readable')
assert.equal(storage.saveExperimentState('fluid', 'Large', { payload: 'x'.repeat(14_000) }, ids).status, 'too-large', 'the aggregate notebook byte budget is enforced')

store.set('armsteel:saved-scenes', JSON.stringify({ version: 1, experiments: Array.from({ length: 12 }, (_, index) => ({
  id: `scene-capped-${String(index).padStart(2, '0')}`,
  exhibitId: 'fluid', name: `Entry ${index}`, savedAt: new Date().toISOString(), state: { viscosity: index },
})) }))
assert.equal(storage.saveExperimentState('fluid', 'Thirteenth', { viscosity: 0.3 }, ids).status, 'full', 'the notebook has a twelve-entry cap')

const shared = { preset: 'aurora', value: 12, label: 'ström' }
const encoded = storage.encodeState(shared)
assert.deepEqual(storage.decodeState(`?state=${encoded}`), shared, 'shared state round-trips Unicode')
assert.deepEqual(storage.decodeState(`?state=${Buffer.from(JSON.stringify({ preset: 'legacy' })).toString('base64url')}`), { preset: 'legacy' }, 'unversioned shared links remain readable')
assert.equal(storage.decodeState('?state=%%%'), null, 'invalid state is ignored')
assert.equal(storage.decodeState(`?state=${'A'.repeat(40_000)}`), null, 'oversized state is rejected')
assert.equal(storage.decodeState(`?state=${storage.encodeState([])}`), null, 'arrays are not accepted as state objects')
assert.equal(storage.decodeState(`?state=${Buffer.from(JSON.stringify({ $armsteel: 2, state: { preset: 'future' } })).toString('base64url')}`), null, 'unknown shared-state versions are rejected')

store.set('armsteel:saved-scenes', JSON.stringify({ version: 1, experiments: [{
  id: 'scene-volatile-seed', exhibitId: 'fluid', name: 'Seed', savedAt: new Date().toISOString(), state: { viscosity: 0.2 },
}] }))
storage.getSavedExperiments(ids)
blocked = true
assert.deepEqual(storage.getFavorites(ids), ['mandelbrot', 'fluid'], 'blocked browser storage falls back to memory')
assert.deepEqual(storage.toggleFavorite('fluid', ids), ['mandelbrot'], 'favorites remain usable when storage writes fail')
const volatile = storage.saveExperimentState('adder', 'Volatile setup', { task: '12 + 3' }, ids)
assert.equal(volatile.status, 'memory-only', 'saved configurations remain available for the current tab when storage writes are blocked')
assert.equal(storage.getSavedExperiments(ids)[0].exhibitId, 'adder', 'memory-only configurations remain readable')
blocked = false
store.delete('armsteel:saved-scenes')
assert.equal(storage.getSavedExperiments(ids)[0].exhibitId, 'adder', 'a tab-only save survives a later storage recovery')

console.log('Storage checks passed: favorites, notebook schema/caps/recovery, shared state, volatile visits, and blocked storage.')
