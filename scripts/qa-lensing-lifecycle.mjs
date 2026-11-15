import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9363)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5230'
const browserVersion = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
assert.ok(page, 'A Chromium page is required for lensing lifecycle QA')

const browser = new WebSocket(browserVersion.webSocketDebuggerUrl)
const pageSocket = new WebSocket(page.webSocketDebuggerUrl)
const browserCalls = new Map(), pageCalls = new Map(), browserErrors = []
let browserCallId = 0, pageCallId = 0, backgroundTargetId = null

function connect(socket, map, onError) {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id && map.has(message.id)) {
          const { resolve: done, reject: fail, timeout, method } = map.get(message.id)
          clearTimeout(timeout); map.delete(message.id)
          if (message.error) fail(new Error(`${method}: ${message.error.message}`)); else done(message.result)
        }
        onError?.(message)
      })
      resolve()
    }, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
}

function request(socket, map, next, method, params = {}) {
  const id = next()
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => { map.delete(id); rejectRequest(new Error(`CDP timeout: ${method}`)) }, 30000)
    map.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout, method })
  })
}

const callBrowser = (method, params) => request(browser, browserCalls, () => ++browserCallId, method, params)
const callPage = (method, params) => request(pageSocket, pageCalls, () => ++pageCallId, method, params)
const instrumentation = `(() => {
  const qa = window.__armsteelLensingQA = { workers: [], cancelNextSky: false, cancelledCandidate: null, autoCancelValue: null, forcedFallback: sessionStorage.getItem('armsteel-lensing-no-worker') === '1', loadingLabelFrames: 0, longTasks: [] }
  const observer = typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask') ? new PerformanceObserver((entries) => qa.longTasks.push(...entries.getEntries().map((entry) => ({ duration: entry.duration, startTime: entry.startTime })))) : null
  observer?.observe({ type: 'longtask', buffered: true })
  const nativeFillText = CanvasRenderingContext2D.prototype.fillText
  CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
    if (String(text).startsWith('COMPUTING SCHWARZSCHILD')) qa.loadingLabelFrames++
    return nativeFillText.call(this, text, ...args)
  }
  const NativeWorker = window.Worker
  function TrackedWorker(...args) {
    if (qa.forcedFallback && String(args[0]).includes('lensing.worker')) throw new Error('QA forced lensing worker construction failure')
    const worker = new NativeWorker(...args)
    const record = { url: String(args[0]), requests: [], responses: [], terminated: false }
    const nativePost = worker.postMessage.bind(worker)
    worker.postMessage = (data, ...transfer) => {
      record.requests.push({ type: data?.type, target: data?.target ?? null, requestId: data?.requestId ?? null, width: data?.width ?? null, height: data?.height ?? null, sourceRatio: data?.sourceRatio ?? null })
      nativePost(data, ...transfer)
      if (data?.type === 'sky' && qa.cancelNextSky) {
        qa.cancelNextSky = false
        qa.cancelledCandidate = data.requestId
        setTimeout(() => {
          const slider = [...document.querySelectorAll('.control-panel label.range-control')].find((label) => label.textContent.includes('Source-plane ratio'))?.querySelector('input[type="range"]')
          if (!slider) { qa.autoCancelValue = 'slider missing'; return }
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0.76')
          slider.dispatchEvent(new Event('input', { bubbles: true }))
          slider.dispatchEvent(new Event('change', { bubbles: true }))
          qa.autoCancelValue = slider.value
        }, 0)
      }
    }
    worker.addEventListener('message', (event) => {
      const data = event.data
      record.responses.push({ type: data?.type, requestId: data?.requestId ?? null, width: data?.width ?? null, height: data?.height ?? null, bytes: data?.pixels?.byteLength ?? null })
    })
    const terminate = worker.terminate.bind(worker)
    worker.terminate = () => { record.terminated = true; return terminate() }
    qa.workers.push(record)
    return worker
  }
  TrackedWorker.prototype = NativeWorker.prototype
  window.Worker = TrackedWorker
})()`

async function evaluate(expression) {
  const response = await callPage('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
async function waitFor(expression, label, timeoutMs = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return
    await sleep(80)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

try {
  await Promise.all([
    connect(browser, browserCalls, (message) => {
      if (message.method === 'Target.targetDestroyed' && message.params.targetId === backgroundTargetId) backgroundTargetId = null
    }),
    connect(pageSocket, pageCalls, (message) => {
      if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserErrors.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`)
    }),
  ])
  await callPage('Page.enable')
  await callPage('Runtime.enable')
  await callPage('Network.enable')
  await callPage('Log.enable')
  await callPage('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
  await callPage('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation })
  await callPage('Page.navigate', { url: `${base}/exhibits/lensing` })
  await waitFor(`location.pathname === '/exhibits/lensing' && Boolean(document.querySelector('.iw-lensing-canvas')) && window.__armsteelLensingQA?.workers.length > 0`, 'Where Light Falls to mount its tracked renderer')
  await waitFor(`window.__armsteelLensingQA.workers.some((worker) => worker.responses.some((response) => response.type === 'table') && worker.responses.some((response) => response.type === 'sky'))`, 'the initial deflection table and lensed sky')
  const workerInfo = await evaluate(`(() => { const worker = window.__armsteelLensingQA.workers.find((item) => item.url.includes('lensing.worker')); return { url: worker.url, requests: worker.requests, responses: worker.responses } })()`)
  assert.ok(workerInfo.responses.some((response) => response.type === 'table'), 'The numerical deflection table is built in its worker')
  let lastSkyResponse = workerInfo.responses.filter((response) => response.type === 'sky').at(-1)
  assert.ok(lastSkyResponse?.width && lastSkyResponse?.height, 'The worker returns a complete lensed sky')

  await callPage('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 })
  await waitFor(`innerWidth === 390 && window.__armsteelLensingQA.workers.some((worker) => worker.responses.some((response) => response.type === 'sky' && response.requestId > ${lastSkyResponse.requestId}))`, 'a freshly rasterized sky at phone size')
  const mobile = await evaluate(`(() => { const worker = window.__armsteelLensingQA.workers.find((item) => item.url.includes('lensing.worker')); return { viewport: [innerWidth, innerHeight], canvas: [document.querySelector('.iw-lensing-canvas').width, document.querySelector('.iw-lensing-canvas').height], sky: worker.responses.filter((response) => response.type === 'sky').at(-1) } })()`)
  assert.equal(mobile.viewport[0], 390)
  assert.ok(mobile.sky.width !== lastSkyResponse.width || mobile.sky.height !== lastSkyResponse.height, 'Viewport resize changes the bounded sky raster dimensions')
  const mobileShot = await callPage('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await mkdir('docs/renaissance/evidence', { recursive: true })
  await writeFile(resolve('docs/renaissance/evidence/lensing-lifecycle-mobile.png'), Buffer.from(mobileShot.data, 'base64'))

  lastSkyResponse = mobile.sky
  await callPage('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
  await waitFor(`innerWidth === 1440 && window.__armsteelLensingQA.workers.some((worker) => worker.responses.some((response) => response.type === 'sky' && response.requestId > ${lastSkyResponse.requestId}))`, 'a freshly rasterized sky after returning to desktop size')
  const desktopAfterResize = await evaluate(`(() => { const worker = window.__armsteelLensingQA.workers.find((item) => item.url.includes('lensing.worker')); return { viewport: [innerWidth, innerHeight], canvas: [document.querySelector('.iw-lensing-canvas').width, document.querySelector('.iw-lensing-canvas').height], sky: worker.responses.filter((response) => response.type === 'sky').at(-1) } })()`)
  assert.equal(desktopAfterResize.viewport[0], 1440)
  assert.ok(desktopAfterResize.sky.width !== mobile.sky.width || desktopAfterResize.sky.height !== mobile.sky.height, 'Returning to desktop dimensions restores a corresponding sky raster')

  const beforeHidden = await evaluate(`(() => { const worker = window.__armsteelLensingQA.workers.find((item) => item.url.includes('lensing.worker')); return { table: worker.responses.filter((response) => response.type === 'table').at(-1)?.requestId ?? 0, sky: worker.responses.filter((response) => response.type === 'sky').at(-1)?.requestId ?? 0, calculations: worker.requests.filter((request) => request.type === 'table' || request.type === 'sky').length } })()`)
  const backgroundTab = await callBrowser('Target.createTarget', { url: 'about:blank' })
  backgroundTargetId = backgroundTab.targetId
  await callBrowser('Target.activateTarget', { targetId: backgroundTargetId })
  await waitFor('document.hidden === true', 'the lensing exhibit to become backgrounded')
  await waitFor(`window.__armsteelLensingQA.workers.some((worker) => worker.requests.some((request) => request.type === 'cancel' && request.target === 'all'))`, 'all lensing worker work to be cancelled when hidden')
  await sleep(500)
  const hidden = await evaluate(`(() => { const worker = window.__armsteelLensingQA.workers.find((item) => item.url.includes('lensing.worker')); return { hidden: document.hidden, calculations: worker.requests.filter((request) => request.type === 'table' || request.type === 'sky').length, cancelled: worker.requests.some((request) => request.type === 'cancel' && request.target === 'all') } })()`)
  assert.equal(hidden.hidden, true, 'Chromium has actually backgrounded the lensing page')
  assert.equal(hidden.calculations, beforeHidden.calculations, 'The hidden lensing page does not dispatch further heavy calculations')
  await callBrowser('Target.activateTarget', { targetId: page.id })
  await waitFor('document.hidden === false', 'the lensing exhibit to return to the foreground')
  await waitFor(`window.__armsteelLensingQA.workers.some((worker) => worker.responses.some((response) => response.type === 'table' && response.requestId > ${beforeHidden.table}))`, 'the deflection table to rebuild after returning')
  await waitFor(`window.__armsteelLensingQA.workers.some((worker) => worker.responses.some((response) => response.type === 'sky' && response.requestId > ${beforeHidden.sky}))`, 'the lensed sky to render after returning')
  const resumed = await evaluate(`(() => { const worker = window.__armsteelLensingQA.workers.find((item) => item.url.includes('lensing.worker')); return { hidden: document.hidden, table: worker.responses.filter((response) => response.type === 'table').at(-1)?.requestId, sky: worker.responses.filter((response) => response.type === 'sky').at(-1)?.requestId, calculations: worker.requests.filter((request) => request.type === 'table' || request.type === 'sky').length } })()`)
  await callBrowser('Target.closeTarget', { targetId: backgroundTargetId })
  backgroundTargetId = null
  assert.equal(resumed.hidden, false, 'The lensing page is visible again')
  assert.ok(resumed.table > beforeHidden.table && resumed.sky > beforeHidden.sky, 'Returning creates fresh table and raster work')

  await callPage('Emulation.setCPUThrottlingRate', { rate: 8 })
  await evaluate(`window.__armsteelLensingQA.cancelNextSky = true`)
  await evaluate(`(() => {
    document.querySelector('button[aria-label="Toggle experiment controls"]')?.click()
    const slider = [...document.querySelectorAll('.control-panel label.range-control')].find((label) => label.textContent.includes('Source-plane ratio'))?.querySelector('input[type="range"]')
    if (!slider) return false
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0.64')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    slider.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await waitFor(`window.__armsteelLensingQA.cancelledCandidate !== null && window.__armsteelLensingQA.autoCancelValue === '0.76'`, 'a newer parameter choice to cancel the active sky request')
  const cancelledRequest = await evaluate(`window.__armsteelLensingQA.cancelledCandidate`)
  await waitFor(`window.__armsteelLensingQA.workers.some((worker) => worker.requests.some((request) => request.type === 'cancel' && request.target === 'sky'))`, 'the worker to receive sky cancellation')
  await waitFor(`window.__armsteelLensingQA.workers.some((worker) => worker.responses.some((response) => response.type === 'sky' && response.requestId > ${cancelledRequest}))`, 'the final source-plane setting to finish')
  const cancellation = await evaluate(`(() => {
    const worker = window.__armsteelLensingQA.workers.find((item) => item.url.includes('lensing.worker'))
    return {
      candidate: window.__armsteelLensingQA.cancelledCandidate,
      cancelled: worker.requests.some((request) => request.type === 'cancel' && request.target === 'sky'),
      staleResponseReturned: worker.responses.some((response) => response.type === 'sky' && response.requestId === window.__armsteelLensingQA.cancelledCandidate),
      latest: worker.responses.filter((response) => response.type === 'sky').at(-1),
      latestSkyRequest: worker.requests.filter((request) => request.type === 'sky').at(-1),
      requestedSourceRatio: [...document.querySelectorAll('.control-panel label.range-control')].find((label) => label.textContent.includes('Source-plane ratio'))?.querySelector('input[type="range"]')?.value,
    }
  })()`)
  assert.equal(cancellation.cancelled, true, 'A changed source-plane parameter explicitly cancels the in-flight sky task')
  assert.equal(cancellation.staleResponseReturned, false, 'The abandoned image request exits without posting its pixel buffer')
  assert.equal(cancellation.requestedSourceRatio, '0.76', 'The visible source-plane control keeps the newer parameter value')
  assert.equal(cancellation.latestSkyRequest.sourceRatio, 0.76, 'The rendered model receives the newer source-plane parameter')

  await callPage('Emulation.setCPUThrottlingRate', { rate: 1 })
  assert.deepEqual(browserErrors, [], `Lensing lifecycle produced browser or HTTP errors: ${browserErrors.join('; ')}`)

  await evaluate(`sessionStorage.setItem('armsteel-lensing-no-worker', '1')`)
  await callPage('Page.navigate', { url: `${base}/exhibits/lensing` })
  await waitFor(`location.pathname === '/exhibits/lensing' && window.__armsteelLensingQA?.forcedFallback && Boolean(document.querySelector('.iw-lensing-canvas'))`, 'the lensing main-thread fallback to mount with worker creation blocked')
  await waitFor(`window.__armsteelLensingQA.loadingLabelFrames > 0`, 'the fallback to begin building its deflection table cooperatively')
  await sleep(1200)
  const fallbackFrameCount = await evaluate(`window.__armsteelLensingQA.loadingLabelFrames`)
  await sleep(350)
  const fallback = await evaluate(`(() => ({ forced: window.__armsteelLensingQA.forcedFallback, workers: window.__armsteelLensingQA.workers.filter((worker) => worker.url.includes('lensing.worker')).length, loadingFrames: window.__armsteelLensingQA.loadingLabelFrames, longTasks: window.__armsteelLensingQA.longTasks, canvas: [document.querySelector('.iw-lensing-canvas').width, document.querySelector('.iw-lensing-canvas').height] }))()`)
  assert.equal(fallback.forced, true, 'This pass deliberately exercises the no-worker recovery route')
  assert.equal(fallback.workers, 0, 'The no-worker pass never creates a lensing worker')
  assert.ok(fallbackFrameCount > 0, 'The fallback visibly entered its computing state')
  assert.equal(fallback.loadingFrames, fallbackFrameCount, 'The fallback completes and removes its computing state')
  assert.deepEqual(browserErrors, [], `Lensing fallback produced browser or HTTP errors: ${browserErrors.join('; ')}`)
  const fallbackShot = await callPage('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(resolve('docs/renaissance/evidence/lensing-worker-fallback-desktop.png'), Buffer.from(fallbackShot.data, 'base64'))
  await evaluate(`sessionStorage.removeItem('armsteel-lensing-no-worker')`)
  const evidence = { browser: await evaluate('navigator.userAgent'), renderer: 'Headless Chromium software renderer; CPU throttling used only for the cancellation race', initial: workerInfo, mobileResize: mobile, desktopResize: desktopAfterResize, backgroundSuspension: { before: beforeHidden, hidden, resumed }, cancellation, noWorkerFallback: fallback, browserErrors, caveat: 'Viewport values are emulation, not a physical phone. The cooperative worker and main-thread paths preserve exact synchronous raster output in unit checks. Long-task entries are recorded for inspection and include route loading, not only fallback computation.' }
  await writeFile(resolve('docs/renaissance/evidence/lensing-lifecycle-browser-checks.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`Lensing lifecycle checks passed: worker raster, phone/desktop resize, background suspension/resume, in-flight cancellation, and completed no-worker fallback; ${browserErrors.length} browser/HTTP errors.`)
} finally {
  pageSocket.close()
  if (backgroundTargetId) await callBrowser('Target.closeTarget', { targetId: backgroundTargetId }).catch(() => {})
  browser.close()
}
