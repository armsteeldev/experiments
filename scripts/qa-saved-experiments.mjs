import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9350)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5198'
const evidenceRoot = resolve('docs/renaissance/evidence')
const downloadRoot = await mkdtemp(resolve('.armsteel-notebook-qa-'))
process.once('exit', () => { try { rmSync(downloadRoot, { recursive: true, force: true }) } catch { /* remove task-local browser artifacts on failure too */ } })
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && target.url === 'about:blank') ?? targets.find((target) => target.type === 'page')
assert.ok(page, `No page target found on CDP port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 0
const waiting = new Map()
const browserErrors = []
const downloadEvents = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve: resolveCall, reject, method, timeout } = waiting.get(message.id)
    clearTimeout(timeout)
    waiting.delete(message.id)
    if (message.error) reject(new Error(`${method}: ${message.error.message}`))
    else resolveCall(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(`uncaught: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(`console: ${message.params.args.map((item) => item.value ?? item.description ?? '').join(' ')}`)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(`log: ${message.params.entry.text}`)
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserErrors.push(`http ${message.params.response.status}: ${message.params.response.url}`)
  if (message.method?.startsWith('Browser.download')) downloadEvents.push({ method: message.method, ...message.params })
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => {
      if (!waiting.has(id)) return
      waiting.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
    waiting.set(id, { resolve: resolveCall, reject, method, timeout })
  })
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function navigate(path) {
  await call('Page.navigate', { url: `${base}${path}` })
}

async function click(selector) {
  const found = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true })()`)
  assert.ok(found, `Could not click ${selector}`)
}

async function chooseNotebookFile(path) {
  const document = await call('DOM.getDocument', { depth: -1 })
  const input = await call('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#saved-notebook-import' })
  assert.ok(input.nodeId, 'the notebook import has a real browser file input')
  assert.equal(await evaluate(`document.querySelector('#saved-notebook-import')?.type`), 'file', 'the notebook importer is a browser file input')
  await call('DOM.setFileInputFiles', { files: [path], nodeId: input.nodeId })
}

async function waitForDownload() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const completed = downloadEvents.find((event) => event.method === 'Browser.downloadProgress' && event.state === 'completed' && event.filePath)
    if (completed) {
      try { if ((await stat(completed.filePath)).isFile()) return completed.filePath } catch { /* wait for the filesystem to finish its final rename */ }
    }
    await sleep(100)
  }
  throw new Error(`The notebook export did not produce a completed JSON download. Events: ${JSON.stringify(downloadEvents)}`)
}

async function setViewport(width, height, mobile) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
  await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 })
}

async function capture(name) {
  const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(resolve(evidenceRoot, name), Buffer.from(result.data, 'base64'))
}

await mkdir(evidenceRoot, { recursive: true })
await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('DOM.enable')
await call('Page.setInterceptFileChooserDialog', { enabled: false })
await setViewport(1440, 900, false)
await navigate('/exhibits/automata')
await waitFor(`location.pathname === '/exhibits/automata' && Boolean(document.querySelector('.automata-surface'))`, 'the Cellular Automata exhibit')
await evaluate(`localStorage.removeItem('armsteel:saved-scenes')`)
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelector('.control-panel select')?.options.length > 1`, 'the experiment controls')

await evaluate(`(() => {
  const selects = [...document.querySelectorAll('.control-panel select')]
  const set = (label, value) => {
    const select = selects.find((node) => node.closest('label')?.querySelector('span')?.textContent === label)
    if (!select || ![...select.options].some((option) => option.value === value)) return false
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return select.value === value
  }
  return { rule: set('Rule system', 'highlife'), pattern: set('Starting pattern', 'glider'), rendering: set('Rendering', 'ember') }
})()`)
await sleep(220)
const selected = await evaluate(`Object.fromEntries([...document.querySelectorAll('.control-panel select')].map((node) => [node.closest('label')?.querySelector('span')?.textContent, node.value]))`)
assert.equal(selected['Rule system'], 'highlife', 'visitor can change the rule before saving')
assert.equal(selected['Starting pattern'], 'glider', 'visitor can choose a different starting world')
assert.equal(selected.Rendering, 'ember', 'visitor can change visual settings before saving')

await click('button[aria-label="Toggle experiment information"]')
await waitFor(`Boolean(document.querySelector('.saved-experiment-save input'))`, 'the notebook form in the About panel')
const formGeometry = await evaluate(`(() => { const panel = document.querySelector('.info-panel'), input = document.querySelector('#saved-experiment-name'); return { note: document.querySelector('#saved-experiment-note')?.textContent, panel: panel?.getBoundingClientRect().toJSON(), input: input?.getBoundingClientRect().toJSON(), width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth } })()`)
assert.match(formGeometry.note, /full history is not/i, 'the form is honest about replay limits')
assert.ok(!formGeometry.overflow, `The notebook form causes page overflow: ${JSON.stringify(formGeometry)}`)
await evaluate(`(() => { const input = document.querySelector('#saved-experiment-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Pulsar with HighLife'); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Pulsar with HighLife' })) })()`)
await waitFor(`document.querySelector('#saved-experiment-name')?.value === 'Pulsar with HighLife'`, 'the editable save name')
await click('.saved-experiment-save button')
await waitFor(`document.querySelector('.saved-experiment-status')?.textContent === 'Saved in this browser.'`, 'the save confirmation')
const savedRecord = await evaluate(`JSON.parse(localStorage.getItem('armsteel:saved-scenes'))`)
assert.equal(savedRecord.version, 1, 'the notebook uses its versioned local schema')
assert.equal(savedRecord.experiments.length, 1)
assert.deepEqual(savedRecord.experiments[0].state, { pattern: 'glider', rule: 'highlife', speed: 8, renderMode: 'ember', seed: 919 }, 'the saved setup matches the changed exhibit controls')
await capture('saved-setup-about-desktop.png')

await click('button[aria-label="Return to exhibition"]')
await waitFor(`location.pathname === '/' && Boolean(document.querySelector('.saved-experiment-card'))`, 'the notebook entry in the gallery')
const entry = await evaluate(`(() => { const link = document.querySelector('.saved-experiment-card > a'); return { name: link?.querySelector('strong')?.textContent, href: link?.getAttribute('href'), count: document.querySelectorAll('.saved-experiment-card').length } })()`)
assert.equal(entry.name, 'Pulsar with HighLife')
assert.equal(entry.count, 1)
assert.match(entry.href, /^\/exhibits\/automata\?state=/, 'saved setup links carry only its serialized exhibit settings')
const notebookActions = await evaluate(`(() => [...document.querySelectorAll('.saved-notebook-actions button')].map(button=>({name:button.textContent.trim(),height:button.getBoundingClientRect().height,disabled:button.disabled})))()`)
assert.deepEqual(notebookActions.map((item) => item.name), ['Export notebook', 'Import notebook'], 'the gallery exposes both portable notebook actions')
assert.ok(notebookActions.every((item) => item.height >= 43.9), `Notebook controls meet the phone touch target size: ${JSON.stringify(notebookActions)}`)
assert.equal(notebookActions[0].disabled, false, 'a saved notebook can be exported')
await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadRoot, eventsEnabled: true })
await click('.saved-notebook-export')
await waitFor(`document.querySelector('.saved-notebook-status')?.textContent.startsWith('Exported 1 settings-only setup.')`, 'the notebook export confirmation')
const exportedPath = await waitForDownload()
const exportedNotebookText = await readFile(exportedPath, 'utf8')
const exportedNotebook = JSON.parse(exportedNotebookText)
assert.equal(exportedNotebook.$armsteelNotebook, 1, 'the downloaded JSON has the supported notebook version')
assert.equal(exportedNotebook.experiments.length, 1, 'the downloaded JSON contains the named setup')
assert.deepEqual(exportedNotebook.experiments[0].state, savedRecord.experiments[0].state, 'the downloaded file preserves the supported exhibit settings')
await click('.saved-experiment-card > button')
await waitFor(`!document.querySelector('.saved-experiment-card') && Boolean(document.querySelector('.saved-notebook-empty-note'))`, 'the empty but import-ready notebook')
assert.equal(await evaluate(`document.querySelector('.saved-notebook-status')?.textContent`), 'Saved setup removed from this browser. Any exported notebook file remains unchanged.', 'removal replaces the earlier export confirmation with current notebook state')
const emptyActions = await evaluate(`(() => [...document.querySelectorAll('.saved-notebook-actions button')].map(button=>({name:button.textContent.trim(),disabled:button.disabled})))()`)
assert.deepEqual(emptyActions, [{ name: 'Export notebook', disabled: true }, { name: 'Import notebook', disabled: false }], 'an empty notebook disables export while keeping import available')
await evaluate(`(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('.saved-experiments')?.scrollIntoView({ block: 'center', behavior: 'instant' }) })()`)
await sleep(100)
await capture('saved-notebook-empty-desktop.png')
await chooseNotebookFile(exportedPath)
await waitFor(`document.querySelector('.saved-notebook-status')?.textContent.startsWith('Imported 1 setup.') && Boolean(document.querySelector('.saved-experiment-card'))`, 'importing the actual downloaded notebook')
const importedRecord = await evaluate(`JSON.parse(localStorage.getItem('armsteel:saved-scenes'))`)
assert.equal(importedRecord.experiments.length, 1, 'the import restores the saved setup into local storage')
assert.equal(importedRecord.experiments[0].name, 'Pulsar with HighLife', 'the import restores the visitor name')
await evaluate(`(() => { document.querySelector('.saved-experiments')?.scrollIntoView({ block: 'center', behavior: 'instant' }) })()`)
await sleep(100)
const desktopNotebook = await evaluate(`(() => { const rect=document.querySelector('.saved-experiments')?.getBoundingClientRect();return {top:rect?.top,bottom:rect?.bottom,viewport:innerHeight} })()`)
assert.ok(desktopNotebook.top < desktopNotebook.viewport && desktopNotebook.bottom > 0, `Desktop notebook section is not in the screenshot viewport: ${JSON.stringify(desktopNotebook)}`)
await capture('saved-notebook-gallery-desktop.png')
await chooseNotebookFile(exportedPath)
await waitFor(`document.querySelector('.saved-notebook-status')?.textContent.includes('No new setups imported. 1 duplicate')`, 'reimporting an archive without duplicating entries')
assert.equal(await evaluate(`JSON.parse(localStorage.getItem('armsteel:saved-scenes')).experiments.length`), 1, 'a repeat import does not duplicate saved setups')
const unsupportedPath = join(downloadRoot, 'unsupported-notebook.json')
await writeFile(unsupportedPath, JSON.stringify({ $armsteelNotebook: 99, exportedAt: new Date().toISOString(), experiments: exportedNotebook.experiments }))
await chooseNotebookFile(unsupportedPath)
await waitFor(`document.querySelector('.saved-notebook-status')?.textContent.includes('not a supported Armsteel notebook')`, 'rejecting an unsupported notebook version')
assert.equal(await evaluate(`JSON.parse(localStorage.getItem('armsteel:saved-scenes')).experiments.length`), 1, 'invalid notebook import leaves existing records unchanged')
await click('.saved-experiment-card > a')
await waitFor(`location.pathname === '/exhibits/automata' && new URLSearchParams(location.search).has('state') && Boolean(document.querySelector('.automata-surface'))`, 'opening the saved configuration')
const urlState = await evaluate(`JSON.parse(decodeURIComponent(escape(atob(new URLSearchParams(location.search).get('state').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(new URLSearchParams(location.search).get('state').length / 4) * 4, '=')))))`)
assert.equal(urlState.$armsteel, 1, 'the shared URL carries its current schema version')
assert.deepEqual(urlState.state, savedRecord.experiments[0].state, 'the notebook link preserves the saved settings in the URL')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelector('.control-panel select')?.value === 'highlife'`, 'restoring the saved rule')
const restored = await evaluate(`Object.fromEntries([...document.querySelectorAll('.control-panel select')].map((node) => [node.closest('label')?.querySelector('span')?.textContent, node.value]))`)
assert.equal(restored['Rule system'], 'highlife')
assert.equal(restored['Starting pattern'], 'glider')
assert.equal(restored.Rendering, 'ember')
await call('Page.reload')
await waitFor(`location.pathname === '/exhibits/automata' && Boolean(document.querySelector('.automata-surface'))`, 'refreshing a saved-configuration link')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelector('.control-panel select')?.value === 'highlife'`, 'restoring settings after refresh')

await setViewport(390, 844, true)
await click('button[aria-label="Return to exhibition"]')
await waitFor(`location.pathname === '/' && Boolean(document.querySelector('.saved-experiment-card'))`, 'returning to the notebook on mobile')
await evaluate(`(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('.saved-experiments')?.scrollIntoView({ block: 'center', behavior: 'instant' }) })()`)
await sleep(100)
const mobile = await evaluate(`(() => { const section = document.querySelector('.saved-experiments'), card = document.querySelector('.saved-experiment-card'), remove = card?.querySelector('button'), rect = remove?.getBoundingClientRect(); return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, cardWidth: card?.getBoundingClientRect().width, removeTarget: rect && { width: rect.width, height: rect.height }, name: card?.querySelector('strong')?.textContent } })()`)
assert.ok(await evaluate(`(() => { const rect = document.querySelector('.saved-experiments')?.getBoundingClientRect(); return rect && rect.top < innerHeight && rect.bottom > 0 })()`), 'The mobile notebook section is in view')
assert.ok(mobile.documentWidth <= mobile.width + 1, `The mobile notebook overflows: ${JSON.stringify(mobile)}`)
assert.ok(mobile.removeTarget.width >= 43.9 && mobile.removeTarget.height >= 43.9, `The remove target is too small: ${JSON.stringify(mobile)}`)
assert.equal(mobile.name, 'Pulsar with HighLife')
await capture('saved-notebook-gallery-mobile.png')
await setViewport(320, 740, true)
const narrow = await evaluate(`({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, cardWidth: document.querySelector('.saved-experiment-card')?.getBoundingClientRect().width })`)
assert.ok(narrow.documentWidth <= narrow.width + 1, `The narrow notebook overflows: ${JSON.stringify(narrow)}`)
await click('.saved-experiment-card > button')
await waitFor(`!document.querySelector('.saved-experiment-card') && Boolean(document.querySelector('.saved-notebook-empty-note'))`, 'removing a saved setup')
assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('armsteel:saved-scenes')).experiments`), [], 'removal updates local storage')

const unknownState = Buffer.from(JSON.stringify({ $armsteel: 99, state: { pattern: 'glider' } })).toString('base64url')
await navigate(`/exhibits/automata?state=${unknownState}`)
await waitFor(`location.pathname === '/exhibits/automata' && Boolean(document.querySelector('.automata-surface'))`, 'opening an exhibit with an unsupported state version')
assert.equal(await evaluate(`Boolean(document.querySelector('.experience-loading'))`), false, 'unsupported shared state never blocks exhibit entry')

await navigate('/privacy')
await waitFor(`location.pathname === '/privacy' && document.querySelector('.privacy-content')?.textContent.includes('armsteel:saved-scenes')`, 'the saved-state privacy explanation')
const privacy = await evaluate(`document.querySelector('.privacy-content')?.textContent`)
assert.match(privacy, /not include the full history/i)
assert.match(privacy, /favourites nor saved setups are sent to the site/i)
assert.match(privacy, /readable JSON/i)
assert.match(privacy, /neural lesson/i)
assert.deepEqual(browserErrors, [], `Browser or network errors occurred: ${browserErrors.join('; ')}`)

await writeFile(resolve(evidenceRoot, 'saved-experiment-browser-checks.json'), JSON.stringify({
  browser: await evaluate('navigator.userAgent'),
  scenarios: ['changed exhibit settings saved with a local name', 'versioned and validated local record', 'downloaded notebook JSON export', 'empty import-ready notebook', 'import into an empty notebook', 'repeat import without duplicates', 'unsupported-version recovery without data loss', 'URL restoration of rule, pattern and rendering', 'deep-link refresh', 'mobile gallery layout and 44px removal target', 'delete and privacy disclosure'],
  savedState: savedRecord.experiments[0].state,
  exportedArchive: { version: exportedNotebook.$armsteelNotebook, entries: exportedNotebook.experiments.length, bytes: Buffer.byteLength(exportedNotebookText) },
  importedRecord,
  mobile,
  narrow,
  errors: browserErrors,
}, null, 2) + '\n')
socket.close()
await rm(downloadRoot, { recursive: true, force: true })
console.log('Saved experiment browser checks passed: save, JSON export, import, duplicate protection, invalid-version recovery, restore, refresh, mobile layout, delete, privacy disclosure, and no browser/network errors.')
