import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9363)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5230'
const cpuRate = Math.max(1, Math.min(8, Number(process.env.ARMSTEEL_COLLECTION_CPU_RATE ?? 1)))
const reducedMotion = process.env.ARMSTEEL_COLLECTION_REDUCED_MOTION === '1'
const evidenceSuffix = reducedMotion ? '-reduced-motion' : ''
const evidenceRoot = resolve('docs/renaissance/evidence')
const browserInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const browser = new WebSocket(browserInfo.webSocketDebuggerUrl)
let browserId = 0
const browserCalls = new Map()

function connect(socket, calls, onMessage) {
  return new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', () => {
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id && calls.has(message.id)) {
          const { resolve: done, reject: fail, timeout, method } = calls.get(message.id)
          clearTimeout(timeout); calls.delete(message.id)
          if (message.error) fail(new Error(`${method}: ${message.error.message}`)); else done(message.result)
        }
        onMessage?.(message)
      })
      resolveOpen()
    }, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
}

function request(socket, calls, next, method, params = {}) {
  const id = next()
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => { calls.delete(id); rejectRequest(new Error(`CDP timeout: ${method}`)) }, 30000)
    calls.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout, method })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

const callBrowser = (method, params) => request(browser, browserCalls, () => ++browserId, method, params)
let targetId = null, pageSocket = null, pageCalls = new Map(), pageId = 0, errors = [], traceEvents = [], traceCompleteResolve = null
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

try {
  await connect(browser, browserCalls)
  const target = await callBrowser('Target.createTarget', { url: 'about:blank' })
  targetId = target.targetId
  let page = null
  for (let attempt = 0; attempt < 100; attempt++) {
    page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((entry) => entry.id === targetId)
    if (page?.webSocketDebuggerUrl) break
    await sleep(50)
  }
  assert.ok(page?.webSocketDebuggerUrl, 'The isolated collection performance tab is available')
  pageSocket = new WebSocket(page.webSocketDebuggerUrl)
  await connect(pageSocket, pageCalls, (message) => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) errors.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`)
    if (message.method === 'Tracing.dataCollected') traceEvents.push(...message.params.value)
    if (message.method === 'Tracing.tracingComplete') traceCompleteResolve?.(message.params)
  })
  const call = (method, params) => request(pageSocket, pageCalls, () => ++pageId, method, params)
  async function evaluate(expression) {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  async function waitFor(expression, label, timeoutMs = 30000) {
    const started = Date.now()
    let lastValue = false
    while (Date.now() - started < timeoutMs) {
      lastValue = await evaluate(expression)
      if (lastValue) return
      await sleep(60)
    }
    throw new Error(`Timed out waiting for ${label}; final probe: ${JSON.stringify(lastValue)}`)
  }

  await Promise.all([call('Page.enable'), call('Runtime.enable'), call('Network.enable'), call('Log.enable'), call('Performance.enable')])
  await call('Network.setCacheDisabled', { cacheDisabled: true })
  await call('Emulation.setCPUThrottlingRate', { rate: cpuRate })
  if (reducedMotion) await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
  await call('Emulation.setTouchEmulationEnabled', { enabled: false })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const qa = window.__armsteelCollectionPerformance = { paints: [], longTasks: [], slowCanvasOps: [], webGLDrawCalls: [], rafCallbacks: {}, observerCallbacks: {}, workers: [], workerActive: 0 }
    for (const type of ['paint', 'largest-contentful-paint', 'longtask']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue
      const observer = new PerformanceObserver((entries) => qa[type === 'longtask' ? 'longTasks' : 'paints'].push(...entries.getEntries().map((entry) => ({ name: entry.name || type, startTime: entry.startTime, duration: entry.duration, size: entry.size ?? null }))))
      observer.observe({ type, buffered: true })
    }
    const NativeWorker = window.Worker
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args, target), record = { url: String(args[0]), terminated: false }
      qa.workers.push(record); qa.workerActive++
      const terminate = worker.terminate.bind(worker)
      worker.terminate = () => { if (!record.terminated) { record.terminated = true; qa.workerActive-- } return terminate() }
      return worker
    } })
    const nativeStroke = CanvasRenderingContext2D.prototype.stroke
    CanvasRenderingContext2D.prototype.stroke = function(...args) {
      const started = performance.now()
      try { return nativeStroke.apply(this, args) }
      finally {
        const duration = performance.now() - started
        if (duration > 4) qa.slowCanvasOps.push({ method: 'stroke', durationMs: Math.round(duration * 10) / 10, stack: new Error().stack?.split('\\n').slice(2, 7).join('\\n') })
      }
    }
    const webgl = WebGLRenderingContext.prototype
    const nativeDrawArrays = webgl.drawArrays
    webgl.drawArrays = function(...args) {
      const started = performance.now()
      try { return nativeDrawArrays.apply(this, args) }
      finally {
        const duration = performance.now() - started
        qa.webGLDrawCalls.push({ method: 'drawArrays', durationMs: Math.round(duration * 10) / 10 })
      }
    }
    const nativeRaf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) => nativeRaf((time) => {
      const started = performance.now()
      try { callback(time) }
      finally {
        const duration = performance.now() - started
        const name = callback.name || '(anonymous)'
        const stats = qa.rafCallbacks[name] ||= { calls: 0, totalMs: 0, maxMs: 0, over8Ms: 0, maxIntervalMs: 0, intervalsOver80Ms: 0, lastTime: null }
        if (stats.lastTime !== null) {
          const interval = time - stats.lastTime
          stats.maxIntervalMs = Math.max(stats.maxIntervalMs, interval)
          if (interval > 80) stats.intervalsOver80Ms++
        }
        stats.lastTime = time
        stats.calls++
        stats.totalMs += duration
        stats.maxMs = Math.max(stats.maxMs, duration)
        if (duration >= 8) stats.over8Ms++
      }
    })
    for (const name of ['ResizeObserver', 'IntersectionObserver']) {
      const NativeObserver = window[name]
      window[name] = class extends NativeObserver {
        constructor(callback) {
          super((...args) => {
            const started = performance.now()
            try { callback(...args) }
            finally {
              const duration = performance.now() - started
              const stats = qa.observerCallbacks[name] ||= { calls: 0, totalMs: 0, maxMs: 0, over8Ms: 0 }
              stats.calls++
              stats.totalMs += duration
              stats.maxMs = Math.max(stats.maxMs, duration)
              if (duration >= 8) stats.over8Ms++
            }
          })
        }
      }
    }
  })()` })

  const navigateStart = Date.now()
  await call('Page.navigate', { url: `${base}/` })
  await waitFor(`location.pathname === '/' && document.querySelectorAll('.artwork-preview').length >= 20 && document.querySelector('.hero-study-art canvas.artwork-preview')?.width > 0`, 'the homepage gallery and first preview canvases')
  await waitFor(`(() => { const canvas = document.querySelector('.hero-study-art canvas.artwork-preview'); const data = canvas?.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data; if (!data) return false; const colors = new Set(); for (let i=0; i<data.length; i+=Math.max(4,Math.floor(data.length/512))) colors.add(data[i]+','+data[i+1]+','+data[i+2]); return colors.size > 2 })()`, 'the homepage preview to paint representative pixels')
  await sleep(900)

  const desktop = await evaluate(`(() => {
    const navigation = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource').map((entry) => ({ name: new URL(entry.name).pathname, initiator: entry.initiatorType, durationMs: Math.round(entry.duration * 10) / 10, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize })).filter((entry) => entry.name.startsWith('/assets/'))
    return {
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      navigation: navigation && { responseStartMs: navigation.responseStart, domContentLoadedMs: navigation.domContentLoadedEventEnd, loadMs: navigation.loadEventEnd, transferBytes: navigation.transferSize, decodedBytes: navigation.decodedBodySize },
      paint: window.__armsteelCollectionPerformance.paints,
      longTasks: window.__armsteelCollectionPerformance.longTasks,
      slowCanvasOps: window.__armsteelCollectionPerformance.slowCanvasOps,
      webGLDrawCalls: window.__armsteelCollectionPerformance.webGLDrawCalls,
      ambientGpuTimerExtension: (() => { const gl = document.querySelector('.ambient-field')?.getContext('webgl'); return gl?.getSupportedExtensions()?.includes('EXT_disjoint_timer_query') ?? false })(),
      rafCallbacks: window.__armsteelCollectionPerformance.rafCallbacks,
      observerCallbacks: window.__armsteelCollectionPerformance.observerCallbacks,
      resources,
      dom: { nodes: document.getElementsByTagName('*').length, galleryCards: document.querySelectorAll('.gallery-card').length, previews: document.querySelectorAll('.artwork-preview').length, canvases: [...document.querySelectorAll('.artwork-preview')].filter((canvas) => canvas.width && canvas.height).length },
      worker: { active: window.__armsteelCollectionPerformance.workerActive, created: window.__armsteelCollectionPerformance.workers.length, urls: window.__armsteelCollectionPerformance.workers.map((worker) => worker.url) },
      ambient: (() => { const canvas = document.querySelector('.ambient-field'); const rect = canvas?.getBoundingClientRect(); const gl = canvas?.getContext('webgl'); const info = gl?.getExtension('WEBGL_debug_renderer_info'); return canvas && rect ? { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height, pixelRatio: Math.round(canvas.width / Math.max(rect.width, 1) * 100) / 100, fallback: canvas.dataset.fallback, renderer: info && gl ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null } : null })(),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      heap: performance.memory ? { usedBytes: performance.memory.usedJSHeapSize, totalBytes: performance.memory.totalJSHeapSize } : null
    }
  })()`)
  assert.equal(desktop.dom.galleryCards, 18, 'The homepage includes all eighteen non-featured studies')
  assert.ok(desktop.dom.previews >= 20, 'Featured art and all gallery studies mount their lightweight previews')
  assert.equal(desktop.overflow, false, 'The desktop gallery has no document-width overflow')
  const desktopShot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await mkdir(evidenceRoot, { recursive: true })
  await writeFile(resolve(evidenceRoot, `collection-performance-desktop${evidenceSuffix}.png`), Buffer.from(desktopShot.data, 'base64'))

  await call('Profiler.enable')
  await call('Profiler.setSamplingInterval', { interval: 1000 })
  await call('Profiler.start')
  await sleep(1400)
  const cpuProfile = await call('Profiler.stop')
  await call('Profiler.disable')
  const profileNodes = new Map(cpuProfile.profile.nodes.map((node) => [node.id, node]))
  const profileParents = new Map()
  for (const node of cpuProfile.profile.nodes) for (const child of node.children ?? []) profileParents.set(child, node.id)
  const profileCounts = new Map()
  for (const id of cpuProfile.profile.samples ?? []) {
    let currentId = id
    const frames = []
    while (currentId !== undefined) {
      const node = profileNodes.get(currentId)
      if (!node) break
      const frame = node.callFrame
      frames.unshift(`${frame.functionName || '(anonymous)'} @ ${frame.url || '[native]'}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`)
      currentId = profileParents.get(currentId)
    }
    const key = frames.slice(-8).join(' <- ')
    profileCounts.set(key, (profileCounts.get(key) ?? 0) + 1)
  }
  const cpuProfileTop = [...profileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([frame, samples]) => ({ frame, samples }))

  traceEvents = []
  const traceComplete = new Promise((resolveTrace) => { traceCompleteResolve = resolveTrace })
  await call('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline', options: 'record-until-full', transferMode: 'ReportEvents' })
  await sleep(1200)
  await call('Tracing.end')
  let traceTimeoutId
  try {
    await Promise.race([traceComplete, new Promise((_, rejectTrace) => { traceTimeoutId = setTimeout(() => rejectTrace(new Error('Timed out waiting for the browser trace')), 10000) })])
  } finally {
    clearTimeout(traceTimeoutId)
  }
  const threadNames = new Map(traceEvents.filter((event) => event.ph === 'M' && event.name === 'thread_name').map((event) => [`${event.pid}:${event.tid}`, event.args?.name ?? '']))
  const tracedTasks = traceEvents.filter((event) => event.ph === 'X' && event.dur >= 12000 && ['RunTask', 'Task', 'FunctionCall', 'EventDispatch', 'FireAnimationFrame', 'UpdateLayoutTree', 'Paint', 'DrawFrame', 'RunMicrotasks', 'EvaluateScript'].includes(event.name))
    .sort((a, b) => b.dur - a.dur).slice(0, 30)
    .map((event) => ({ name: event.name, category: event.cat, thread: threadNames.get(`${event.pid}:${event.tid}`) ?? null, pid: event.pid, tid: event.tid, durationMs: Math.round(event.dur / 100) / 10, startMs: Math.round(event.ts / 100) / 10, functionName: event.args?.data?.functionName ?? null, url: event.args?.data?.url ?? null, line: event.args?.data?.lineNumber ?? null, taskName: event.args?.data?.taskName ?? null }))
  const tracedRuns = traceEvents.filter((event) => event.ph === 'X' && event.name === 'RunTask' && event.dur >= 50000).sort((a, b) => b.dur - a.dur).slice(0, 8).map((task) => ({
    thread: threadNames.get(`${task.pid}:${task.tid}`) ?? null,
    pid: task.pid,
    tid: task.tid,
    durationMs: Math.round(task.dur / 100) / 10,
    events: traceEvents.filter((event) => event !== task && event.pid === task.pid && event.tid === task.tid && event.ph === 'X' && event.ts >= task.ts && event.ts + event.dur <= task.ts + task.dur && event.dur >= 1000)
      .sort((a, b) => b.dur - a.dur).slice(0, 12)
      .map((event) => ({ name: event.name, category: event.cat, durationMs: Math.round(event.dur / 100) / 10, functionName: event.args?.data?.functionName ?? null, url: event.args?.data?.url ?? null, line: event.args?.data?.lineNumber ?? null, keys: Object.keys(event.args?.data ?? {}) }))
  }))

  const desktopMetricStart = await call('Performance.getMetrics')
  const desktopSearchStart = Date.now()
  await evaluate(`document.querySelector('button[aria-label="Search the collection"]')?.click()`)
  await waitFor(`Boolean(document.querySelector('#collection-search input'))`, 'collection search opening')
  await call('Input.insertText', { text: 'Schwarzschild' })
  await waitFor(`document.querySelector('.result-count')?.textContent.trim() === '01 STUDY'`, 'the exact relativity-study search result')
  const desktopSearchMs = Date.now() - desktopSearchStart
  await evaluate(`(() => { const input = document.querySelector('#collection-search input'); if (!input) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })) })()`)
  await waitFor(`document.querySelectorAll('.gallery-card').length === 18`, 'the full gallery to return after clearing search')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  const desktopMetricEnd = await call('Performance.getMetrics')

  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 })
  await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await waitFor('innerWidth === 390', 'the phone viewport override')
  await evaluate('window.scrollTo(0,0)')
  await sleep(250)
  const mobile = await evaluate(`(() => ({ viewport: [innerWidth, innerHeight, devicePixelRatio], cards: document.querySelectorAll('.gallery-card').length, previews: document.querySelectorAll('.artwork-preview').length, documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, visibleCanvasCount: [...document.querySelectorAll('.artwork-preview')].filter((canvas) => { const rect = canvas.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth }).length }))()`)
  assert.equal(mobile.viewport[0], 390)
  assert.equal(mobile.overflow, false, 'The phone collection has no document-width overflow')
  assert.equal(mobile.cards, 18)
  const mobileShot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(resolve(evidenceRoot, `collection-performance-mobile${evidenceSuffix}.png`), Buffer.from(mobileShot.data, 'base64'))
  const mobileSearchStart = Date.now()
  await evaluate(`document.querySelector('button[aria-label="Search the collection"]')?.click()`)
  await waitFor(`Boolean(document.querySelector('#collection-search input'))`, 'phone search opening')
  await call('Input.insertText', { text: 'Schwarzschild' })
  await waitFor(`document.querySelector('.result-count')?.textContent.trim() === '01 STUDY'`, 'phone relativity-study search')
  const mobileSearchMs = Date.now() - mobileSearchStart

  const finalMetrics = await call('Performance.getMetrics')
  const final = await evaluate(`({ longTasks: window.__armsteelCollectionPerformance.longTasks, slowCanvasOps: window.__armsteelCollectionPerformance.slowCanvasOps, webGLDrawCalls: window.__armsteelCollectionPerformance.webGLDrawCalls, rafCallbacks: window.__armsteelCollectionPerformance.rafCallbacks, observerCallbacks: window.__armsteelCollectionPerformance.observerCallbacks, ambient: (() => { const canvas = document.querySelector('.ambient-field'); const rect = canvas?.getBoundingClientRect(); const gl = canvas?.getContext('webgl'); const info = gl?.getExtension('WEBGL_debug_renderer_info'); return canvas && rect ? { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height, pixelRatio: Math.round(canvas.width / Math.max(rect.width, 1) * 100) / 100, fallback: canvas.dataset.fallback, renderer: info && gl ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null } : null })(), worker: { active: window.__armsteelCollectionPerformance.workerActive, created: window.__armsteelCollectionPerformance.workers.length }, heap: performance.memory?.usedJSHeapSize ?? null })`)
  assert.deepEqual(errors, [], `Homepage/browser errors occurred: ${errors.join('; ')}`)
  const metricMap = (response) => Object.fromEntries(response.metrics.map(({ name, value }) => [name, value]))
  const metrics = { desktopBeforeSearch: metricMap(desktopMetricStart), desktopAfterSearch: metricMap(desktopMetricEnd), final: metricMap(finalMetrics) }
  const evidence = { browser: browserInfo.Browser, userAgent: await evaluate('navigator.userAgent'), renderer: desktop.ambient?.renderer ?? 'WebGL renderer not exposed by this browser', cpuThrottleRate: cpuRate, reducedMotion, coldCache: true, desktop, profile: { durationMs: 1400, samplingIntervalMicros: 1000, topStacks: cpuProfileTop }, trace: { eventCount: traceEvents.length, windowMs: 1200, longEvents: tracedTasks, longTaskDetails: tracedRuns, threads: Object.fromEntries(threadNames) }, search: { desktopMsIncludingCDPRoundTrips: desktopSearchMs, mobileMsIncludingCDPRoundTrips: mobileSearchMs, exactResult: '01 STUDY', desktopMetrics: { taskDurationDeltaSeconds: (metrics.desktopAfterSearch.TaskDuration ?? 0) - (metrics.desktopBeforeSearch.TaskDuration ?? 0), scriptDurationDeltaSeconds: (metrics.desktopAfterSearch.ScriptDuration ?? 0) - (metrics.desktopBeforeSearch.ScriptDuration ?? 0) } }, mobile, final, metrics, errors }
  await writeFile(resolve(evidenceRoot, `collection-performance${evidenceSuffix}.json`), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`Collection performance sample passed: cold desktop and emulated phone, ${desktop.dom.previews} previews, ${desktop.longTasks.length} desktop long tasks, ${desktop.slowCanvasOps.length} slow canvas strokes, search ${desktopSearchMs}/${mobileSearchMs} ms including CDP round trips; no overflow or browser/HTTP errors.`)
} finally {
  pageSocket?.close()
  if (targetId) await callBrowser('Target.closeTarget', { targetId }).catch(() => {})
  browser.close()
}
