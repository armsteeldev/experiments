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

function stateUrl(id, state) {
  const encoded = Buffer.from(JSON.stringify({ $armsteel: 1, state })).toString('base64url')
  return `${base}/exhibits/${id}?state=${encoded}`
}

async function shareCurrent() {
  await click('button[aria-label="Toggle experiment information"]')
  await waitFor(`Boolean(document.querySelector('.info-actions button:last-child'))`, 'share action')
  const previous = await evaluate('window.__armsteelCopied || ""')
  await click('.info-actions button:last-child')
  await waitFor(`typeof window.__armsteelCopied === 'string' && window.__armsteelCopied !== ${JSON.stringify(previous)}`, 'new copied link')
  return await evaluate('window.__armsteelCopied')
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
const fallbackScript = await call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__armsteelCopied = text } } }); (() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null; return Reflect.apply(original, this, [type, ...args]) } })()` })

const fluidState = { preset: 'vortex', palette: 'ember', viscosity: 0.31, dissipation: 0.978 }
await call('Page.navigate', { url: stateUrl('fluid', fluidState) })
await waitFor(`location.pathname === '/exhibits/fluid' && document.querySelector('.fluid-canvas') && !document.querySelector('.canvas-coordinate') && !document.querySelector('.experience-loading')`, 'Canvas 2D Fluid fallback')
assert.equal(await evaluate(`Boolean(document.querySelector('.experience-error'))`), false, 'Fluid fallback mounts without entering the error boundary')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelector('.preset-row button.selected')?.textContent.trim() === 'Vortex'`, 'restored fallback flow preset')
const fluidLink = await shareCurrent()
const fluidShared = JSON.parse(Buffer.from(new URL(fluidLink).searchParams.get('state'), 'base64url').toString('utf8')).state
assert.deepEqual({ preset: fluidShared.preset, palette: fluidShared.palette, viscosity: fluidShared.viscosity, dissipation: fluidShared.dissipation }, fluidState, 'The Canvas 2D flow preset and settings survive share')
assert.ok((await evaluate(`document.querySelector('#saved-experiment-note')?.textContent`)).includes('hand-drawn strokes'), 'Fluid replay limits are disclosed in About')

await click('button[aria-label="Toggle experiment controls"]')
await click('#experiment-controls .panel-action')
const emptyFluidLink = await shareCurrent()
const emptyFluidState = JSON.parse(Buffer.from(new URL(emptyFluidLink).searchParams.get('state'), 'base64url').toString('utf8')).state
assert.equal(emptyFluidState.preset, 'empty', 'Cleared Fluid is represented as an empty starting condition')
await call('Page.navigate', { url: emptyFluidLink })
await waitFor(`location.pathname === '/exhibits/fluid' && document.querySelector('.fluid-canvas') && !document.querySelector('.canvas-coordinate') && !document.querySelector('.experience-loading')`, 'empty Fluid fallback reload')
await click('button[aria-label="Toggle experiment controls"]')
const emptySelectedPreset = await evaluate(`document.querySelector('.preset-row button.selected')?.textContent.trim() ?? null`)
assert.equal(emptySelectedPreset, null, 'The cleared fallback does not silently become a seeded flow')

const reactionState = { preset: 'maze', feed: 0.041, kill: 0.052, diffusion: 1.12, steps: 3, palette: 'ultraviolet', brush: 'erase', brushSize: 36, seed: 24681357, scatter: false }
await call('Page.navigate', { url: stateUrl('reaction', reactionState) })
await waitFor(`location.pathname === '/exhibits/reaction' && document.querySelector('.reaction-canvas') && document.querySelector('#experiment-controls')?.textContent.includes('Canvas 2D fallback') && !document.querySelector('.experience-loading')`, 'Canvas 2D reaction-diffusion fallback')
assert.equal(await evaluate(`Boolean(document.querySelector('.experience-error'))`), false, 'Reaction fallback mounts without entering the error boundary')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelector('.preset-row button.selected')?.textContent.trim() === 'Labyrinth'`, 'canonicalized labyrinth selection')
const reactionLink = await shareCurrent()
const reactionShared = JSON.parse(Buffer.from(new URL(reactionLink).searchParams.get('state'), 'base64url').toString('utf8')).state
for (const [key, value] of Object.entries(reactionState)) if (key !== 'preset') assert.equal(reactionShared[key], value, `Canvas 2D reaction ${key} restores and shares`)
assert.equal(reactionShared.preset, 'labyrinth', 'The legacy Canvas 2D maze name normalizes to the GPU preset name')
assert.ok((await evaluate(`document.querySelector('#saved-experiment-note')?.textContent`)).includes('evolved chemistry start fresh'), 'Reaction replay limits are disclosed in About')

await click('button[aria-label="Toggle experiment controls"]')
await click('#experiment-controls .panel-action')
const scatteredLink = await shareCurrent()
const scattered = JSON.parse(Buffer.from(new URL(scatteredLink).searchParams.get('state'), 'base64url').toString('utf8')).state
assert.equal(scattered.scatter, true, 'The fallback share format preserves the seeded scatter mode')
assert.notEqual(scattered.seed, reactionState.seed, 'A new scatter advances the deterministic seed')
await call('Page.navigate', { url: scatteredLink })
await waitFor(`location.pathname === '/exhibits/reaction' && document.querySelector('.reaction-canvas') && document.querySelector('#experiment-controls')?.textContent.includes('Canvas 2D fallback') && !document.querySelector('.experience-loading')`, 'seeded scatter fallback reload')
const replayLink = await shareCurrent()
const replay = JSON.parse(Buffer.from(new URL(replayLink).searchParams.get('state'), 'base64url').toString('utf8')).state
assert.equal(replay.scatter, scattered.scatter, 'A restored scatter remains a scatter on re-share')
assert.equal(replay.seed, scattered.seed, 'A restored scatter retains its deterministic seed')

await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: fallbackScript.identifier })
await call('Page.reload')
await waitFor(`location.pathname === '/exhibits/reaction' && document.querySelector('.reaction-canvas')?.getContext('webgl2') && !document.querySelector('#experiment-controls')?.textContent.includes('Canvas 2D fallback') && !document.querySelector('.experience-loading')`, 'WebGL restored after fallback-only testing')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelectorAll('#experiment-controls select').length >= 2`, 'GPU reaction controls after fallback testing')
assert.equal(await evaluate(`document.querySelector('#experiment-controls select')?.value`), 'labyrinth', 'A Canvas 2D labyrinth configuration maps to the same GPU preset')
assert.equal(await evaluate(`document.querySelectorAll('#experiment-controls select')[1]?.value`), 'ultraviolet', 'A Canvas 2D pigment selection maps to the same GPU palette')
const gpuRenderer = await evaluate(`(() => { const gl = document.querySelector('.reaction-canvas')?.getContext('webgl2'); const debug = gl?.getExtension('WEBGL_debug_renderer_info'); return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? 'unavailable' })()`)
assert.deepEqual(errors, [], `Fallback browser errors occurred: ${errors.join('; ')}`)
const evidence = {
  browser: 'HeadlessChrome 157; WebGL APIs deliberately disabled for Canvas 2D checks, then restored for an actual WebGL2 mount at 1440×900.',
  fluid: { flowAndSettingsRestored: true, emptyConditionSurvivesReload: true, replayDisclosure: true },
  reaction: { presetAndModelSettingsRestored: true, legacyPresetAndPaletteRemainCompatibleAcrossRenderers: true, seededScatterReplays: true, replayDisclosure: true },
  webglRendererAfterFallbackChecks: gpuRenderer,
  browserErrors: errors,
}
await mkdir('docs/renaissance/evidence', { recursive: true })
await writeFile('docs/renaissance/evidence/fallback-restoration-browser-checks.json', `${JSON.stringify(evidence, null, 2)}\n`)
socket.close()
console.log(JSON.stringify(evidence, null, 2))
