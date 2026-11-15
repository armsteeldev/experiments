import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9351)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5198'
const experiments = JSON.parse(await readFile(new URL('../src/data/experiments.json', import.meta.url), 'utf8'))
const evidenceRoot = resolve('docs/renaissance/evidence')
let deeplyNestedState = true
for (let index = 0; index < 11; index++) deeplyNestedState = { nested: deeplyNestedState }
const invalidState = Buffer.from(JSON.stringify({ $armsteel: 1, state: { nested: deeplyNestedState } })).toString('base64url')
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
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function click(selector) {
  const found = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true })()`)
  assert.ok(found, `Could not click ${selector}`)
}

async function clickNeuralMapAt(x, y) {
  const point = await evaluate(`(() => {
    const canvas = document.querySelector('.neural-learning-map')
    const rect = canvas?.getBoundingClientRect()
    if (!rect) return null
    const mobile = rect.width < 720
    const plot = mobile
      ? { x: 16, y: Math.max(132, rect.height * .2), w: rect.width - 32, h: Math.max(210, rect.height * .55) }
      : { x: 44, y: 154, w: rect.width - 88, h: Math.max(280, rect.height - 294) }
    return { x: rect.left + plot.x + (${x} + 1) * plot.w / 2, y: rect.top + plot.y + (1 - (${y})) * plot.h / 2 }
  })()`)
  assert.ok(point, 'Neural map canvas is available for the custom example')
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__armsteelCopied = text } } })` })
await mkdir(evidenceRoot, { recursive: true })
const routeResults = []

for (const item of experiments) {
  await call('Page.navigate', { url: `${base}/exhibits/${item.id}` })
  await waitFor(`location.pathname === ${JSON.stringify(`/exhibits/${item.id}`)} && Boolean(document.querySelector('.dock-current span')) && !document.querySelector('.experience-loading')`, `${item.id} exhibit mount`)
  await sleep(160)
  if (item.id === 'adder') {
    await click('button[aria-label="Toggle experiment controls"]')
    await waitFor(`document.querySelector('.control-panel select')?.options.length > 1`, 'Adder settings')
    await evaluate(`(() => {
      const selects = [...document.querySelectorAll('.control-panel select')]
      const setSelect = (label, value) => {
        const select = selects.find((node) => node.closest('label')?.querySelector('span')?.textContent === label)
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setSelect('Circuit width', '8')
      setSelect('Carry architecture', 'lookahead')
      for (const [label, value] of [['First number', '23'], ['Second number', '17']]) {
        const input = [...document.querySelectorAll('input')].find((node) => node.getAttribute('aria-label') === label)
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
      }
    })()`)
    await waitFor(`document.querySelector('.control-panel select')?.value === '8' && document.querySelector('[aria-label="First number"]')?.value === '23' && document.querySelector('[aria-label="Second number"]')?.value === '17'`, 'changed Adder parameters')
    await sleep(160)
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(resolve(evidenceRoot, 'state-sharing-adder-settings.png'), Buffer.from(screenshot.data, 'base64'))
    await click('button[aria-label="Toggle experiment controls"]')
  }
  if (item.id === 'network') {
    await click('button[aria-label="Toggle experiment controls"]')
    await waitFor(`Boolean(document.querySelector('.iw-message-input input'))`, 'network message setting')
    await evaluate(`(() => { const input = document.querySelector('.iw-message-input input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'curious packet'); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'curious packet' })) })()`)
    await waitFor(`document.querySelector('.iw-message-input input')?.value === 'curious packet'`, 'changed network message')
    await sleep(160)
    await click('button[aria-label="Toggle experiment controls"]')
  }
  let neuralReplay = null
  if (item.id === 'neural') {
    await click('.neural-patterns button:last-child')
    await click('.class-tool.class-zero')
    await clickNeuralMapAt(-0.56, 0.7)
    await click('.class-tool.class-one')
    await clickNeuralMapAt(0.57, 0.4)
    await waitFor(`document.querySelector('.neural-score span')?.textContent.startsWith('2 EXAMPLES')`, 'two user-drawn neural examples')
    await click('button[aria-label="Toggle experiment controls"]')
    await waitFor(`Boolean([...document.querySelectorAll('.control-panel button')].find((node) => node.textContent.includes('Reset the weights')))`, 'neural reset control')
    await click('.control-panel button.small-action')
    await waitFor(`Boolean(document.querySelector('.neural-score span')?.textContent.includes('2 EXAMPLES'))`, 'neural lesson retained after weight reset')
    await click('.neural-inspect-button')
    await waitFor(`Boolean(document.querySelector('.weight-inspection'))`, 'neural weight inspection')
    const initialWeight = await evaluate(`document.querySelector('.weight-inspection')?.getAttribute('aria-label')`)
    assert.ok(initialWeight, 'reset network exposes a weight for reproducibility')
    neuralReplay = { initialWeight, examples: 2 }
    await click('.neural-inspect-button')
    await click('button[aria-label="Toggle experiment controls"]')
  }
  await click('button[aria-label="Toggle experiment information"]')
  await waitFor(`Boolean(document.querySelector('.info-actions button:last-child'))`, `${item.id} share control`)
  await click('.info-actions button:last-child')
  await waitFor(`typeof window.__armsteelCopied === 'string' && window.__armsteelCopied.length > 0`, `${item.id} copied link`)
  const shared = await evaluate(`(() => { const url = new URL(window.__armsteelCopied); return { href: url.href, state: url.searchParams.get('state') } })()`)
  assert.equal(new URL(shared.href).pathname, `/exhibits/${item.id}`, `${item.id} shares its own route`)
  assert.ok(shared.state && shared.state.length <= 32_768, `${item.id} share state is missing or oversized`)
  const decoded = JSON.parse(Buffer.from(shared.state, 'base64url').toString('utf8'))
  assert.equal(decoded.$armsteel, 1, `${item.id} uses the current state schema`)
  assert.ok(decoded.state && typeof decoded.state === 'object' && !Array.isArray(decoded.state), `${item.id} has an object-shaped state`)
  assert.ok(Object.keys(decoded.state).length > 0, `${item.id} shares its meaningful configuration`)
  if (item.id === 'adder') assert.deepEqual(decoded.state, { width: 8, architecture: 'lookahead', speed: 1, a: 23, b: 17 }, 'Adder shares the edited circuit, inputs and speed')
  if (item.id === 'network') assert.equal(decoded.state.message, 'curious packet', 'the network shares its message payload explicitly')
  if (item.id === 'neural') {
    assert.equal(decoded.state.dataset, 'custom', 'Neural Networks shares the custom lesson kind')
    assert.equal(decoded.state.weightSeed, 3, 'Neural Networks shares the seed of its latest weight reset')
    assert.deepEqual(decoded.state.examples.map((sample) => sample.y), [0, 1], 'Neural Networks shares both example labels')
    for (const [index, expected] of [[-0.56, 0.7], [0.57, 0.4]].entries()) {
      assert.ok(Math.abs(decoded.state.examples[index].x[0] - expected[0]) < 0.01 && Math.abs(decoded.state.examples[index].x[1] - expected[1]) < 0.01, `Neural Networks restores example ${index + 1} coordinates`)
    }
  }
  const stateBytes = Buffer.byteLength(JSON.stringify(decoded), 'utf8')
  assert.ok(stateBytes <= 16 * 1024, `${item.id} state is within the shared/local state limit`)
  await call('Page.navigate', { url: shared.href })
  await waitFor(`location.pathname === ${JSON.stringify(`/exhibits/${item.id}`)} && new URLSearchParams(location.search).has('state') && Boolean(document.querySelector('.dock-current span')) && !document.querySelector('.experience-loading')`, `${item.id} shared-link restore`)
  if (item.id === 'adder') {
    await click('button[aria-label="Toggle experiment controls"]')
    await waitFor(`document.querySelector('.control-panel select')?.value === '8'`, 'restored Adder circuit width')
    const adder = await evaluate(`({ selects: [...document.querySelectorAll('.control-panel select')].map((node) => node.value), a: document.querySelector('[aria-label="First number"]')?.value, b: document.querySelector('[aria-label="Second number"]')?.value, result: document.querySelector('.adder-answer strong')?.textContent })`)
    assert.deepEqual(adder, { selects: ['8', 'lookahead'], a: '23', b: '17', result: '40' }, 'Adder settings restore and evaluate through the visible circuit')
  }
  if (item.id === 'network') {
    await click('button[aria-label="Toggle experiment controls"]')
    await waitFor(`document.querySelector('.iw-message-input input')?.value === 'curious packet'`, 'restored network message payload')
  }
  if (item.id === 'neural') {
    await waitFor(`document.querySelector('.neural-score span')?.textContent.startsWith('2 EXAMPLES')`, 'restored custom neural examples')
    await click('.neural-inspect-button')
    await waitFor(`Boolean(document.querySelector('.weight-inspection'))`, 'restored seeded network weights')
    const restoredWeight = await evaluate(`document.querySelector('.weight-inspection')?.getAttribute('aria-label')`)
    assert.equal(restoredWeight, neuralReplay.initialWeight, 'the shared weight seed recreates the visible initial network')
    await click('.neural-inspect-button')
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(resolve(evidenceRoot, 'neural-custom-lesson-restored.png'), Buffer.from(screenshot.data, 'base64'))
    const malformedExamples = Buffer.from(JSON.stringify({ $armsteel: 1, state: { dataset: 'custom', weightSeed: 3, examples: [{ x: [0, 1.01], y: 1 }] } })).toString('base64url')
    await call('Page.navigate', { url: `${base}/exhibits/neural?state=${malformedExamples}` })
    await waitFor(`location.pathname === '/exhibits/neural' && Boolean(document.querySelector('.neural-score span')) && !document.querySelector('.experience-loading')`, 'malformed neural custom lesson recovery')
    await waitFor(`document.querySelector('.neural-score span')?.textContent.startsWith('0 EXAMPLES')`, 'malformed neural lesson safely opens blank')
    assert.equal(await evaluate(`Boolean(document.querySelector('.experience-error'))`), false, 'malformed neural examples do not enter the error boundary')
    neuralReplay = { ...neuralReplay, sharedWeightSeed: decoded.state.weightSeed, restoredWeight, malformedExamplesRecoverBlank: true }
  }
  await call('Page.navigate', { url: `${base}/exhibits/${item.id}?state=${invalidState}` })
  await waitFor(`location.pathname === ${JSON.stringify(`/exhibits/${item.id}`)} && Boolean(document.querySelector('.dock-current span')) && !document.querySelector('.experience-loading')`, `${item.id} recovery from structurally invalid shared state`)
  assert.equal(await evaluate(`Boolean(document.querySelector('.experience-error'))`), false, `${item.id} opens with safe defaults after an invalid nested state is rejected`)
  routeResults.push({ id: item.id, keys: Object.keys(decoded.state), bytes: stateBytes, routeRestored: true, invalidStateRecovery: true, ...(neuralReplay ? { neuralReplay } : {}) })
}

assert.deepEqual(browserErrors, [], `Browser or network errors occurred: ${browserErrors.join('; ')}`)
await mkdir(evidenceRoot, { recursive: true })
await writeFile(resolve(evidenceRoot, 'state-sharing-browser-checks.json'), JSON.stringify({
  browser: await evaluate('navigator.userAgent'),
  version: 1,
  legacyUnversionedDecoder: 'unit-tested in test:storage',
  exhibits: routeResults,
  errors: browserErrors,
}, null, 2) + '\n')
socket.close()
console.log(`State-sharing browser checks passed: ${routeResults.length} exhibits shared and restored, no browser or HTTP errors.`)
