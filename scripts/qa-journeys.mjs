import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9347)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5198'
const evidenceRoot = resolve('docs/renaissance/evidence')
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page' && target.url === 'about:blank') ?? targets.find((target) => target.type === 'page')
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
    const { resolve: resolveCall, reject, method, timeout } = waiting.get(message.id)
    clearTimeout(timeout)
    waiting.delete(message.id)
    if (message.error) reject(new Error(`${method}: ${message.error.message}`))
    else resolveCall(message.result)
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(`uncaught: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(`console: ${message.params.args.map((item) => item.value ?? item.description ?? '').join(' ')}`)
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(`log: ${message.params.entry.text}`)
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserErrors.push(`http ${message.params.response.status}: ${message.params.response.url}`)
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => {
      if (!waiting.has(id)) return
      waiting.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 30000)
    waiting.set(id, { resolve: resolveCall, reject, method, timeout })
  })
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function setViewport(width, height, mobile) {
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height })
  await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 })
}

async function click(selector) {
  const found = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true })()`)
  assert.ok(found, `Could not click ${selector}`)
}

async function tap(selector) {
  const point = await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, visible: rect.width > 0 && rect.height > 0 } })()`)
  assert.ok(point?.visible, `Could not find a visible touch target for ${selector}`)
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] })
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function capture(name) {
  const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(resolve(evidenceRoot, name), Buffer.from(result.data, 'base64'))
}

await mkdir(evidenceRoot, { recursive: true })
await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await setViewport(1440, 900, false)
await call('Page.navigate', { url: `${base}/` })
await waitFor(`Boolean(document.querySelector('[data-journey-id="patterns"] .journey-route'))`, 'the gallery paths')
await evaluate(`document.querySelector('.journey-section')?.scrollIntoView({ block: 'center' })`)
await sleep(250)
const desktopGallery = await evaluate(`({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, pathCount: document.querySelectorAll('.journey-tabs button').length, stops: document.querySelectorAll('.journey-route li').length })`)
assert.equal(desktopGallery.pathCount, 4)
assert.equal(desktopGallery.stops, 5)
assert.ok(desktopGallery.documentWidth <= desktopGallery.width, `The desktop gallery overflows: ${JSON.stringify(desktopGallery)}`)
await capture('journey-gallery-desktop.png')

await click('.journey-tabs button:nth-child(2)')
await waitFor(`document.querySelector('.journey-panel')?.dataset.journeyId === 'forces'`, 'the Forces path tab')
assert.equal(await evaluate(`document.querySelectorAll('.journey-route li').length`), 5, 'The Forces path has five stops')

await evaluate(`document.querySelector('.journey-tabs button:nth-child(3)')?.focus()`)
await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await call('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await waitFor(`document.querySelector('.journey-panel')?.dataset.journeyId === 'machines'`, 'keyboard selection of the Machines path')
await click('.journey-tabs button:nth-child(1)')
await click('.journey-route li:nth-child(2) a')
await waitFor(`location.pathname === '/exhibits/reaction' && new URLSearchParams(location.search).get('journey') === 'patterns'`, 'direct entry to a selected path stop')
await click('button[aria-label="Toggle experiment information"]')
await waitFor(`document.querySelector('.journey-current')?.dataset.journeyStep === '2'`, 'the active path context')
const reactionState = await evaluate(`({ route: location.pathname, search: location.search, title: document.querySelector('.dock-current span')?.textContent.trim(), journey: document.querySelector('.journey-current')?.dataset.journeyId, step: document.querySelector('.journey-current')?.dataset.journeyStep, next: document.querySelector('.journey-current nav a[aria-label^="Continue"]')?.getAttribute('aria-label') })`)
assert.equal(reactionState.route, '/exhibits/reaction')
assert.equal(reactionState.journey, 'patterns')
assert.equal(reactionState.step, '2')
assert.equal(reactionState.next, 'Continue this thread to A Grammar of Growth')
await capture('journey-step-two-desktop.png')

await click('.journey-current nav a[aria-label^="Continue"]')
await waitFor(`location.pathname === '/exhibits/lsystem' && document.querySelector('.journey-current')?.dataset.journeyStep === '3'`, 'continuing and retaining the thread context')
assert.ok(await evaluate(`Boolean(document.querySelector('.info-panel'))`), 'The information panel stays open during thread navigation')
await call('Page.reload')
await waitFor(`location.pathname === '/exhibits/lsystem' && document.querySelector('.dock-current span')?.textContent.trim() === 'A Grammar of Growth'`, 'refreshing a journey deep link')
await click('button[aria-label="Toggle experiment information"]')
await waitFor(`document.querySelector('.journey-current')?.dataset.journeyStep === '3'`, 'restored journey context after refresh')
await click('.journey-current nav a[aria-label^="Previous"]')
await waitFor(`location.pathname === '/exhibits/reaction' && document.querySelector('.journey-current')?.dataset.journeyStep === '2'`, 'moving back within the thread')
for (const [route, step] of [['lsystem', '3'], ['garden', '4'], ['boids', '5']]) {
  await click('.journey-current nav a[aria-label^="Continue"]')
  await waitFor(`location.pathname === '/exhibits/${route}' && document.querySelector('.journey-current')?.dataset.journeyStep === '${step}'`, `continuing the path to ${route}`)
}
await click('.journey-current nav a[aria-label="Continue exploring without this curated path"]')
await waitFor(`location.pathname === '/exhibits/boids' && location.search === '' && !document.querySelector('.journey-current')`, 'leaving the curated path while staying in the exhibit')
await call('Page.navigate', { url: `${base}/exhibits/boids?journey=patterns` })
await waitFor(`location.pathname === '/exhibits/boids' && document.querySelector('.dock-current span')?.textContent.trim() === 'A Murmuration'`, 'restoring the final step')
await click('button[aria-label="Toggle experiment information"]')
await waitFor(`document.querySelector('.journey-current')?.dataset.journeyStep === '5'`, 'the final journey position')
assert.ok(await evaluate(`document.querySelector('.journey-current nav a[aria-label^="Return to the collection after completing"]')?.textContent.includes('Thread complete')`), 'The final stop has a clear completion action')
await click('.journey-current nav a[aria-label^="Return to the collection after completing"]')
await waitFor(`Boolean(document.querySelector('.exhibition-page'))`, 'returning to the collection at the end of a path')

await call('Page.navigate', { url: `${base}/exhibits/garden?journey=machines` })
await waitFor(`location.pathname === '/exhibits/garden' && document.querySelector('.dock-current span')?.textContent.trim() === 'The Living Garden'`, 'an exhibit with an invalid path association')
assert.equal(await evaluate(`Boolean(document.querySelector('.journey-current'))`), false, 'An unrelated path ID is ignored safely')

await setViewport(390, 844, true)
await call('Page.navigate', { url: `${base}/` })
await waitFor(`Boolean(document.querySelector('[data-journey-id="patterns"] .journey-route'))`, 'the mobile gallery paths')
await evaluate(`document.querySelector('.journey-section')?.scrollIntoView({ block: 'center' })`)
await sleep(250)
const mobileGallery = await evaluate(`(() => { const section = document.querySelector('.journey-section')?.getBoundingClientRect(); return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, sectionLeft: section?.left, sectionRight: section?.right, columns: getComputedStyle(document.querySelector('.journey-route')).gridTemplateColumns } })()`)
assert.ok(mobileGallery.documentWidth <= mobileGallery.width + 1, `The mobile gallery overflows: ${JSON.stringify(mobileGallery)}`)
assert.ok((mobileGallery.sectionRight ?? Infinity) <= mobileGallery.width + 1, `The mobile journey section escapes the viewport: ${JSON.stringify(mobileGallery)}`)
await capture('journey-gallery-mobile.png')
await click('.journey-tabs button:nth-child(4)')
await waitFor(`document.querySelector('.journey-panel')?.dataset.journeyId === 'signals'`, 'the Signals path on mobile')
await capture('journey-signals-mobile.png')
await tap('.journey-route li:first-child a')
await waitFor(`location.pathname === '/exhibits/waves' && document.querySelector('.dock-current span')?.textContent.trim() === 'The Wave Chamber'`, 'the mobile journey stop')
await tap('button[aria-label="Toggle experiment information"]')
await waitFor(`document.querySelector('.journey-current')?.dataset.journeyStep === '1'`, 'the mobile thread context')
await sleep(300)
const mobileState = await evaluate(`(() => { const panel = document.querySelector('.info-panel')?.getBoundingClientRect(); return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, panelWidth: panel?.width, panelRight: panel?.right, step: document.querySelector('.journey-current')?.dataset.journeyStep } })()`)
assert.ok(mobileState.documentWidth <= mobileState.width + 1, `The mobile journey overflows: ${JSON.stringify(mobileState)}`)
assert.ok((mobileState.panelRight ?? Infinity) <= mobileState.width + 1, `The mobile information panel escapes the viewport: ${JSON.stringify(mobileState)}`)
await capture('journey-step-mobile.png')

await setViewport(320, 800, true)
await call('Page.navigate', { url: `${base}/` })
await waitFor(`Boolean(document.querySelector('[data-journey-id="patterns"] .journey-route'))`, 'the 320px gallery paths')
await evaluate(`document.querySelector('.journey-section')?.scrollIntoView({ block: 'center' })`)
const narrowGallery = await evaluate(`({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, columns: getComputedStyle(document.querySelector('.journey-route')).gridTemplateColumns })`)
assert.ok(narrowGallery.documentWidth <= narrowGallery.width + 1, `The 320px gallery overflows: ${JSON.stringify(narrowGallery)}`)
await capture('journey-gallery-narrow.png')

await setViewport(844, 390, true)
await call('Page.navigate', { url: `${base}/exhibits/waves?journey=signals` })
await waitFor(`location.pathname === '/exhibits/waves' && document.querySelector('.dock-current span')?.textContent.trim() === 'The Wave Chamber'`, 'the landscape journey stop')
await tap('button[aria-label="Toggle experiment information"]')
await waitFor(`document.querySelector('.journey-current')?.dataset.journeyStep === '1'`, 'the landscape thread context')
await sleep(300)
const landscapeState = await evaluate(`(() => { const panel = document.querySelector('.info-panel')?.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, panelBottom: panel?.bottom, panelHeight: panel?.height, panelScrolls: (document.querySelector('.info-panel')?.scrollHeight ?? 0) > (document.querySelector('.info-panel')?.clientHeight ?? 0) } })()`)
assert.ok(landscapeState.documentWidth <= landscapeState.width + 1, `The landscape journey overflows horizontally: ${JSON.stringify(landscapeState)}`)
assert.ok((landscapeState.panelBottom ?? Infinity) <= landscapeState.height + 1, `The landscape information panel escapes the viewport: ${JSON.stringify(landscapeState)}`)
assert.ok(landscapeState.panelScrolls, 'The landscape information panel can scroll when its content exceeds the short screen')
await capture('journey-step-landscape.png')

assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(' | ')}`)
const report = { desktopGallery, reactionState, mobileGallery, narrowGallery, mobileState, landscapeState, browserErrors, scenarios: ['four selectable path themes', 'keyboard path selection', 'skip directly to a stop', 'complete five-stop path in both directions', 'deep-link refresh', 'invalid path association recovery', 'touch navigation on mobile', '320px gallery', 'mobile portrait and landscape layouts'] }
await writeFile(resolve(evidenceRoot, 'journey-browser-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
socket.close()
console.log(`Journey browser checks passed: ${report.scenarios.length} scenarios, desktop/mobile, no browser or HTTP errors.`)
