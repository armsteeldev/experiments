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
const exportedNotebook = storage.exportSavedExperimentNotebook(ids)
assert.ok(exportedNotebook, 'a non-empty notebook can be exported')
const portable = JSON.parse(exportedNotebook)
assert.equal(portable.$armsteelNotebook, 1, 'portable notebook files have a separate explicit version')
assert.ok(Number.isFinite(Date.parse(portable.exportedAt)), 'portable notebook files carry a valid export timestamp')
assert.deepEqual(portable.experiments, firstSave.experiments, 'the exported file contains the validated saved configuration')
store.delete('armsteel:saved-scenes')
const importedNotebook = storage.importSavedExperimentNotebook(portable, ids)
assert.equal(importedNotebook.status, 'imported', 'a valid notebook can be imported into an empty browser')
assert.equal(importedNotebook.importedCount, 1)
assert.equal(importedNotebook.skippedCount, 0)
assert.deepEqual(storage.getSavedExperiments(ids), firstSave.experiments, 'portable import preserves supported settings and their names')
assert.equal(storage.importSavedExperimentNotebook(portable, ids).status, 'no-new', 'importing the same notebook again does not duplicate entries')
assert.equal(storage.getSavedExperiments(ids).length, 1, 'repeated import leaves the notebook unchanged')
const conflictingArchive = { ...portable, experiments: [{ ...portable.experiments[0], name: 'A different name', state: { preset: 'different' } }] }
const conflictImport = storage.importSavedExperimentNotebook(conflictingArchive, ids)
assert.equal(conflictImport.importedCount, 1, 'an ID collision with different content is retained as a separate setup')
assert.notEqual(conflictImport.experiments[0].id, portable.experiments[0].id, 'conflicting imports receive a fresh local ID')
assert.deepEqual(conflictImport.experiments[1].state, firstSave.experiments[0].state, 'a conflicting import never overwrites the local setup')
const rejectedNotebook = storage.importSavedExperimentNotebook({ ...portable, $armsteelNotebook: 2 }, ids)
assert.equal(rejectedNotebook.status, 'invalid', 'unknown notebook versions fail closed')
assert.equal(storage.getSavedExperiments(ids).length, 2, 'an unsupported notebook leaves local entries unchanged')
const filteredNotebook = storage.importSavedExperimentNotebook({ ...portable, experiments: [portable.experiments[0], { ...portable.experiments[0], id: 'scene-removed-1', exhibitId: 'removed-exhibit' }] }, ids)
assert.equal(filteredNotebook.status, 'no-new', 'valid duplicate and unsupported exhibit entries add nothing')
assert.equal(filteredNotebook.skippedCount, 2, 'portable import reports duplicates and unsupported exhibits as skipped')
assert.equal(storage.importSavedExperimentNotebook({ ...portable, oversize: 'x'.repeat(storage.MAX_NOTEBOOK_FILE_BYTES) }, ids).status, 'invalid', 'oversized notebook archives are rejected before merging')
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
const cappedImport = storage.importSavedExperimentNotebook(portable, ids)
assert.equal(cappedImport.status, 'no-new', 'portable imports respect the existing twelve-entry cap')
assert.equal(cappedImport.skippedCount, 1, 'entries that do not fit the notebook cap are reported as skipped')
assert.equal(storage.getSavedExperiments(ids).length, 12, 'an over-cap import leaves all existing records intact')

const shared = { preset: 'aurora', value: 12, label: 'ström' }
const encoded = storage.encodeState(shared)
assert.deepEqual(storage.decodeState(`?state=${encoded}`), shared, 'shared state round-trips Unicode')
assert.deepEqual(storage.decodeState(`?state=${Buffer.from(JSON.stringify({ preset: 'legacy' })).toString('base64url')}`), { preset: 'legacy' }, 'unversioned shared links remain readable')
assert.equal(storage.encodeState({ value: Number.NaN }), '', 'non-finite shared values are not encoded as misleading nulls')
assert.equal(storage.encodeState([]), '', 'shared state roots must be plain records')
assert.equal(storage.encodeState(JSON.parse('{"__proto__":true}')), '', 'unsafe object keys cannot enter a shared URL')
const deepState = { value: true }
for (let index = 0; index < 11; index++) deepState.value = { next: deepState.value }
assert.equal(storage.encodeState({ nested: deepState }), '', 'shared state nesting is bounded before encoding')
const unsafeEnvelope = Buffer.from(JSON.stringify({ $armsteel: 1, state: JSON.parse('{"constructor":{"prototype":{"polluted":true}}}') })).toString('base64url')
assert.equal(storage.decodeState(`?state=${unsafeEnvelope}`), null, 'unsafe keys in a versioned URL are rejected')
const deepEnvelope = Buffer.from(JSON.stringify({ $armsteel: 1, state: { nested: deepState } })).toString('base64url')
assert.equal(storage.decodeState(`?state=${deepEnvelope}`), null, 'excessively nested versioned URLs are rejected')
const deepLegacy = Buffer.from(JSON.stringify(deepState)).toString('base64url')
assert.equal(storage.decodeState(`?state=${deepLegacy}`), null, 'legacy URLs obey the same nested-state limits')
const tooManyFields = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`field${index}`, index]))
assert.equal(storage.encodeState(tooManyFields), '', 'shared records have a bounded field count')
const cyclic = {}; cyclic.self = cyclic
assert.equal(storage.encodeState(cyclic), '', 'cyclic shared state is rejected before JSON serialization')
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
const volatileImport = storage.importSavedExperimentNotebook(portable, ids)
assert.equal(volatileImport.status, 'memory-only', 'portable imports remain usable when browser storage is blocked')
assert.equal(volatileImport.importedCount, 1, 'the blocked-storage import still provides the setup in memory')
blocked = false
store.delete('armsteel:saved-scenes')
assert.ok(storage.getSavedExperiments(ids).some((item) => item.exhibitId === 'adder'), 'a tab-only save survives a later storage recovery')
assert.ok(storage.getSavedExperiments(ids).some((item) => item.exhibitId === 'mandelbrot'), 'a tab-only import survives a later storage recovery')

console.log('Storage checks passed: favorites, notebook schema/caps/recovery, shared state, volatile visits, and blocked storage.')
