import './require-browser-qa-supervisor.mjs'
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
  if (result.exceptionDetails) throw new Error(result.result.exception?.description ?? result.exceptionDetails.text)
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

async function ensurePaused() {
  const viewport = await evaluate('({ width: innerWidth, height: innerHeight })')
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(viewport.width / 2), y: Math.max(0, Math.round(viewport.height - 24)) })
  await waitFor('Boolean(document.querySelector("button[aria-label=\\"Pause experiment\\"], button[aria-label=\\"Resume experiment\\"]"))', 'shared navigation dock')
  if (!await evaluate('Boolean(document.querySelector("button[aria-label=\\"Resume experiment\\"]"))')) await click('button[aria-label="Pause experiment"]')
}

async function selectValue(selector, value) {
  assert.ok(await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('change', { bubbles: true })); return true })()`), `Could not select ${value}`)
  await sleep(60)
}

async function setRangeByLabel(label, value) {
  assert.ok(await evaluate(`(() => { const input = [...document.querySelectorAll('#experiment-controls input[type="range"]')].find((item) => item.closest('label')?.innerText.includes(${JSON.stringify(label)})); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(String(value))}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input.value === ${JSON.stringify(String(value))} })()`), `Could not set ${label}`)
}

async function copiedState() {
  if (!await evaluate('Boolean(document.querySelector("#experiment-information"))')) {
    await waitFor('Boolean(document.querySelector("button[aria-label=\\"Toggle experiment information\\"]"))', 'information control')
    await click('button[aria-label="Toggle experiment information"]')
  }
  await waitFor('Boolean(document.querySelector(".info-actions button:last-child"))', 'Flocking share action')
  await sleep(100)
  const previous = await evaluate('window.__armsteelCopied || ""')
  await click('.info-actions button:last-child')
  await waitFor(`typeof window.__armsteelCopied === 'string' && window.__armsteelCopied !== ${JSON.stringify(previous)}`, 'fresh Flocking share link')
  const link = await evaluate('window.__armsteelCopied')
  return { link, state: JSON.parse(Buffer.from(new URL(link).searchParams.get('state'), 'base64url').toString('utf8')).state }
}

function stateUrl(state) {
  return `${base}/exhibits/boids?state=${Buffer.from(JSON.stringify({ $armsteel: 1, state })).toString('base64url')}`
}

async function pointerClick(x, y) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function pointOnCanvas(xRatio, yRatio) {
  return evaluate(`(() => { const r = document.querySelector('.boids-canvas').getBoundingClientRect(); return { x: r.left + r.width * ${xRatio}, y: r.top + r.height * ${yRatio}, width: r.width, height: r.height } })()`)
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
const clipboardOverride = await call('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.removeItem('armsteel.discovery-hint.boids'); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__armsteelCopied = text } } })` })

await call('Page.navigate', { url: `${base}/exhibits/boids` })
await waitFor(`location.pathname === '/exhibits/boids' && document.querySelector('.boids-canvas') && !document.querySelector('.experience-loading')`, 'Flocking canvas')
await ensurePaused()
await clickButtonText('.scene-nudge-action', 'Drop food here')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`Boolean(document.querySelector('#experiment-controls select')) && Boolean([...document.querySelectorAll('#experiment-controls button')].find((button) => button.textContent.trim() === 'Barrier'))`, 'Flocking controls')
await setRangeByLabel('Pace', 2.6)
await clickButtonText('#experiment-controls button', 'Barrier')
await click('button[aria-label="Toggle experiment controls"]')
let point = await pointOnCanvas(.72, .38)
await pointerClick(point.x, point.y)

let shared = await copiedState()
assert.equal(shared.state.scenario, 'murmuration', 'The selected flocking scenario is included')
assert.equal(shared.state.speed, 2.6, 'The chosen pace is included')
assert.equal(shared.state.markers.length, 2, 'The first action and placed barrier are both included')
assert.deepEqual(shared.state.markers.map((marker) => marker.kind), ['food', 'obstacle'], 'Marker kinds preserve their interaction meaning')
assert.ok(Math.abs(shared.state.markers[0].x - .5) < .005 && Math.abs(shared.state.markers[0].y - .5) < .005, 'The first-action food mark is normalized to the canvas')
assert.ok(Math.abs(shared.state.markers[1].x - .72) < .01 && Math.abs(shared.state.markers[1].y - .38) < .01, 'Pointer placement is stored in normalized viewport coordinates')
assert.ok((await evaluate('document.querySelector("#saved-experiment-note")?.textContent ?? ""')).includes('Placed field marks and the random seed'), 'Saved settings disclose the restored field marks and fresh flock history')
const initialMarkers = structuredClone(shared.state.markers)

await click('button[aria-label="Toggle experiment information"]')
const desktopCapture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await mkdir('docs/renaissance/evidence', { recursive: true })
await writeFile('docs/renaissance/evidence/flocking-custom-markers.png', Buffer.from(desktopCapture.data, 'base64'))

await call('Page.navigate', { url: shared.link })
await waitFor(`location.pathname === '/exhibits/boids' && !document.querySelector('.experience-loading')`, 'shared field markers after reload')
await ensurePaused()
const replayed = await copiedState()
assert.deepEqual(replayed.state.markers, shared.state.markers, 'Marker positions and kinds restore exactly after reload')
assert.equal(replayed.state.seed, shared.state.seed, 'The deterministic flock seed is preserved')

await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 })
await call('Page.navigate', { url: shared.link })
await waitFor(`location.pathname === '/exhibits/boids' && !document.querySelector('.experience-loading')`, 'shared field markers at phone size')
await ensurePaused()
const mobileReplay = await copiedState()
assert.deepEqual(mobileReplay.state.markers, shared.state.markers, 'Viewport-normalized placements remain exact on a narrow phone')
assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'The Flocking route does not overflow a 390px viewport')
await click('button[aria-label="Toggle experiment information"]')
await evaluate(`document.querySelector('button[aria-label="Dismiss first-move hint"]')?.click()`)
const mobileCapture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('docs/renaissance/evidence/flocking-markers-390-mobile.png', Buffer.from(mobileCapture.data, 'base64'))

await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
await call('Page.navigate', { url: shared.link })
await waitFor(`location.pathname === '/exhibits/boids' && !document.querySelector('.experience-loading')`, 'Flocking desktop stress arrangement')
await ensurePaused()
await click('button[aria-label="Toggle experiment controls"]')
await clickButtonText('#experiment-controls button', 'Food')
await click('button[aria-label="Toggle experiment controls"]')
for (let index = 0; index < 15; index++) {
  point = await pointOnCanvas(.12 + (index % 5) * .13, .18 + Math.floor(index / 5) * .21)
  await pointerClick(point.x, point.y)
}
shared = await copiedState()
assert.equal(shared.state.markers.length, 16, 'The field stays within its sixteen-marker replay limit after repeated placement')
assert.equal(shared.state.markers.filter((marker) => marker.kind === 'food').length, 15, 'New marks replace the oldest when the marker limit is reached')
assert.equal(shared.state.markers.filter((marker) => marker.kind === 'obstacle').length, 1, 'Recent obstacle placement remains present at the limit')

await click('button[aria-label="Toggle experiment information"]')
await click('button[aria-label="Toggle experiment controls"]')
await selectValue('#experiment-controls select', 'predator')
await click('button[aria-label="Toggle experiment controls"]')
const cleared = await copiedState()
assert.equal(cleared.state.scenario, 'predator', 'Changing behavioural scenario is included')
assert.deepEqual(cleared.state.markers, [], 'Changing scenario records the deliberately empty field')
await call('Page.navigate', { url: cleared.link })
await waitFor(`location.pathname === '/exhibits/boids' && !document.querySelector('.experience-loading')`, 'empty field after restore')
const emptyReplay = await copiedState()
assert.deepEqual(emptyReplay.state.markers, [], 'An intentionally cleared arrangement remains empty after reload')

const malformed = structuredClone(shared.state)
malformed.markers = [{ x: 4, y: .5, kind: 'food' }]
await call('Page.navigate', { url: stateUrl(malformed) })
await waitFor(`location.pathname === '/exhibits/boids' && !document.querySelector('.experience-loading')`, 'recovery from an out-of-bounds marker')
assert.equal(await evaluate('Boolean(document.querySelector(".experience-error"))'), false, 'Invalid marker coordinates do not enter the error boundary')
const recovered = await copiedState()
assert.equal(Object.hasOwn(recovered.state, 'markers'), false, 'An invalid marker list is omitted from the recovered safe state')
assert.deepEqual(errors, [], `Flocking browser errors occurred: ${errors.join('; ')}`)

const evidence = {
  browser: 'HeadlessChrome 157, Canvas 2D, 1440×900 and 390×844 emulation',
  customArrangement: { markers: initialMarkers.length, kinds: initialMarkers.map((marker) => marker.kind), exactDesktopRestore: true, exactMobileRestore: true },
  boundedPlacement: { markers: 16, oldestReplaced: true },
  clearing: { scenarioChange: 'predator', explicitEmptyRestore: true },
  malformedRecovery: { outOfBoundsCoordinateRejected: true, errorBoundary: false },
  browserErrors: errors,
}
await writeFile('docs/renaissance/evidence/flocking-state-browser-checks.json', `${JSON.stringify(evidence, null, 2)}\n`)
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: clipboardOverride.identifier })
socket.close()
console.log(JSON.stringify(evidence, null, 2))
