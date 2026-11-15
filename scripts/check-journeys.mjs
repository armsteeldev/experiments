import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../src/data/', import.meta.url)
const journeys = JSON.parse(await readFile(new URL('journeys.json', root), 'utf8'))
const experiments = JSON.parse(await readFile(new URL('experiments.json', root), 'utf8'))
const ids = new Set(experiments.map((item) => item.id))

assert.ok(Array.isArray(journeys) && journeys.length >= 3, 'curation has at least three optional paths')
assert.equal(new Set(journeys.map((journey) => journey.id)).size, journeys.length, 'journey IDs are unique')
for (const journey of journeys) {
  assert.match(journey.id, /^[a-z0-9-]{1,32}$/, `${journey.id} is a safe query value`)
  assert.ok(journey.shortTitle.trim(), `${journey.id} has a concise tab label`)
  assert.ok(journey.title.trim() && journey.description.trim(), `${journey.id} has editorial context`)
  assert.ok(Array.isArray(journey.stops) && journey.stops.length >= 3 && journey.stops.length <= 6, `${journey.id} has a short walk of 3–6 stops`)
  assert.equal(new Set(journey.stops.map((stop) => stop.exhibit)).size, journey.stops.length, `${journey.id} does not repeat an exhibit`)
  for (const stop of journey.stops) {
    assert.ok(ids.has(stop.exhibit), `${journey.id} references the registered ${stop.exhibit} route`)
    assert.ok(stop.note.trim().length >= 55 && stop.note.length <= 190, `${journey.id}/${stop.exhibit} explains the connection concisely`)
  }
}

console.log(`Curated path checks passed: ${journeys.length} paths, ${journeys.reduce((sum, journey) => sum + journey.stops.length, 0)} stops, all routes and transitions present.`)
