import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const roles = [
  ['search utility actions', /\.exhibition-page \.quiet-button\s*\{[^}]*border:[^}]*background:/s],
  ['filter selection', /\.exhibition-page \.filter-chip\.active\s*\{[^}]*background:/s],
  ['saved favourites', /\.favorite-button\.selected\s*\{/],
  ['segmented choices', /\.segmented-control button\.chosen/],
  ['preset selection', /\.preset-row button\.selected/],
  ['panel actions', /\.panel-action:hover:not\(:disabled\)/],
  ['disabled actions', /\.panel-action:disabled/],
  ['keyboard focus', /button:focus-visible/],
  ['floating dock active state', /\.dock-button\.is-active/],
]
for (const [role, expression] of roles) assert.match(styles, expression, `button styling must define ${role}`)
assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.exhibition-page \.filter-chip \{ min-height: 44px; font-size: 11px;/, 'mobile filter chips keep a readable label and comfortable touch target')

console.log('Button style checks passed: distinct roles, selected/disabled/focus states, and mobile filter targets.')
