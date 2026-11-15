import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`)
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

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
await call('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__armsteelCopied = text } } })` })

const cases = [
  {
    id: 'mandelbrot',
    state: { iterations: -1e100, palette: 'unknown', mode: 'unknown', view: { x: '9'.repeat(1200), y: '8'.repeat(1200), zoom: { mantissa: 1, exponent: 1_000_000 } } },
    expected: { iterations: 160, palette: 'abyss', mode: 'mandelbrot', view: { x: '-0.5', y: '0', zoom: { mantissa: 1, exponent: 0 } } },
  },
  {
    id: 'automata',
    state: { pattern: 'unknown', rule: 'unknown', speed: 1e100, renderMode: 'unknown', seed: 1e100 },
    expected: { pattern: 'pulsarTrio', rule: 'life', speed: 8, renderMode: 'age', seed: 0xffff_ffff },
  },
  {
    id: 'lsystem',
    state: { kind: 'coral', iterations: 1e100, angle: 1e100, randomness: -1e100, width: 1e100, seed: -1, zoom: 1e100, panX: 1e100, panY: -1e100 },
    expected: { kind: 'coral', iterations: 6, angle: 112, randomness: 0, width: 4, seed: 0, zoom: 24, panX: 1_000_000, panY: -1_000_000 },
  },
  {
    id: 'attractors',
    state: { system: 'lorenz', speed: 1e100, trail: -1e100, palette: 'unknown', rho: 1e100, sigma: -1e100, beta: 1e100, camera: { x: 1e100, y: -1e100, zoom: 1e100 } },
    expected: { system: 'lorenz', speed: 4, trail: 2500, palette: 'polar', rho: 45, sigma: 5, beta: 5, camera: { x: 1.3, y: -1_000_000, zoom: 4.5 } },
  },
  {
    id: 'boids',
    state: { scenario: 'vortex', population: 1e100, speed: 1e100, radius: -1e100, tool: 'unknown', seed: -1 },
    expected: { scenario: 'vortex', population: 1400, speed: 4.2, radius: 28, tool: 'food', seed: 0 },
  },
  {
    id: 'gravity',
    state: { scene: 'unknown', speed: 1e100, mass: 1e100, launchSpeed: -1e100 },
    expected: { scene: 'solar', speed: 2.2, mass: 30, launchSpeed: 0.5 },
  },
  {
    id: 'fluid',
    state: { style: 'unknown', palette: 'unknown', viscosity: -1e100, dissipation: 1e100, force: 1e100, brushSize: 1e100, vorticity: 1e100, preset: 'unknown' },
    expected: { style: 'silk', palette: 'aurora', viscosity: 0, dissipation: 0.999, force: 1.8, brushSize: 110, vorticity: 32, preset: 'vortex' },
  },
  {
    id: 'reaction',
    state: { preset: 'unknown', feed: -1e100, kill: 1e100, diffusion: 1e100, steps: 1e100, palette: 'unknown', brush: 'unknown', brushSize: 1e100, quality: 'unknown', seed: 1e100 },
    expected: { preset: 'coral', feed: 0.012, kill: 0.075, diffusion: 1.45, steps: 5, palette: 'verdigris', brush: 'seed', brushSize: 72, quality: 'detail', seed: 0xffff_ffff },
  },
  {
    id: 'sound',
    state: { frequency: 1e100, cutoff: 1e100, filterOn: true, viewMode: 'unknown', harmonics: [{ multiple: 1, amplitude: 1e100, phase: 0 }] },
    expected: { frequency: 660, cutoff: 8000, filterOn: true, viewMode: 'spectrum' },
    harmonicRestore: 'fallback',
  },
  {
    id: 'sound',
    state: { frequency: 440, cutoff: 2400, filterOn: true, viewMode: 'spectrogram', harmonics: [{ multiple: 1, amplitude: 0.4, phase: 0 }, { multiple: 3, amplitude: 0.2, phase: Math.PI / 4 }] },
    expected: { frequency: 440, cutoff: 2400, filterOn: true, viewMode: 'spectrogram' },
    harmonicRestore: 'custom',
  },
  {
    id: 'optics',
    state: { placements: { source: [5, -2], prism: [0.1, 0.95], mirror: [null], lens: [0.5, 0.85] }, spectrum: 'infrared', wavelength: 1e100, material: 'unknown', prismRotation: -1e100, mirrorAngle: 1e100, focalRatio: 0, sourceAngle: 1e100, spread: -1e100 },
    expected: { placements: { source: [0.94, 0.12], prism: [0.1, 0.85], mirror: [0.78, 0.31], lens: [0.5, 0.85] }, spectrum: 'spectrum', wavelength: 700, material: 'crown', prismRotation: -0.65, mirrorAngle: 1.6, focalRatio: 0.12, sourceAngle: 0.7, spread: 0.018 },
  },
  {
    id: 'waves',
    state: { frequency: 1e100, speed: -1e100, damping: 1e100, boundary: 'unknown', preset: 'unknown', viewMode: 'unknown', coherence: 'unknown', phaseOffset: -1e100 },
    expected: { frequency: 0.19, speed: 0.35, damping: 0.055, boundary: 'absorb', preset: 'interference', viewMode: 'amplitude', coherence: 'coherent', phaseOffset: -Math.PI },
  },
  {
    id: 'lensing',
    state: { mass: 1e100, distance: -1e100, sourceRatio: 1e100, impact: -1e100, viewMode: 'unknown' },
    expected: { mass: 1.45, distance: 22, sourceRatio: 0.88, impact: 4.495, viewMode: 'lensed sky' },
  },
  {
    id: 'machine',
    state: { program: 'custom', a: 254, b: 17, source: 'LDI A, 9\nLDI B, 3\nADD A, B\nOUT A\nHLT' },
    expected: { program: 'custom', a: 254, b: 17, source: 'LDI A, 9\nLDI B, 3\nADD A, B\nOUT A\nHLT' },
    machineRun: true,
  },
  {
    id: 'machine',
    state: { program: 'custom', a: -1, b: 1e100, source: 'LDI A, 9\n'.repeat(224) },
    expected: { program: 'sum', a: 0, b: 255 },
  },
]

const results = []
for (const test of cases) {
  const envelope = Buffer.from(JSON.stringify({ $armsteel: 1, state: test.state })).toString('base64url')
  await call('Page.navigate', { url: `${base}/exhibits/${test.id}?state=${envelope}` })
  await waitFor(`location.pathname === ${JSON.stringify(`/exhibits/${test.id}`)} && Boolean(document.querySelector('.dock-current span')) && !document.querySelector('.experience-loading')`, `${test.id} restored and mounted under extreme settings`)
  assert.equal(await evaluate(`Boolean(document.querySelector('.experience-error'))`), false, `${test.id} remains usable with bounded settings`)
  let machineOutputAfterFourInstructions = null
  if (test.machineRun) {
    for (let step = 1; step <= 4; step++) {
      await click('.machine-step-button')
      await waitFor(`Number(document.querySelector('.machine-status strong')?.textContent) === ${step} && !document.querySelector('.machine-step-button')?.disabled`, `custom CPU program step ${step}`)
    }
    machineOutputAfterFourInstructions = await evaluate(`document.querySelector('.machine-output strong')?.textContent.trim()`)
    assert.equal(machineOutputAfterFourInstructions, '12', 'A restored custom CPU program executes its shared instructions')
  }
  await click('button[aria-label="Toggle experiment information"]')
  await waitFor(`Boolean(document.querySelector('.info-actions button:last-child'))`, `${test.id} share action`)
  if (test.id === 'machine') assert.ok((await evaluate(`document.querySelector('#saved-experiment-note')?.textContent`)).includes('avoid private comments'), 'The About panel warns that custom assembly is shared as public URL text')
  await click('.info-actions button:last-child')
  await waitFor(`typeof window.__armsteelCopied === 'string' && window.__armsteelCopied.length > 0`, `${test.id} sanitized share link`)
  const copied = await evaluate('window.__armsteelCopied')
  const state = JSON.parse(Buffer.from(new URL(copied).searchParams.get('state'), 'base64url').toString('utf8')).state
  for (const [key, expected] of Object.entries(test.expected)) {
    assert.deepEqual(state[key], expected, `${test.id}.${key} is sanitized and shareable`)
  }
  if (test.id === 'sound' && test.harmonicRestore === 'fallback') {
    assert.equal(state.harmonics.length, 9, 'invalid partial sets recover to the bounded triangle-wave preset')
    assert.ok(state.harmonics.every((part) => Number.isInteger(part.multiple) && part.multiple <= 24 && Number.isFinite(part.amplitude) && part.amplitude >= 0 && part.amplitude <= 0.8 && Number.isFinite(part.phase) && Math.abs(part.phase) <= Math.PI), 'restored oscillator partials stay finite and within control bounds')
  }
  if (test.id === 'sound' && test.harmonicRestore === 'custom') assert.deepEqual(state.harmonics, test.state.harmonics, 'valid custom Fourier partials restore exactly')
  if (test.id === 'sound') assert.equal(await evaluate(`document.querySelector('.iw-sound-actions span')?.textContent.trim()`), 'AUDIO OFF', 'Restored audio settings remain silent until explicitly started')
  results.push({ id: test.id, checkedSettings: Object.keys(test.expected), boundedStateRemounted: true, ...(test.machineRun ? { machineOutputAfterFourInstructions, publicProgramDisclosure: true } : {}) })
}

assert.deepEqual(errors, [], `Browser errors occurred: ${errors.join('; ')}`)
const browser = await evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const debug = gl?.getExtension('WEBGL_debug_renderer_info'); return { userAgent: navigator.userAgent, devicePixelRatio, viewport: [innerWidth, innerHeight], renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? 'unavailable' } })()`)
const summary = {
  browser,
  method: 'Fifteen state cases across thirteen exhibit routes check bounded URL recovery and actual shared output. A restored custom CPU program executes four instructions and produces 12; an oversized program falls back safely.',
  cases: results,
  errors,
}
const evidenceRoot = resolve('docs/renaissance/evidence')
await mkdir(evidenceRoot, { recursive: true })
await writeFile(resolve(evidenceRoot, 'state-bounds-browser-checks.json'), `${JSON.stringify(summary, null, 2)}\n`)
socket.close()
console.log(JSON.stringify(summary, null, 2))
