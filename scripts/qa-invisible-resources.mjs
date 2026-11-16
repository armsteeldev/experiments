import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9345)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5197'
const evidenceRoot = resolve('docs/invisible-world/evidence')
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, `No page target found on CDP port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const waiting = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id || !waiting.has(message.id)) return
  const { resolve: resolveCall, reject, method, timeout } = waiting.get(message.id)
  waiting.delete(message.id)
  clearTimeout(timeout)
  if (message.error) reject(new Error(`${method}: ${message.error.message}`))
  else resolveCall(message.result)
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)) } }, 30000)
    waiting.set(id, { resolve: resolveCall, reject, method, timeout })
  })
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function waitForGarden() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('.iw-garden-canvas') && document.querySelector('.iw-garden-stats'))`)) return
    await sleep(100)
  }
  throw new Error('Living Garden did not mount for the resource sample')
}

async function metrics(label) {
  const snapshot = await call('Performance.getMetrics')
  const selected = Object.fromEntries(snapshot.metrics
    .filter((item) => ['Timestamp', 'Documents', 'Nodes', 'JSEventListeners', 'JSHeapUsedSize', 'JSHeapTotalSize', 'ScriptDuration', 'TaskDuration', 'LayoutCount'].includes(item.name))
    .map((item) => [item.name, item.value]))
  const pageState = await evaluate(`({ route: location.pathname, devicePixelRatio, viewport: [innerWidth, innerHeight], population: document.querySelector('.iw-garden-stats strong')?.textContent.trim(), jsHeapUsed: performance.memory?.usedJSHeapSize ?? null })`)
  return { label, ...selected, ...pageState }
}

await call('Page.enable')
await call('Runtime.enable')
await call('Performance.enable')
await call('HeapProfiler.enable')
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
await call('Page.navigate', { url: `${base}/exhibits/garden` })
await waitForGarden()
await sleep(1500)
await call('HeapProfiler.collectGarbage')
await sleep(250)
const samples = [await metrics('garden-start-after-gc')]
await sleep(18000)
samples.push(await metrics('garden-after-18s-before-gc'))
await call('HeapProfiler.collectGarbage')
await sleep(300)
samples.push(await metrics('garden-after-18s-after-gc'))
const framePacing = await evaluate(`new Promise((resolve) => {
  const intervals = []; let previous = 0
  const sample = (now) => {
    if (previous) intervals.push(now - previous)
    previous = now
    if (intervals.length < 120) { requestAnimationFrame(sample); return }
    const ordered = [...intervals].sort((a, b) => a - b)
    resolve({ samples: intervals.length, medianMs: Number(ordered[Math.floor(ordered.length * .5)].toFixed(2)), p95Ms: Number(ordered[Math.floor(ordered.length * .95)].toFixed(2)), maxMs: Number(Math.max(...ordered).toFixed(2)) })
  }
  requestAnimationFrame(sample)
})`)

for (let cycle = 1; cycle <= 8; cycle++) {
  await evaluate(`document.querySelector('button[aria-label="Return to exhibition"]')?.click()`)
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('.exhibition-page'))`)) break
    await sleep(60)
  }
  await evaluate(`document.querySelector('a[href="/exhibits/garden"]')?.click()`)
  await waitForGarden()
  await sleep(800)
  await call('HeapProfiler.collectGarbage')
  await sleep(250)
  samples.push(await metrics(`garden-remount-${cycle}-after-gc`))
}

const report = {
  browser: await evaluate(`({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory ?? null, renderer: (() => { const gl = document.createElement('canvas').getContext('webgl2'); return gl?.getParameter(gl.RENDERER) ?? 'unavailable' })() })`),
  method: 'One 18-second evolving garden sample bracketed by snapshots before and after forced V8 collection, 120 requestAnimationFrame intervals during continued evolution, and eight settled SPA unmount/remount samples after forced collection. Counters are Chromium estimates, not GPU or device-wide memory.',
  framePacing,
  samples,
}
await mkdir(evidenceRoot, { recursive: true })
await writeFile(resolve(evidenceRoot, 'runtime-resource-samples.json'), `${JSON.stringify(report, null, 2)}\n`)
socket.close()
console.log(JSON.stringify(report, null, 2))
