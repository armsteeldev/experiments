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
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.result.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
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

async function setRangeByLabel(label, value) {
  assert.ok(await evaluate(`(() => { const input = [...document.querySelectorAll('#experiment-controls input[type="range"]')].find((item) => item.closest('label')?.innerText.includes(${JSON.stringify(label)})); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(String(value))}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return input.value === ${JSON.stringify(String(value))} })()`), `Could not set ${label}`)
}

async function selectValue(selector, value) {
  assert.ok(await evaluate(`(() => { const select = document.querySelector(${JSON.stringify(selector)}); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === ${JSON.stringify(value)} })()`), `Could not select ${value}`)
}

const instrumentation = `(() => {
  const measure = window.__armsteelBoidsPerf = { callbackMs: [], intervals: [], lastFrame: null, longTasks: 0, longestTaskMs: 0 }
  const native = window.requestAnimationFrame.bind(window)
  window.__armsteelBoidsOriginalRAF = native
  window.requestAnimationFrame = (callback) => native((time) => {
    const state = window.__armsteelBoidsPerf
    if (state) {
      if (state.lastFrame !== time) {
        if (state.lastFrame !== null) state.intervals.push(time - state.lastFrame)
        state.lastFrame = time
      }
      const start = performance.now()
      try { callback(time) } finally { if (state.callbackMs.length < 8000) state.callbackMs.push(performance.now() - start) }
    } else callback(time)
  })
  if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    window.__armsteelBoidsLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const state = window.__armsteelBoidsPerf
        if (state) { state.longTasks++; state.longestTaskMs = Math.max(state.longestTaskMs, entry.duration) }
      }
    }).observe({ type: 'longtask', buffered: false })
  }
})()`

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
const instrumentationOverride = await call('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation })
await call('Page.navigate', { url: `${base}/exhibits/boids` })
await waitFor(`location.pathname === '/exhibits/boids' && document.querySelector('.boids-canvas') && !document.querySelector('.experience-loading')`, 'Flocking canvas')
await click('button[aria-label="Toggle experiment controls"]')
await waitFor('Boolean(document.querySelector("#experiment-controls select"))', 'Flocking controls')
await selectValue('#experiment-controls select', 'predator')
await setRangeByLabel('Population', 1400)
await setRangeByLabel('Awareness', 132)
await click('button[aria-label="Toggle experiment controls"]')
await waitFor(`document.querySelector('.canvas-coordinate')?.textContent.includes('PREDATOR AND PREY') && document.querySelector('.canvas-coordinate')?.textContent.includes('1,400 AGENTS') && Boolean(document.querySelector('button[aria-label="Pause experiment"]'))`, 'the 1,400-agent predator scenario')
await evaluate(`document.querySelector('button[aria-label="Dismiss first-move hint"]')?.click()`)
await click('button[aria-label="Pause experiment"]')
await sleep(250)
await click('button[aria-label="Resume experiment"]')

const trials = []
for (let trial = 0; trial < 3; trial++) {
  await evaluate(`(() => { const p = window.__armsteelBoidsPerf; p.callbackMs.length = 0; p.intervals.length = 0; p.lastFrame = null; p.longTasks = 0; p.longestTaskMs = 0 })()`)
  const startedAt = Date.now()
  await sleep(2200)
  const sample = await evaluate(`(() => {
    const p = window.__armsteelBoidsPerf
    const sorted = [...p.callbackMs].sort((a,b) => a-b)
    const intervals = [...p.intervals].sort((a,b) => a-b)
    const percentile = (values, fraction) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * fraction))] : null
    return { callbacks: sorted.length, callbackMs: { median: percentile(sorted,.5), p95: percentile(sorted,.95), max: sorted.at(-1) ?? null }, frameIntervalsMs: { median: percentile(intervals,.5), p95: percentile(intervals,.95), max: intervals.at(-1) ?? null }, longTasksOver50ms: p.longTasks, longestLongTaskMs: p.longestTaskMs }
  })()`)
  sample.wallSeconds = (Date.now() - startedAt) / 1000
  trials.push(sample)
  await sleep(300)
}

assert.ok(trials.every((trial) => trial.callbacks > 20), 'The browser recorded repeated animation callbacks during each sample')
assert.ok(errors.length === 0, `Flocking performance browser errors occurred: ${errors.join('; ')}`)
await mkdir('docs/renaissance/evidence', { recursive: true })
const evolvedCapture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('docs/renaissance/evidence/flocking-predator-evolved.png', Buffer.from(evolvedCapture.data, 'base64'))
const evidence = { browser: 'HeadlessChrome 157, Canvas 2D, SwiftShader/Vulkan, 1440×900', workload: { scenario: 'Predator and prey', population: 1400, awarenessPx: 132 }, capture: 'evidence/flocking-predator-evolved.png', trials, browserErrors: errors, caveat: 'Callback timing includes all page animation callbacks; software-rendered headless measurements do not represent physical-GPU or phone performance.' }
const path = process.env.ARMSTEEL_FLOCKING_EVIDENCE
if (path) await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`)
await evaluate(`(() => { window.__armsteelBoidsLongTaskObserver?.disconnect(); if (window.__armsteelBoidsOriginalRAF) window.requestAnimationFrame = window.__armsteelBoidsOriginalRAF; delete window.__armsteelBoidsLongTaskObserver; delete window.__armsteelBoidsOriginalRAF; delete window.__armsteelBoidsPerf })()`)
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentationOverride.identifier })
socket.close()
console.log(JSON.stringify(evidence, null, 2))
