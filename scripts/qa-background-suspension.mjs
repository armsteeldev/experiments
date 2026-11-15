import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5217'
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
const browser = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolveOpen, reject) => {
  browser.addEventListener('open', resolveOpen, { once: true })
  browser.addEventListener('error', reject, { once: true })
})

let browserId = 0
const browserCalls = new Map()
browser.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id || !browserCalls.has(message.id)) return
  const { resolve: resolveCall, reject, timeout, method } = browserCalls.get(message.id)
  clearTimeout(timeout)
  browserCalls.delete(message.id)
  if (message.error) reject(new Error(`${method}: ${message.error.message}`))
  else resolveCall(message.result)
})

function callBrowser(method, params = {}) {
  const id = ++browserId
  browser.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => { browserCalls.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    browserCalls.set(id, { resolve: resolveCall, reject, timeout, method })
  })
}

let pageTargetId = null
let backgroundTargetId = null
let pageSocket = null
let callPage = null
const pageCalls = new Map()
const browserErrors = []
let pageId = 0

function connectPage(target) {
  pageSocket = new WebSocket(target.webSocketDebuggerUrl)
  return new Promise((resolveOpen, reject) => {
    pageSocket.addEventListener('open', () => {
      pageSocket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data)
        if (message.id && pageCalls.has(message.id)) {
          const { resolve: resolveCall, reject: rejectCall, timeout, method } = pageCalls.get(message.id)
          clearTimeout(timeout)
          pageCalls.delete(message.id)
          if (message.error) rejectCall(new Error(`${method}: ${message.error.message}`))
          else resolveCall(message.result)
        }
        if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args.map((item) => item.value ?? item.description ?? '').join(' '))
        if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserErrors.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`)
      })
      resolveOpen()
    }, { once: true })
    pageSocket.addEventListener('error', reject, { once: true })
  })
}

function call(method, params = {}) {
  const id = ++pageId
  pageSocket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => { pageCalls.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    pageCalls.set(id, { resolve: resolveCall, reject, timeout, method })
  })
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
async function waitFor(expression, label, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function click(selector) {
  assert.equal(await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true })()`), true, `Could not click ${selector}`)
}

const instrumentation = `(() => {
  const qa = window.__armsteelBackgroundQA = { intervals: [], stats: [], rafVisible: 0, rafHidden: 0, workers: [] }
  const nativeInterval = window.setInterval.bind(window)
  const nativeRaf = window.requestAnimationFrame.bind(window)
  window.setInterval = (callback, delay = 0, ...args) => {
    const record = { delay: Number(delay), total: 0, visible: 0, hidden: 0 }
    qa.intervals.push(record)
    return nativeInterval(function (...callbackArgs) {
      const wasHidden = document.hidden
      record.total++
      if (wasHidden) record.hidden++; else record.visible++
      callback.apply(this, callbackArgs)
      if (Number(delay) === 320 && !wasHidden) nativeRaf(() => {
        const tick = Number(document.querySelector('.iw-network-stats')?.innerText.match(/TICK (\\d+)/)?.[1])
        const steps = qa.intervals.filter((item) => item.delay === 78)
        qa.stats.push({ tick, visibleSteps: steps.reduce((sum, item) => sum + item.visible, 0), hiddenSteps: steps.reduce((sum, item) => sum + item.hidden, 0) })
      })
    }, delay, ...args)
  }
  window.requestAnimationFrame = (callback) => nativeRaf((time) => {
    if (document.hidden) qa.rafHidden++; else qa.rafVisible++
    callback(time)
  })
  const NativeWorker = window.Worker
  function TrackedWorker(...args) {
    const worker = new NativeWorker(...args)
    const record = { url: String(args[0]), messages: [], terminated: false }
    const post = worker.postMessage.bind(worker)
    worker.postMessage = (data, ...transfer) => { record.messages.push({ action: data?.action, generation: data?.generation, id: data?.id }); return post(data, ...transfer) }
    const terminate = worker.terminate.bind(worker)
    worker.terminate = () => { record.terminated = true; return terminate() }
    qa.workers.push(record)
    return worker
  }
  TrackedWorker.prototype = NativeWorker.prototype
  Object.setPrototypeOf(TrackedWorker, NativeWorker)
  window.Worker = TrackedWorker
})()`

try {
  const createdPage = await callBrowser('Target.createTarget', { url: 'about:blank' })
  pageTargetId = createdPage.targetId
  const targetUrl = `http://127.0.0.1:${port}/json`
  let target = null
  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await (await fetch(targetUrl)).json()
    target = targets.find((item) => item.id === pageTargetId)
    if (target?.webSocketDebuggerUrl) break
    await sleep(50)
  }
  assert.ok(target?.webSocketDebuggerUrl, 'Created browser page exposes a debugging target')
  await connectPage(target)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation })
  await callBrowser('Target.activateTarget', { targetId: pageTargetId })

  await call('Page.navigate', { url: `${base}/exhibits/network` })
  await waitFor(`location.pathname === '/exhibits/network' && Boolean(document.querySelector('.iw-network-stats')) && window.__armsteelBackgroundQA?.stats.length >= 2`, 'The Living Network to mount and emit stable tick samples')
  const beforeNetwork = await evaluate(`window.__armsteelBackgroundQA.stats.at(-1)`)
  assert.ok(beforeNetwork.tick > 4, 'The network advances before the page is hidden')

  const hiddenTab = await callBrowser('Target.createTarget', { url: 'about:blank' })
  backgroundTargetId = hiddenTab.targetId
  await callBrowser('Target.activateTarget', { targetId: backgroundTargetId })
  await waitFor('document.hidden === true', 'The network tab to become backgrounded')
  await sleep(5000)
  const hiddenNetwork = await evaluate(`({ hidden: document.hidden, intervals: window.__armsteelBackgroundQA.intervals.filter((item) => item.delay === 78).reduce((sum, item) => ({ total: sum.total + item.total, visible: sum.visible + item.visible, hidden: sum.hidden + item.hidden }), { total: 0, visible: 0, hidden: 0 }), rafHidden: window.__armsteelBackgroundQA.rafHidden })`)
  assert.equal(hiddenNetwork.hidden, true, 'The browser actually backgrounds the exhibit page')
  assert.ok(hiddenNetwork.intervals.hidden > 0, 'The browser delivered at least one throttled network step callback while hidden')

  await callBrowser('Target.activateTarget', { targetId: pageTargetId })
  await waitFor('document.hidden === false', 'The network tab to return to the foreground')
  await waitFor(`window.__armsteelBackgroundQA.stats.length > 2 && window.__armsteelBackgroundQA.stats.at(-1).tick > ${beforeNetwork.tick}`, 'The network to resume and publish a new tick')
  const afterNetwork = await evaluate(`window.__armsteelBackgroundQA.stats.at(-1)`)
  const networkDelta = afterNetwork.tick - beforeNetwork.tick
  const visibleStepDelta = afterNetwork.visibleSteps - beforeNetwork.visibleSteps
  const hiddenStepDelta = afterNetwork.hiddenSteps - beforeNetwork.hiddenSteps
  assert.ok(Math.abs(networkDelta - visibleStepDelta) <= 2, `Network tick advance ${networkDelta} should follow visible step callbacks ${visibleStepDelta}, with no contribution from ${hiddenStepDelta} hidden callbacks`)
  await callBrowser('Target.closeTarget', { targetId: backgroundTargetId })
  backgroundTargetId = null

  await call('Page.navigate', { url: `${base}/exhibits/mandelbrot` })
  await waitFor(`location.pathname === '/exhibits/mandelbrot' && Boolean(document.querySelector('.fractal-canvas')) && !document.querySelector('.experience-loading')`, 'Mandelbrot to mount')
  await click('button[aria-label="Toggle experiment controls"]')
  await waitFor('Boolean(document.querySelector("#experiment-controls select option[value=deep]"))', 'The deep-zoom preset control')
  assert.equal(await evaluate(`(() => { const select = [...document.querySelectorAll('#experiment-controls select')].find((item) => [...item.options].some((option) => option.value === 'deep')); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'deep'); select.dispatchEvent(new Event('change', { bubbles: true })); return select.value === 'deep' })()`), true, 'The browser selects the deep fractal preset')
  await click('button[aria-label="Toggle experiment controls"]')
  await waitFor(`document.querySelector('.canvas-coordinate')?.textContent.includes('e50')`, 'The deep fractal preset to reach its 10^50× view')
  await waitFor(`window.__armsteelBackgroundQA.workers.some((worker) => worker.url.includes('mandelbrot.worker') && worker.messages.some((message) => message.action === 'prepare'))`, 'Deep fractal worker tiles to start')
  const beforeMandelbrot = await evaluate(`(() => { const workers = window.__armsteelBackgroundQA.workers.filter((worker) => worker.url.includes('mandelbrot.worker')); return { prepare: workers.reduce((sum, worker) => sum + worker.messages.filter((message) => message.action === 'prepare').length, 0), workers: workers.length, highestPrepareGeneration: Math.max(...workers.flatMap((worker) => worker.messages.filter((message) => message.action === 'prepare').map((message) => message.generation ?? -1))) } })()`)
  assert.ok(beforeMandelbrot.prepare > 0, 'Deep zoom has queued real worker tile work')

  const fractalBackground = await callBrowser('Target.createTarget', { url: 'about:blank' })
  backgroundTargetId = fractalBackground.targetId
  await callBrowser('Target.activateTarget', { targetId: backgroundTargetId })
  await waitFor('document.hidden === true', 'The deep-zoom tab to become backgrounded')
  await waitFor(`window.__armsteelBackgroundQA.workers.filter((worker) => worker.url.includes('mandelbrot.worker')).some((worker) => worker.messages.some((message) => message.action === 'cancel'))`, 'The renderer to send worker cancellation on hide')
  const hiddenMandelbrot = await evaluate(`(() => { const workers = window.__armsteelBackgroundQA.workers.filter((worker) => worker.url.includes('mandelbrot.worker')); return { hidden: document.hidden, prepare: workers.reduce((sum, worker) => sum + worker.messages.filter((message) => message.action === 'prepare').length, 0), cancel: workers.reduce((sum, worker) => sum + worker.messages.filter((message) => message.action === 'cancel').length, 0), highestCancelGeneration: Math.max(...workers.flatMap((worker) => worker.messages.filter((message) => message.action === 'cancel').map((message) => message.generation ?? -1))) } })()`)
  await sleep(1800)
  const heldMandelbrot = await evaluate(`window.__armsteelBackgroundQA.workers.filter((worker) => worker.url.includes('mandelbrot.worker')).reduce((sum, worker) => sum + worker.messages.filter((message) => message.action === 'prepare').length, 0)`)
  assert.equal(heldMandelbrot, hiddenMandelbrot.prepare, 'No more deep tiles are sent while the tab is hidden')

  await callBrowser('Target.activateTarget', { targetId: pageTargetId })
  await waitFor('document.hidden === false', 'The deep-zoom tab to return to the foreground')
  await waitFor(`window.__armsteelBackgroundQA.workers.filter((worker) => worker.url.includes('mandelbrot.worker')).reduce((sum, worker) => sum + worker.messages.filter((message) => message.action === 'prepare').length, 0) > ${heldMandelbrot}`, 'Deep rendering to resume on return')
  const resumedMandelbrot = await evaluate(`(() => { const workers = window.__armsteelBackgroundQA.workers.filter((worker) => worker.url.includes('mandelbrot.worker')); return { prepare: workers.reduce((sum, worker) => sum + worker.messages.filter((message) => message.action === 'prepare').length, 0), highestPrepareGeneration: Math.max(...workers.flatMap((worker) => worker.messages.filter((message) => message.action === 'prepare').map((message) => message.generation ?? -1))) } })()`)
  assert.ok(resumedMandelbrot.highestPrepareGeneration > hiddenMandelbrot.highestCancelGeneration, 'Foreground rendering uses a new generation after cancellation')
  assert.equal(browserErrors.length, 0, `Background suspension produced browser or network errors: ${browserErrors.join('; ')}`)

  const evidence = {
    browser: await evaluate(`({ userAgent: navigator.userAgent, visibility: document.visibilityState, renderer: (() => { const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return 'unavailable'; const extension = gl.getExtension('WEBGL_debug_renderer_info'); return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) })() })`),
    network: { before: beforeNetwork, hidden: hiddenNetwork, after: afterNetwork, tickDelta: networkDelta, visibleStepDelta, hiddenStepDelta, method: 'A real second browser tab backgrounds the page for 5 seconds; interval callbacks are counted by visibility and the next rendered tick is reconciled against foreground callbacks.' },
    mandelbrot: { before: beforeMandelbrot, hidden: hiddenMandelbrot, heldPrepareCount: heldMandelbrot, resumed: resumedMandelbrot, method: 'Worker postMessage calls are recorded in the page; hide during deep preset work, confirm explicit cancellation and no new requests, then reactivate and verify a later generation resumes.' },
    browserErrors,
    caveat: 'Headless Chromium background-tab behavior does not establish physical-device power use; WebGPU context-loss recovery is a separate, still-open check.'
  }
  await mkdir('docs/renaissance/evidence', { recursive: true })
  await writeFile(resolve('docs/renaissance/evidence/background-suspension-browser-checks.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  pageSocket?.close()
  if (backgroundTargetId) await callBrowser('Target.closeTarget', { targetId: backgroundTargetId }).catch(() => {})
  if (pageTargetId) await callBrowser('Target.closeTarget', { targetId: pageTargetId }).catch(() => {})
  browser.close()
}
