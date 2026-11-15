import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5217'
const experiments = JSON.parse(await readFile(new URL('../src/data/experiments.json', import.meta.url), 'utf8'))
const evidenceRoot = resolve('docs/renaissance/evidence')
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
const browserErrors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) {
    const { resolve, reject, method, timeout } = waiting.get(message.id)
    clearTimeout(timeout)
    waiting.delete(message.id)
    if (message.error) reject(new Error(`${method}: ${message.error.message}`))
    else resolve(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text)
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserErrors.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`)
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

async function clickButton(label, trusted = false) {
  const target = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.getAttribute('aria-label') || item.innerText).replace(/\\s+/g, ' ').trim() === ${JSON.stringify(label)})
    if (!button || button.disabled) return null
    const rect = button.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  assert.ok(target, `Missing or disabled button: ${label}`)
  if (!trusted) {
    await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => (item.getAttribute('aria-label') || item.innerText).replace(/\\s+/g, ' ').trim() === ${JSON.stringify(label)}); button?.click() })()`)
    return
  }
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, buttons: 0 })
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 })
}

async function waitForRoute(id) {
  await waitFor(`location.pathname === ${JSON.stringify(`/exhibits/${id}`)} && Boolean(document.querySelector('.dock-current span')) && !document.querySelector('.experience-loading')`, `${id} mounted`)
  assert.equal(await evaluate('Boolean(document.querySelector(".experience-error"))'), false, `${id} mounted without the error boundary`)
  await sleep(180)
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Performance.enable')
await call('HeapProfiler.enable')
await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const monitor = window.__armsteelLifecycle = { workers: [], audioContexts: [] }
  const NativeWorker = window.Worker
  function TrackedWorker(...args) {
    if (!new.target) throw new TypeError('Worker constructor requires new')
    const worker = new NativeWorker(...args)
    const record = { url: String(args[0]), owner: location.pathname, terminated: false }
    monitor.workers.push(record)
    const terminate = worker.terminate.bind(worker)
    worker.terminate = () => { record.terminated = true; return terminate() }
    return worker
  }
  TrackedWorker.prototype = NativeWorker.prototype
  Object.setPrototypeOf(TrackedWorker, NativeWorker)
  window.Worker = TrackedWorker
  if (window.AudioContext) {
    const NativeAudioContext = window.AudioContext
    function TrackedAudioContext(...args) {
      if (!new.target) throw new TypeError('AudioContext constructor requires new')
      const context = new NativeAudioContext(...args)
      monitor.audioContexts.push({ context, owner: location.pathname })
      return context
    }
    TrackedAudioContext.prototype = NativeAudioContext.prototype
    Object.setPrototypeOf(TrackedAudioContext, NativeAudioContext)
    window.AudioContext = TrackedAudioContext
  }
})()` })
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
await call('Page.navigate', { url: `${base}/exhibits/${experiments[0].id}` })
await waitForRoute(experiments[0].id)

const routeSamples = []
const transitionChecks = []
const heapSamples = []
for (let cycle = 0; cycle < 2; cycle++) {
  for (let index = 0; index < experiments.length; index++) {
    const item = experiments[index]
    if (cycle > 0 && index === 0) await waitForRoute(item.id)
    const before = await evaluate(`(() => ({
      route: location.pathname,
      workers: window.__armsteelLifecycle.workers.filter((worker) => !worker.terminated).map((worker) => worker.url),
      audioStates: window.__armsteelLifecycle.audioContexts.filter((entry) => entry.owner === location.pathname).map((entry) => entry.context.state),
    }))()`)
    assert.equal(before.route, `/exhibits/${item.id}`, `Expected to inspect ${item.id}`)

    if (item.id === 'mandelbrot') assert.ok(before.workers.length >= 1, 'Mandelbrot owns a live tile worker while mounted')
    if (item.id === 'lensing') assert.ok(before.workers.some((url) => url.includes('lensing.worker')), 'Where Light Falls owns its photon-table worker while mounted')
    if (item.id === 'sound') {
      assert.equal(await evaluate(`document.querySelector('.iw-sound-actions span')?.textContent.trim()`), 'AUDIO OFF', 'Sound study starts without audio')
      await clickButton('Listen to the signal', true)
      await waitFor(`document.querySelector('.iw-sound-actions span')?.textContent.trim() === 'AUDIO ON · LOW LEVEL'`, 'explicit sound start')
      const audio = await evaluate(`window.__armsteelLifecycle.audioContexts.filter((entry) => entry.owner === location.pathname).map((entry) => entry.context.state)`)
      assert.equal(audio.length, cycle + 1, 'Each sound visit creates only one new audio context')
      assert.ok(audio.slice(0, -1).every((state) => state === 'closed'), 'Audio contexts from earlier visits remain closed')
      assert.equal(audio.at(-1), 'running', 'The current signal starts only after the visitor action')
    }

    routeSamples.push({ id: item.id, cycle: cycle + 1, workers: before.workers.length, audioStates: before.audioStates })
    if ((cycle === 0 && (index === 9 || index === 18)) || (cycle === 1 && index === 18)) {
      await call('HeapProfiler.collectGarbage')
      heapSamples.push(await evaluate(`({ route: location.pathname, usedBytes: performance.memory?.usedJSHeapSize ?? null })`))
    }

    const next = experiments[(index + 1) % experiments.length]
    if (cycle === 1 && index === experiments.length - 1) continue
    await clickButton('Next experiment')
    await waitForRoute(next.id)
    const remaining = await evaluate(`({
      workers: window.__armsteelLifecycle.workers.filter((worker) => !worker.terminated && worker.owner === ${JSON.stringify(`/exhibits/${item.id}`)}).map((worker) => worker.url),
      audio: window.__armsteelLifecycle.audioContexts.filter((entry) => entry.owner === ${JSON.stringify(`/exhibits/${item.id}`)}).map((entry) => entry.context.state),
    })`)
    assert.deepEqual(remaining.workers, [], `${item.id} releases every exhibit-owned worker when unmounted`)
    if (item.id === 'sound') assert.ok(remaining.audio.length > 0 && remaining.audio.every((state) => state === 'closed'), 'Leaving the sound study closes all of its audio contexts')
    transitionChecks.push({ from: item.id, to: next.id, workersReleased: remaining.workers.length === 0, audioStatesAfterExit: remaining.audio })
  }
}

const finalRoute = experiments.at(-1)
await clickButton('Return to exhibition')
await waitFor(`location.pathname === '/' && Boolean(document.querySelector('.exhibition-page'))`, 'final route unmount and gallery return')
await sleep(240)
const finalExit = await evaluate(`({
  exhibitWorkers: window.__armsteelLifecycle.workers.filter((worker) => !worker.terminated && worker.owner.startsWith('/exhibits/')).map((worker) => ({ owner: worker.owner, url: worker.url })),
  activeWorkers: window.__armsteelLifecycle.workers.filter((worker) => !worker.terminated).map((worker) => ({ owner: worker.owner, url: worker.url })),
  audioStates: window.__armsteelLifecycle.audioContexts.map((entry) => entry.context.state),
})`)
assert.deepEqual(finalExit.exhibitWorkers, [], 'The last exhibit releases its workers when returning to the gallery')
assert.ok(finalExit.activeWorkers.every((worker) => worker.owner === '/' && worker.url.includes('previewRaster.worker')), 'Only visibility-scheduled gallery preview work may remain after leaving an exhibit')
assert.ok(finalExit.audioStates.every((state) => state === 'closed'), 'All sound contexts remain closed after the final route exit')
transitionChecks.push({ from: finalRoute.id, to: '/', workersReleased: true, audioStatesAfterExit: finalExit.audioStates })
await call('HeapProfiler.collectGarbage')
const workerSummary = await evaluate(`(() => {
  const workers = window.__armsteelLifecycle.workers
  const exhibits = workers.filter((worker) => worker.owner.startsWith('/exhibits/'))
  return {
    totalCreated: workers.length,
    totalTerminated: workers.filter((worker) => worker.terminated).length,
    exhibitCreated: exhibits.length,
    exhibitTerminated: exhibits.filter((worker) => worker.terminated).length,
  }
})()`)
const report = {
  browser: await evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const debug = gl?.getExtension('WEBGL_debug_renderer_info'); return { userAgent: navigator.userAgent, devicePixelRatio, viewport: [innerWidth, innerHeight], renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? 'unavailable' } })()`),
  method: 'Traverse the full ordered exhibit list twice through the real SPA next control. Instrument Worker and AudioContext creation and termination in the browser document, check each owner after unmount, start sound only through a trusted browser click, and sample JS heap after V8 collection at three checkpoints. Heap values are estimates and do not establish device-wide memory or long-run boundedness.',
  exhibits: experiments.length,
  routeEntries: routeSamples.length,
  transitions: transitionChecks.length,
  workers: workerSummary,
  activeGalleryWorkers: finalExit.activeWorkers,
  audioContextsCreated: await evaluate('window.__armsteelLifecycle.audioContexts.length'),
  audioContextsClosed: await evaluate(`window.__armsteelLifecycle.audioContexts.filter((entry) => entry.context.state === 'closed').length`),
  routeSamples,
  heapSamples,
  transitionChecks,
  browserErrors,
}
assert.equal(report.transitions, experiments.length * 2, 'Every route exited twice through SPA navigation')
assert.equal(report.workers.exhibitCreated, report.workers.exhibitTerminated, 'Every worker created by these exhibit routes was terminated')
assert.equal(report.audioContextsCreated, 2, 'The sound study created one context on each visit')
assert.equal(report.audioContextsClosed, report.audioContextsCreated, 'Every explicitly started audio context was closed on exit')
assert.deepEqual(browserErrors, [], `Browser/network errors occurred: ${browserErrors.join('; ')}`)
await mkdir(evidenceRoot, { recursive: true })
await writeFile(resolve(evidenceRoot, 'route-lifecycle-browser-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
socket.close()
console.log(`Route lifecycle browser checks passed: ${report.routeEntries} route samples, ${report.transitions} exits, ${report.workers.exhibitTerminated} exhibit workers terminated, ${report.audioContextsClosed} audio contexts closed, no browser/network errors.`)
