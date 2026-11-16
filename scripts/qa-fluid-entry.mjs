import './require-browser-qa-supervisor.mjs'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5217'
const viewportWidth = Number(process.env.ARMSTEEL_VIEWPORT_WIDTH ?? 1050)
const viewportHeight = Number(process.env.ARMSTEEL_VIEWPORT_HEIGHT ?? 737)
const route = '/exhibits/fluid'
assert.ok(Number.isInteger(viewportWidth) && viewportWidth > 0 && viewportWidth <= 4096, 'Viewport width must be a positive integer no larger than 4096')
assert.ok(Number.isInteger(viewportHeight) && viewportHeight > 0 && viewportHeight <= 4096, 'Viewport height must be a positive integer no larger than 4096')
const health = await fetch(`${base}/`)
assert.equal(health.status, 200, `Preview must return HTTP 200 at ${base}`)

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && (target.url === 'about:blank' || target.url.startsWith(base)))
assert.ok(page, `No blank or preview page found on CDP port ${port}`)
assert.equal(page.url, 'about:blank', 'Cold-entry samples require a fresh about:blank browser page')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  socket.addEventListener('open', resolveOpen, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 0
const waiting = new Map()
const httpErrors = []
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
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
    httpErrors.push({ status: message.params.response.status, url: message.params.response.url })
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text)
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
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Log.enable')
  await call('Performance.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: false, screenWidth: viewportWidth, screenHeight: viewportHeight })
  const startedAt = Date.now()
  const navigation = await call('Page.navigate', { url: `${base}${route}` })
  let readyAtPerformanceMs = null
  let readyAtWallClockMs = null
  for (let attempt = 0; attempt < 300; attempt++) {
    const state = await evaluate(`({
      ready: location.pathname === ${JSON.stringify(route)} && Boolean(document.querySelector('.dock-current span')) && Boolean(document.querySelector('.fluid-canvas')?.getContext('webgl2')) && !document.querySelector('.experience-loading') && !document.querySelector('.experience-error'),
      refused: document.body?.innerText.includes('ERR_CONNECTION_REFUSED') ?? false,
    })`)
    assert.equal(state.refused, false, 'Preview connection stayed available throughout navigation')
    if (state.ready) {
      readyAtPerformanceMs = await evaluate('performance.now()')
      readyAtWallClockMs = Date.now()
      break
    }
    await delay(100)
  }
  assert.notEqual(readyAtPerformanceMs, null, 'Fluid mounted within the 30-second observation window')
  assert.notEqual(readyAtWallClockMs, null, 'Fluid mount readiness was captured on the host clock')

  const pageDetails = await evaluate(`(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const debug = gl?.getExtension('WEBGL_debug_renderer_info')
    const resources = performance.getEntriesByType('resource').filter((entry) => {
      const url = new URL(entry.name)
      return url.origin === location.origin && /^\\/assets\\/.+\\.js$/.test(url.pathname)
    }).map((entry) => ({
      path: new URL(entry.name).pathname,
      durationMs: Number.isFinite(entry.duration) && entry.duration >= 0 ? Number(entry.duration.toFixed(2)) : null,
      timingValid: Number.isFinite(entry.duration) && entry.duration >= 0,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    }))
    const navigation = performance.getEntriesByType('navigation')[0]
    return {
      title: document.title,
      route: location.pathname,
      readyState: document.readyState,
      fluidCanvas: Boolean(document.querySelector('.fluid-canvas')),
      devicePixelRatio,
      viewport: [innerWidth, innerHeight],
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? 'unavailable',
      resources,
      invalidResourceTimings: resources.filter((entry) => !entry.timingValid).map(({ path }) => path),
      paint: performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, startTimeMs: Number(entry.startTime.toFixed(2)) })),
      navigation: navigation ? {
        domContentLoadedMs: Number(navigation.domContentLoadedEventEnd.toFixed(2)),
        loadMs: Number(navigation.loadEventEnd.toFixed(2)),
        domCompleteMs: Number(navigation.domComplete.toFixed(2)),
      } : null,
      longTasks: performance.getEntriesByType('longtask').map((entry) => ({ startTimeMs: Number(entry.startTime.toFixed(2)), durationMs: Number(entry.duration.toFixed(2)) })),
    }
  })()`)
  const metricResponse = await call('Performance.getMetrics')
  const report = {
    capturedAt: new Date().toISOString(),
    method: 'Fresh Chromium page navigated directly to the built Fluid route with no page instrumentation at an explicit desktop viewport. Browser-observed mount time is captured at route readiness before follow-up DevTools queries; timing and heap metrics are single-session samples, not a physical-GPU benchmark.',
    preview: base,
    route: pageDetails.route,
    coldPage: true,
    viewport: pageDetails.viewport,
    devicePixelRatio: pageDetails.devicePixelRatio,
    renderer: pageDetails.renderer,
    userAgent: await evaluate('navigator.userAgent'),
    serverHttpStatus: health.status,
    navigationError: navigation.errorText ?? null,
    browserObservedMountMs: readyAtWallClockMs - startedAt,
    postReadySamplingMs: Date.now() - readyAtWallClockMs,
    readyAtPerformanceMs: Number(readyAtPerformanceMs.toFixed(2)),
    pageDetails,
    devtoolsMetrics: metricResponse.metrics.filter((entry) => ['TaskDuration', 'ScriptDuration', 'JSHeapUsedSize', 'Nodes', 'LayoutCount'].includes(entry.name)),
    httpErrors,
    browserErrors,
  }
  assert.deepEqual(httpErrors, [], `HTTP errors occurred: ${JSON.stringify(httpErrors)}`)
  assert.deepEqual(browserErrors, [], `Browser errors occurred: ${browserErrors.join('; ')}`)
  const evidence = resolve(process.env.ARMSTEEL_EVIDENCE_PATH ?? 'docs/renaissance/evidence/fluid-cold-entry-browser-check.json')
  await mkdir(resolve('docs/renaissance/evidence'), { recursive: true })
  await writeFile(evidence, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Fluid cold-entry sample passed: ${report.browserObservedMountMs} ms, ${report.pageDetails.longTasks.length} long tasks, no browser/network errors.`)
} finally {
  socket.close()
}
