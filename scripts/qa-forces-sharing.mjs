import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5217'
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, `No page target found on CDP port ${port}`)
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const waiting = new Map()
const errors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve, reject, method, timeout } = waiting.get(message.id)
    clearTimeout(timeout)
    waiting.delete(message.id)
    if (message.error) reject(new Error(`${method}: ${message.error.message}`))
    else resolve(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`HTTP ${message.params.response.status}: ${message.params.response.url.slice(0, 120)}`)
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    waiting.set(id, { resolve, reject, method, timeout })
  })
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function click(selector) {
  assert.ok(await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true })()`), `Could not click ${selector}`)
}

async function clickButtonText(selector, text) {
  assert.ok(await evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.trim() === ${JSON.stringify(text)}); if (!node) return false; node.click(); return true })()`), `Could not click button labelled ${text}`)
}

async function setRangeByLabel(label, value) {
  assert.ok(await evaluate(`(() => { const input = [...document.querySelectorAll('#experiment-controls input[type="range"]')].find((item) => item.closest('label')?.innerText.includes(${JSON.stringify(label)})); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(String(value))}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input.value === ${JSON.stringify(String(value))} })()`), `Could not set ${label}`)
}

async function copiedState() {
  if (!await evaluate('Boolean(document.querySelector("#experiment-information"))')) {
    await waitFor('Boolean(document.querySelector("button[aria-label=\\"Toggle experiment information\\"]"))', 'information control')
    await click('button[aria-label="Toggle experiment information"]')
  }
  await waitFor('Boolean(document.querySelector(".info-actions button:last-child"))', 'Invisible Forces share action')
  await sleep(120)
  const previous = await evaluate('window.__armsteelCopied || ""')
  await click('.info-actions button:last-child')
  await waitFor(`typeof window.__armsteelCopied === 'string' && window.__armsteelCopied !== ${JSON.stringify(previous)}`, 'fresh Invisible Forces share link')
  const link = await evaluate('window.__armsteelCopied')
  return { link, state: JSON.parse(Buffer.from(new URL(link).searchParams.get('state'), 'base64url').toString('utf8')).state }
}

function stateUrl(state) {
  return `${base}/exhibits/forces?state=${Buffer.from(JSON.stringify({ $armsteel: 1, state })).toString('base64url')}`
}

async function pointerClick(x, y) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
const clipboardOverride = await call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__armsteelCopied = text } } })` })

await call('Page.navigate', { url: `${base}/exhibits/forces` })
await waitFor(`location.pathname === '/exhibits/forces' && document.querySelector('.forces-canvas') && !document.querySelector('.experience-loading')`, 'Invisible Forces canvas')
const canvasPoint = await evaluate(`(() => { const r = document.querySelector('.forces-canvas').getBoundingClientRect(); return { x: r.left + r.width * .74, y: r.top + r.height * .54, width: r.width, height: r.height } })()`)
await click('.forces-tools button:first-child')
await pointerClick(canvasPoint.x, canvasPoint.y)
await waitFor(`document.querySelector('.forces-caption')?.textContent.includes('Charge placed')`, 'positive source placement')
await pointerClick(canvasPoint.x, canvasPoint.y)
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`Boolean([...document.querySelectorAll('#experiment-controls button')].find((button) => button.textContent.trim() === 'Flip polarity'))`, 'selected source controls')
assert.ok(await evaluate(`(() => { const button = [...document.querySelectorAll('#experiment-controls button')].find((item) => item.textContent.trim() === 'Flip polarity'); if (!button) return false; button.click(); return true })()`), 'Could not flip the selected charge polarity')
await waitFor(`document.querySelector('.forces-caption')?.textContent.includes('now negative')`, 'negative source polarity')
await click('button[aria-label="Toggle experiment controls"]')
await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvasPoint.x, y: canvasPoint.y, deltaX: 0, deltaY: -260 })

let shared = await copiedState()
const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await mkdir('docs/renaissance/evidence', { recursive: true })
await writeFile('docs/renaissance/evidence/forces-custom-arrangement.png', Buffer.from(screenshot.data, 'base64'))
await click('button[aria-label="Toggle experiment information"]')
await click('button[aria-label="Toggle experiment controls"]')
await clickButtonText('#experiment-controls button', 'Potential on')
await clickButtonText('#experiment-controls button', 'Field lines on')
await setRangeByLabel('Test-particle charge', 1.35)
await sleep(80)
await click('button[aria-label="Toggle experiment controls"]')
shared = await copiedState()
const disclosure = await evaluate(`document.querySelector('#saved-experiment-note')?.textContent ?? ''`)
assert.ok(disclosure.includes('charge arrangement and field framing'), 'Saved settings disclose the restored sources and framing')
assert.equal(shared.state.preset, 'custom', 'Edited sources are represented as a custom arrangement')
assert.equal(shared.state.charges.length, 3, 'The original pair and added source are shared')
assert.equal(shared.state.charges.filter((charge) => charge.q < 0).length, 2, 'The flipped polarity survives sharing')
assert.ok(Math.abs(shared.state.charges[2].x) > 1, 'The added source position is included')
assert.ok(shared.state.view.zoom > 1, 'The zoomed camera framing is included')
assert.equal(shared.state.showPotential, false, 'The hidden potential layer is shared')
assert.equal(shared.state.showLines, false, 'The hidden field-line layer is shared')
assert.equal(shared.state.fieldScale, 1.35, 'The test-charge scale is shared')

await call('Page.navigate', { url: shared.link })
await waitFor(`location.pathname === '/exhibits/forces' && !document.querySelector('.experience-loading')`, 'custom field after link navigation')
const replayed = await copiedState()
assert.deepEqual(replayed.state.charges, shared.state.charges, 'Charge positions and strengths restore exactly')
assert.deepEqual(replayed.state.view, shared.state.view, 'The camera centre and normalized zoom restore exactly')
assert.equal(replayed.state.preset, 'custom', 'The custom-arrangement selection restores')
assert.equal(replayed.state.showPotential, false, 'The potential layer remains hidden after reload')
assert.equal(replayed.state.showLines, false, 'The field-line layer remains hidden after reload')
assert.equal(replayed.state.fieldScale, 1.35, 'The test-particle scale restores exactly')
await click('button[aria-label="Toggle experiment information"]')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`Boolean([...document.querySelectorAll('#experiment-controls button')].find((button) => button.textContent.trim() === 'Potential off')) && Boolean([...document.querySelectorAll('#experiment-controls button')].find((button) => button.textContent.trim() === 'Field lines off')) && document.querySelector('#experiment-controls input[type="range"]')?.value === '1.35'`, 'restored Controls reflect shared values')

const invalid = structuredClone(shared.state)
invalid.charges[0].q = 40
await call('Page.navigate', { url: stateUrl(invalid) })
await waitFor(`location.pathname === '/exhibits/forces' && !document.querySelector('.experience-loading')`, 'recovery from invalid charge parameters')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelector('#experiment-controls select')?.value === 'dipole'`, 'safe named-preset recovery')
assert.equal(await evaluate(`Boolean(document.querySelector('.experience-error'))`), false, 'Invalid source values do not enter the error boundary')
await click('button[aria-label="Toggle experiment controls"]')
const namedCanvasPoint = await evaluate(`(() => { const r = document.querySelector('.forces-canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: namedCanvasPoint.x, y: namedCanvasPoint.y, deltaX: 0, deltaY: -180 })
await sleep(320)
const namedPreset = await copiedState()
assert.equal(namedPreset.state.preset, 'dipole', 'A named field remains a named preset')
assert.ok(!Object.hasOwn(namedPreset.state, 'charges'), 'Named presets do not redundantly encode their default charges')
await call('Page.navigate', { url: namedPreset.link })
await waitFor(`location.pathname === '/exhibits/forces' && !document.querySelector('.experience-loading')`, 'named field after shared-link navigation')
const namedReplay = await copiedState()
assert.deepEqual(namedReplay.state.view, namedPreset.state.view, 'Named arrangements preserve zoom and pan without a custom charge list')
assert.deepEqual(errors, [], `Invisible Forces browser errors occurred: ${errors.join('; ')}`)

const evidence = {
  browser: 'HeadlessChrome 157, 1440×900, SwiftShader/Vulkan',
  editedArrangement: { sources: shared.state.charges.length, positive: shared.state.charges.filter((charge) => charge.q > 0).length, negative: shared.state.charges.filter((charge) => charge.q < 0).length, zoom: shared.state.view.zoom, showPotential: shared.state.showPotential, showLines: shared.state.showLines, fieldScale: shared.state.fieldScale },
  fullReload: { chargesExact: true, cameraExact: true, customSelection: true },
  namedPresetFraming: { preset: 'dipole', cameraExact: true },
  malformedRecovery: { extremeStrengthUsesDipoleStarter: true, errorBoundary: false },
  browserErrors: errors,
}
await writeFile('docs/renaissance/evidence/forces-state-browser-checks.json', `${JSON.stringify(evidence, null, 2)}\n`)
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: clipboardOverride.identifier })
socket.close()
console.log(JSON.stringify(evidence, null, 2))
