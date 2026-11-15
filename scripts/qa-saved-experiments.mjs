import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9350)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5198'
const evidenceRoot = resolve('docs/renaissance/evidence')
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
await evaluate(`(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('.saved-experiments')?.scrollIntoView({ block: 'center', behavior: 'instant' }) })()`)
await sleep(100)
const desktopNotebook = await evaluate(`(() => { const rect = document.querySelector('.saved-experiments')?.getBoundingClientRect(); return { scrollY, top: rect?.top, bottom: rect?.bottom, viewport: innerHeight } })()`)
assert.ok(desktopNotebook.top < desktopNotebook.viewport && desktopNotebook.bottom > 0, `Desktop notebook section is not in the screenshot viewport: ${JSON.stringify(desktopNotebook)}`)
await capture('saved-notebook-gallery-desktop.png')
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
assert.ok(mobile.removeTarget.width >= 36 && mobile.removeTarget.height >= 36, `The remove target is too small: ${JSON.stringify(mobile)}`)
assert.equal(mobile.name, 'Pulsar with HighLife')
await capture('saved-notebook-gallery-mobile.png')
await setViewport(320, 740, true)
const narrow = await evaluate(`({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, cardWidth: document.querySelector('.saved-experiment-card')?.getBoundingClientRect().width })`)
assert.ok(narrow.documentWidth <= narrow.width + 1, `The narrow notebook overflows: ${JSON.stringify(narrow)}`)
await click('.saved-experiment-card > button')
await waitFor(`!document.querySelector('.saved-experiment-card')`, 'removing a saved setup')
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
assert.deepEqual(browserErrors, [], `Browser or network errors occurred: ${browserErrors.join('; ')}`)

await writeFile(resolve(evidenceRoot, 'saved-experiment-browser-checks.json'), JSON.stringify({
  browser: await evaluate('navigator.userAgent'),
  scenarios: ['changed exhibit settings saved with a local name', 'versioned and validated local record', 'URL restoration of rule, pattern and rendering', 'deep-link refresh', 'mobile gallery layout and removal target', 'delete and privacy disclosure'],
  savedState: savedRecord.experiments[0].state,
  mobile,
  narrow,
  errors: browserErrors,
}, null, 2) + '\n')
socket.close()
console.log('Saved experiment browser checks passed: save, restore, refresh, mobile layout, delete, privacy disclosure, and no browser/network errors.')
