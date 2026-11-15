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

async function selectValue(selector, value, index = 0) {
  assert.ok(await evaluate(`(() => { const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!node) return false; node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('change', { bubbles: true })); return true })()`), `Could not select ${value} in ${selector}[${index}]`)
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
  await waitFor('Boolean(document.querySelector(".info-actions button:last-child"))', 'Gravity share action')
  await sleep(120)
  const previous = await evaluate('window.__armsteelCopied || ""')
  await click('.info-actions button:last-child')
  await waitFor(`typeof window.__armsteelCopied === 'string' && window.__armsteelCopied !== ${JSON.stringify(previous)}`, 'fresh Gravity share link')
  const link = await evaluate('window.__armsteelCopied')
  return { link, state: JSON.parse(Buffer.from(new URL(link).searchParams.get('state'), 'base64url').toString('utf8')).state }
}

function stateUrl(state) {
  return `${base}/exhibits/gravity?state=${Buffer.from(JSON.stringify({ $armsteel: 1, state })).toString('base64url')}`
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
const clipboardOverride = await call('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.removeItem('armsteel.discovery-hint.gravity'); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__armsteelCopied = text } } })` })

await call('Page.navigate', { url: `${base}/exhibits/gravity` })
await waitFor(`location.pathname === '/exhibits/gravity' && document.querySelector('.gravity-canvas') && !document.querySelector('.experience-loading')`, 'Gravity Playground')
await clickButtonText('.scene-nudge-action', 'Launch a gentle orbit')
await waitFor(`document.querySelector('.gravity-hud > strong')?.textContent.includes('07')`, 'a new orbiting body')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelectorAll('#experiment-controls select').length >= 2 && [...document.querySelectorAll('#experiment-controls input[type="range"]')].some((input) => input.closest('label')?.innerText.includes('Focused mass'))`, 'body and model controls')
await setRangeByLabel('Focused mass', 3.2)
await selectValue('#experiment-controls select', 'bounce', 1)
await click('button[aria-label="Toggle experiment controls"]')
const canvasPoint = await evaluate(`(() => { const r = document.querySelector('.gravity-canvas').getBoundingClientRect(); return { x: r.left + r.width * .72, y: r.top + r.height * .48 } })()`)
await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: canvasPoint.x, y: canvasPoint.y, deltaX: 0, deltaY: -240 })
let shared = await copiedState()
assert.equal(shared.state.scene, 'solar', 'The original named system remains identified')
assert.equal(shared.state.collision, 'bounce', 'The chosen collision model is included')
assert.equal(shared.state.bodies.length, 7, 'The six-body solar system and new orbit are included')
assert.equal(shared.state.bodies.filter((body) => body.id === 20).length, 1, 'The added body receives a stable saved ID')
assert.equal(shared.state.bodies.find((body) => body.id === 20)?.mass, 3.2, 'The edited body mass is included')
assert.ok(shared.state.view.zoom > 1, 'The normalized camera zoom is included')
assert.ok((await evaluate('document.querySelector("#saved-experiment-note")?.textContent ?? ""')).includes('body positions, velocities and masses'), 'The notebook disclosure describes custom initial conditions')
const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await mkdir('docs/renaissance/evidence', { recursive: true })
await writeFile('docs/renaissance/evidence/gravity-custom-orbit.png', Buffer.from(capture.data, 'base64'))

await call('Page.navigate', { url: shared.link })
await waitFor(`location.pathname === '/exhibits/gravity' && document.querySelector('.gravity-hud > strong')?.textContent.includes('07') && !document.querySelector('.experience-loading')`, 'shared orbit after reload')
const replayed = await copiedState()
assert.deepEqual(replayed.state.bodies, shared.state.bodies, 'All starting body IDs, positions, velocities, masses and colours restore exactly')
assert.deepEqual(replayed.state.view, shared.state.view, 'The camera framing restores exactly')
assert.equal(replayed.state.collision, 'bounce', 'The collision rule restores with the body snapshot')

await call('Page.reload')
await waitFor(`location.pathname === '/exhibits/gravity' && document.querySelector('.gravity-hud > strong')?.textContent.includes('07') && !document.querySelector('.experience-loading')`, 'orbit after a full browser reload')
await clickButtonText('.scene-nudge-action', 'Launch a gentle orbit')
await waitFor(`document.querySelector('.gravity-hud > strong')?.textContent.includes('08')`, 'a new body appended after full reload')
const appended = await copiedState()
assert.equal(appended.state.bodies.length, 8, 'The second added body is part of the starting snapshot')
assert.equal(new Set(appended.state.bodies.map((body) => body.id)).size, 8, 'A freshly mounted Gravity scene does not reuse a restored body ID')
assert.ok(appended.state.bodies.some((body) => body.id === 21), 'The second body receives the next available stable ID')

const malformed = structuredClone(shared.state)
malformed.bodies[0].mass = 5000
await call('Page.navigate', { url: stateUrl(malformed) })
await waitFor(`location.pathname === '/exhibits/gravity' && document.querySelector('.gravity-hud > strong')?.textContent.includes('06') && !document.querySelector('.experience-loading')`, 'safe named-scene recovery from invalid body state')
assert.equal(await evaluate('Boolean(document.querySelector(".experience-error"))'), false, 'Invalid body values do not enter the error boundary')
assert.deepEqual(errors, [], `Gravity browser errors occurred: ${errors.join('; ')}`)

const evidence = {
  browser: 'HeadlessChrome 157, 1440×900, SwiftShader/Vulkan',
  customScene: { bodies: shared.state.bodies.length, addedBodyId: 20, focusedMass: shared.state.bodies.find((body) => body.id === 20).mass, collision: shared.state.collision, zoom: shared.state.view.zoom, exactReload: true },
  appendedAfterFullReload: { bodyId: 21, allIdsUnique: true },
  malformedRecovery: { extremeMassUsesSolarStarter: true, errorBoundary: false },
  browserErrors: errors,
}
await writeFile('docs/renaissance/evidence/gravity-state-browser-checks.json', `${JSON.stringify(evidence, null, 2)}\n`)
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: clipboardOverride.identifier })
socket.close()
console.log(JSON.stringify(evidence, null, 2))
