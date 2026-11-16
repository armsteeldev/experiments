import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5217'
const experiments = JSON.parse(await readFile(new URL('../src/data/experiments.json', import.meta.url), 'utf8'))
const evidenceRoot = resolve('docs/renaissance/evidence')
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && (target.url === 'about:blank' || target.url.startsWith(base)))
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
  const readyAtMs = await evaluate('performance.now()')
  await sleep(180)
  return readyAtMs
}

async function collectScriptResources() {
  return evaluate(`performance.getEntriesByType('resource').filter((entry) => {
    const url = new URL(entry.name)
    return url.origin === location.origin && /^\\/assets\\/.+\\.(?:js|css)$/.test(url.pathname)
  }).map((entry) => ({
    path: new URL(entry.name).pathname,
    initiatorType: entry.initiatorType,
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
    durationMs: Number.isFinite(entry.duration) && entry.duration >= 0 ? Number(entry.duration.toFixed(2)) : null,
    timingValid: Number.isFinite(entry.duration) && entry.duration >= 0,
  }))`)
}

async function sampleFrameCadence(id) {
  const route = `/exhibits/${id}`
  const before = await evaluate(`(() => {
    const records=window.__armsteelLifecycle.graphics.filter((item)=>item.owner===${JSON.stringify(route)})
    return records.reduce((summary,item)=>{summary[item.type]??={drawCalls:0,contexts:0};summary[item.type].drawCalls+=item.drawCalls;summary[item.type].contexts++;return summary},{})
  })()`)
  const sample = await evaluate(`new Promise((resolve) => {
    const intervals=[]; const started=performance.now(); let previous=null; let finished=false
    const finish=(reason,time=performance.now())=>{ if(finished)return; finished=true; clearTimeout(watchdog); resolve({durationMs:time-started,intervals,finishedBy:reason}) }
    const watchdog=setTimeout(()=>finish('watchdog'),3000)
    const tick=(time)=>{ if(previous!==null) intervals.push(time-previous); previous=time; if(time-started>=1000) finish('one-second-window',time); else requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })`)
  const after = await evaluate(`(() => {
    const records=window.__armsteelLifecycle.graphics.filter((item)=>item.owner===${JSON.stringify(route)})
    return records.reduce((summary,item)=>{summary[item.type]??={drawCalls:0,contexts:0};summary[item.type].drawCalls+=item.drawCalls;summary[item.type].contexts++;return summary},{})
  })()`)
  const sorted = sample.intervals.toSorted((a, b) => a - b)
  const percentile = (values, fraction) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]
  const draws = {}
  for (const type of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[type] ?? { drawCalls: 0, contexts: 0 }
    const current = after[type] ?? { drawCalls: 0, contexts: 0 }
    draws[type] = { contexts: current.contexts, drawOperations: current.drawCalls - previous.drawCalls, operationsPerSecond: Number(((current.drawCalls - previous.drawCalls) / (sample.durationMs / 1000)).toFixed(1)) }
  }
  return {
    exhibit: id,
    frames: sample.intervals.length,
    durationMs: Number(sample.durationMs.toFixed(1)),
    finishedBy: sample.finishedBy,
    intervalMedianMs: sorted.length ? Number(percentile(sorted, .5).toFixed(2)) : null,
    intervalP95Ms: sorted.length ? Number(percentile(sorted, .95).toFixed(2)) : null,
    intervalsMs: sorted.map((value) => Number(value.toFixed(2))),
    drawOperations: draws,
  }
}

async function graphicsForRoute(id) {
  return evaluate(`(() => window.__armsteelLifecycle.graphics.filter((item)=>item.owner===${JSON.stringify(`/exhibits/${id}`)}).map((item)=>({
    type:item.type,
    canvasConnected:Boolean(item.canvas.deref()?.isConnected),
    contextLive:Boolean(item.context.deref()),
    drawCalls:item.drawCalls,
    resourceCreates:item.resourceCreates,
    resourceDeletes:item.resourceDeletes,
  })))()`)
}

async function collectHeapSnapshot() {
  await call('HeapProfiler.collectGarbage')
  const snapshot = await evaluate(`(() => {
    const rows=window.__armsteelLifecycle.graphics.filter((item)=>item.owner.startsWith('/exhibits/'))
    const activeRoute=location.pathname
    const detached=rows.filter((item)=>!item.canvas.deref()?.isConnected)
    const outsideActiveRoute=rows.filter((item)=>item.owner!==activeRoute)
    return {
      route:activeRoute,
      usedBytes:performance.memory?.usedJSHeapSize??null,
      graphicsContextsTracked:rows.length,
      detachedCanvasReferences:detached.filter((item)=>Boolean(item.canvas.deref())).length,
      detachedContextsStillLive:detached.filter((item)=>Boolean(item.context.deref())).length,
      detachedContextsOutsideActiveRoute:outsideActiveRoute.filter((item)=>!item.canvas.deref()?.isConnected&&Boolean(item.context.deref())).length,
      activeRouteDetachedContexts:rows.filter((item)=>item.owner===activeRoute&&!item.canvas.deref()?.isConnected&&Boolean(item.context.deref())).length,
      connectedExhibitCanvases:rows.filter((item)=>item.canvas.deref()?.isConnected).length,
      connectedCanvasesOutsideActiveRoute:outsideActiveRoute.filter((item)=>item.canvas.deref()?.isConnected).length,
    }
  })()`)
  assert.equal(snapshot.detachedContextsOutsideActiveRoute, 0, `Detached graphics contexts from exited routes are collectible after V8 collection at ${snapshot.route}`)
  assert.equal(snapshot.connectedCanvasesOutsideActiveRoute, 0, `Only the active route may own connected exhibit canvases at ${snapshot.route}`)
  if (snapshot.route === '/') {
    assert.equal(snapshot.detachedContextsStillLive, 0, 'All detached exhibit graphics contexts are collectible after returning to the gallery')
    assert.equal(snapshot.detachedCanvasReferences, 0, 'All detached exhibit canvases are collectible after returning to the gallery')
    assert.equal(snapshot.connectedExhibitCanvases, 0, 'No exhibit canvas remains connected after returning to the gallery')
  }
  return snapshot
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Performance.enable')
await call('HeapProfiler.enable')
const lifecycleInstrumentation = await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const monitor = window.__armsteelLifecycle = { workers: [], audioContexts: [], graphics: [] }
  const graphicsMeta = new WeakMap()
  const NativeGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const context = NativeGetContext.call(this, type, ...args)
    const normalizedType = String(type).toLowerCase() === 'experimental-webgl' ? 'webgl' : String(type).toLowerCase()
    if (context && !graphicsMeta.has(context) && ['2d', 'webgl', 'webgl2'].includes(normalizedType)) {
      const record = { owner: location.pathname, type: normalizedType, canvas: new WeakRef(this), context: new WeakRef(context), drawCalls: 0, resourceCreates: {}, resourceDeletes: {} }
      graphicsMeta.set(context, record)
      monitor.graphics.push(record)
    }
    return context
  }
  const instrument = (prototype, name, operation, resource = null) => {
    if (!prototype || !Object.prototype.hasOwnProperty.call(prototype, name) || typeof prototype[name] !== 'function') return
    const original = prototype[name]
    prototype[name] = function(...args) {
      const record = graphicsMeta.get(this)
      const result = original.apply(this, args)
      if (record) {
        if (operation === 'draw') record.drawCalls++
        else if (operation === 'create' && result) record.resourceCreates[resource] = (record.resourceCreates[resource] ?? 0) + 1
        else if (operation === 'delete' && args[0]) record.resourceDeletes[resource] = (record.resourceDeletes[resource] ?? 0) + 1
      }
      return result
    }
  }
  for (const name of ['clearRect', 'fillRect', 'strokeRect', 'drawImage', 'putImageData', 'fill', 'stroke', 'fillText', 'strokeText']) instrument(window.CanvasRenderingContext2D?.prototype, name, 'draw')
  const resourceMethods = {
    createBuffer: ['create', 'buffer'], deleteBuffer: ['delete', 'buffer'],
    createTexture: ['create', 'texture'], deleteTexture: ['delete', 'texture'],
    createProgram: ['create', 'program'], deleteProgram: ['delete', 'program'],
    createShader: ['create', 'shader'], deleteShader: ['delete', 'shader'],
    createFramebuffer: ['create', 'framebuffer'], deleteFramebuffer: ['delete', 'framebuffer'],
    createRenderbuffer: ['create', 'renderbuffer'], deleteRenderbuffer: ['delete', 'renderbuffer'],
    createVertexArray: ['create', 'vertexArray'], deleteVertexArray: ['delete', 'vertexArray'],
    createSampler: ['create', 'sampler'], deleteSampler: ['delete', 'sampler'],
  }
  const prototypes = [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]
  for (const prototype of prototypes) {
    for (const [name, [operation, resource]] of Object.entries(resourceMethods)) instrument(prototype, name, operation, resource)
    for (const name of ['drawArrays', 'drawElements', 'drawRangeElements', 'drawArraysInstanced', 'drawElementsInstanced']) instrument(prototype, name, 'draw')
  }
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
const initialMountStartedAt = Date.now()
await call('Page.navigate', { url: `${base}/exhibits/${experiments[0].id}` })
const initialReadyAt = await waitForRoute(experiments[0].id)
const initialMount = { exhibit: experiments[0].id, durationMs: Date.now() - initialMountStartedAt, readyAtPerformanceMs: Number(initialReadyAt.toFixed(1)) }

const routeSamples = []
const transitionChecks = []
const heapSamples = []
const frameSamples = []
const measuredFrameRoutes = new Set(['mandelbrot', 'fluid', 'attractors', 'reaction', 'garden'])
const assetLedger = new Map((await collectScriptResources()).map((asset) => [asset.path, { ...asset, firstRoute: experiments[0].id }]))
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
    const graphics = await graphicsForRoute(item.id)
    if (item.id === 'fluid') {
      const contexts = graphics.filter((record) => record.type === 'webgl2')
      assert.equal(contexts.length, cycle + 1, `Fluid creates one WebGL context per visit through cycle ${cycle + 1}`)
      for (const context of contexts) assert.equal(context.resourceCreates.shader, context.resourceCreates.program + 1, 'Fluid compiles one shared fullscreen vertex shader for its pass programs')
    }
    if (cycle === 0 && measuredFrameRoutes.has(item.id)) frameSamples.push(await sampleFrameCadence(item.id))

    if (item.id === 'mandelbrot') assert.ok(before.workers.length >= 1, 'Mandelbrot owns a live tile worker while mounted')
    if (item.id === 'lensing') assert.ok(before.workers.some((url) => url.includes('lensing.worker')), 'Where Light Falls owns its photon-table worker while mounted')
    if (item.id === 'sound') {
      await waitFor(`Boolean(document.querySelector('.iw-sound-actions span'))`, 'sound controls after the lazy route mounts')
      assert.equal(await evaluate(`document.querySelector('.iw-sound-actions span')?.textContent.trim()`), 'AUDIO OFF', 'Sound study starts without audio')
      await clickButton('Listen to the signal', true)
      await waitFor(`document.querySelector('.iw-sound-actions span')?.textContent.trim() === 'AUDIO ON · LOW LEVEL'`, 'explicit sound start')
      const audio = await evaluate(`window.__armsteelLifecycle.audioContexts.filter((entry) => entry.owner === location.pathname).map((entry) => entry.context.state)`)
      assert.equal(audio.length, cycle + 1, 'Each sound visit creates only one new audio context')
      assert.ok(audio.slice(0, -1).every((state) => state === 'closed'), 'Audio contexts from earlier visits remain closed')
      assert.equal(audio.at(-1), 'running', 'The current signal starts only after the visitor action')
    }

    routeSamples.push({ id: item.id, cycle: cycle + 1, workers: before.workers.length, audioStates: before.audioStates, graphicsContexts: graphics.length, graphicsTypes: graphics.map(({ type }) => type) })
    if (routeSamples.length === 1 || routeSamples.length % 5 === 0) console.log(`Route lifecycle progress: ${routeSamples.length}/${experiments.length * 2} route visits (${item.id}, pass ${cycle + 1}).`)
    if ((cycle === 0 && (index === 9 || index === 18)) || (cycle === 1 && index === 18)) {
      heapSamples.push(await collectHeapSnapshot())
    }

    const next = experiments[(index + 1) % experiments.length]
    if (cycle === 1 && index === experiments.length - 1) continue
    const navigationStartedAt = await evaluate('performance.now()')
    await clickButton('Next experiment')
    const routeReadyAt = await waitForRoute(next.id)
    const remaining = await evaluate(`({
      workers: window.__armsteelLifecycle.workers.filter((worker) => !worker.terminated && worker.owner === ${JSON.stringify(`/exhibits/${item.id}`)}).map((worker) => worker.url),
      audio: window.__armsteelLifecycle.audioContexts.filter((entry) => entry.owner === ${JSON.stringify(`/exhibits/${item.id}`)}).map((entry) => entry.context.state),
    })`)
    assert.deepEqual(remaining.workers, [], `${item.id} releases every exhibit-owned worker when unmounted`)
    if (item.id === 'sound') assert.ok(remaining.audio.length > 0 && remaining.audio.every((state) => state === 'closed'), 'Leaving the sound study closes all of its audio contexts')
    const graphicsAfterExit = await graphicsForRoute(item.id)
    const connectedGraphics = graphicsAfterExit.filter((record) => record.canvasConnected)
    assert.deepEqual(connectedGraphics, [], `${item.id} releases its exhibit canvases from the document on unmount`)
    const resourceCreates = graphicsAfterExit.reduce((summary, record) => { for (const [kind, count] of Object.entries(record.resourceCreates ?? {})) summary[kind] = (summary[kind] ?? 0) + count; return summary }, {})
    const resourceDeletes = graphicsAfterExit.reduce((summary, record) => { for (const [kind, count] of Object.entries(record.resourceDeletes ?? {})) summary[kind] = (summary[kind] ?? 0) + count; return summary }, {})
    const resourceKinds = new Set([...Object.keys(resourceCreates), ...Object.keys(resourceDeletes)])
    const outstandingResources = Object.fromEntries([...resourceKinds].filter((kind) => (resourceCreates[kind] ?? 0) !== (resourceDeletes[kind] ?? 0)).map((kind) => [kind, { created: resourceCreates[kind] ?? 0, deleted: resourceDeletes[kind] ?? 0 }]))
    assert.deepEqual(outstandingResources, {}, `${item.id} deletes all tracked WebGL resources before leaving the route`)
    const loadedAssets = await collectScriptResources()
    const newAssets = loadedAssets.filter((asset) => !assetLedger.has(asset.path))
    for (const asset of newAssets) assetLedger.set(asset.path, { ...asset, firstRoute: next.id })
    transitionChecks.push({
      from: item.id,
      to: next.id,
      mountDurationMs: Number((routeReadyAt - navigationStartedAt).toFixed(1)),
      workersReleased: remaining.workers.length === 0,
      audioStatesAfterExit: remaining.audio,
      graphicsAfterExit: {
        contextsObserved: graphicsAfterExit.length,
        detachedCanvases: graphicsAfterExit.length - connectedGraphics.length,
        liveWeakContexts: graphicsAfterExit.filter((record) => record.contextLive).length,
        resourceCreates,
        resourceDeletes,
        outstandingResources,
      },
      newAssets,
    })
  }
}

const finalRoute = experiments.at(-1)
const galleryReturnStartedAt = await evaluate('performance.now()')
await clickButton('Return to exhibition')
await waitFor(`location.pathname === '/' && Boolean(document.querySelector('.exhibition-page'))`, 'final route unmount and gallery return')
const galleryReadyAt = await evaluate('performance.now()')
await sleep(240)
const finalExit = await evaluate(`({
  exhibitWorkers: window.__armsteelLifecycle.workers.filter((worker) => !worker.terminated && worker.owner.startsWith('/exhibits/')).map((worker) => ({ owner: worker.owner, url: worker.url })),
  activeWorkers: window.__armsteelLifecycle.workers.filter((worker) => !worker.terminated).map((worker) => ({ owner: worker.owner, url: worker.url })),
  audioStates: window.__armsteelLifecycle.audioContexts.map((entry) => entry.context.state),
})`)
assert.deepEqual(finalExit.exhibitWorkers, [], 'The last exhibit releases its workers when returning to the gallery')
assert.ok(finalExit.activeWorkers.every((worker) => worker.owner === '/' && worker.url.includes('previewRaster.worker')), 'Only visibility-scheduled gallery preview work may remain after leaving an exhibit')
assert.ok(finalExit.audioStates.every((state) => state === 'closed'), 'All sound contexts remain closed after the final route exit')
transitionChecks.push({ from: finalRoute.id, to: '/', mountDurationMs: Number((galleryReadyAt - galleryReturnStartedAt).toFixed(1)), workersReleased: true, audioStatesAfterExit: finalExit.audioStates })
const finalHeapSnapshot = await collectHeapSnapshot()
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
const mountTimes = transitionChecks.map((check) => check.mountDurationMs).filter(Number.isFinite).toSorted((a, b) => a - b)
assert.equal(mountTimes.length, transitionChecks.length, 'Every measured route transition has a finite mount duration')
const percentile = (values, fraction) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]
const firstSeenAssets = [...assetLedger.values()]
const invalidResourceTimingEntries = firstSeenAssets.filter((asset) => !asset.timingValid).map(({ path, firstRoute }) => ({ path, firstRoute }))
const graphicsSummary = await evaluate(`(() => {
  const graphics=window.__armsteelLifecycle.graphics.filter((item)=>item.owner.startsWith('/exhibits/'))
  const byType={}
  for (const item of graphics) {
    byType[item.type]??={contexts:0,drawCalls:0,resourceCreates:{},resourceDeletes:{}}
    const summary=byType[item.type]
    summary.contexts++; summary.drawCalls+=item.drawCalls
    for (const [kind,count] of Object.entries(item.resourceCreates)) summary.resourceCreates[kind]=(summary.resourceCreates[kind]??0)+count
    for (const [kind,count] of Object.entries(item.resourceDeletes)) summary.resourceDeletes[kind]=(summary.resourceDeletes[kind]??0)+count
  }
  return { contextsCreated:graphics.length, byType }
})()`)
const report = {
  browser: await evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const debug = gl?.getExtension('WEBGL_debug_renderer_info'); return { userAgent: navigator.userAgent, devicePixelRatio, viewport: [innerWidth, innerHeight], renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? 'unavailable' } })()`),
  method: 'Traverse the full ordered exhibit list twice through the real SPA next control. Instrument Worker, AudioContext, Canvas2D and WebGL creation/cleanup in the browser document; time mounted routes; record first-seen same-origin script/style resources from Resource Timing; sample one-second requestAnimationFrame windows and draw API calls on five representative renderer paths; and sample JS heap plus weak graphics references after forced V8 collection at three route checkpoints and after gallery return. Invalid negative Resource Timing durations are null and marked invalid. Heap values are estimates and do not establish device-wide memory or long-run boundedness. Renderer monkey-patching adds measurement overhead; frame values are software-rendered browser behavior, not physical GPU performance.',
  exhibits: experiments.length,
  routeEntries: routeSamples.length,
  transitions: transitionChecks.length,
  initialMount,
  mountDurationSummaryMs: { count: mountTimes.length, median: Number(percentile(mountTimes, .5).toFixed(1)), p95: Number(percentile(mountTimes, .95).toFixed(1)), maximum: Number(mountTimes.at(-1).toFixed(1)) },
  firstSeenAssets,
  invalidResourceTimingEntries,
  frameSamples,
  workers: workerSummary,
  graphics: graphicsSummary,
  canvasCleanupChecks: transitionChecks.length,
  finalHeapSnapshot,
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
await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: lifecycleInstrumentation.identifier })
socket.close()
console.log(`Route lifecycle browser checks passed: ${report.routeEntries} route samples, ${report.transitions} exits, ${report.workers.exhibitTerminated} exhibit workers terminated, ${report.audioContextsClosed} audio contexts closed, no browser/network errors.`)
