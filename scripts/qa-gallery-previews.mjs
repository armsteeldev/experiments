import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const port = Number(process.env.ARMSTEEL_CDP_PORT ?? 9362)
const base = process.env.ARMSTEEL_PREVIEW_URL ?? 'http://127.0.0.1:5215'
const evidenceRoot = resolve('docs/renaissance/evidence')
const exhibits = JSON.parse(await readFile(resolve('src/data/experiments.json'), 'utf8'))
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
  await call('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 1 } : { enabled: false })
  await evaluate('window.scrollTo(0, 0)')
}

async function capture(name) {
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(resolve(evidenceRoot, name), Buffer.from(screenshot.data, 'base64'))
}

const lsystemSignature = `(() => {
  const canvas = document.querySelector('.gallery-grid .card-art-link[href="/exhibits/lsystem"] canvas')
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return null
  const { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height).data
  let hash = 2166136261
  for (let row = 0; row < 32; row++) for (let column = 0; column < 48; column++) {
    const x = Math.min(width - 1, Math.floor((column + .5) * width / 48))
    const y = Math.min(height - 1, Math.floor((row + .5) * height / 32))
    const index = (y * width + x) * 4
    for (let channel = 0; channel < 3; channel++) hash = Math.imul(hash ^ pixels[index + channel], 16777619)
  }
  return (hash >>> 0).toString(16)
})()`

function previewSweep(viewportLabel) {
  return `(() => {
    const exhibits = ${JSON.stringify(exhibits.map(({ id }) => id))}
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const sample = (canvas) => {
      if (!canvas || !canvas.width || !canvas.height) return null
      const context = canvas.getContext('2d')
      if (!context) return null
      const { width, height } = canvas
      const pixels = context.getImageData(0, 0, width, height).data
      const colors = new Set()
      let hash = 2166136261
      const columns = 24, rows = 14
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const x = Math.min(width - 1, Math.floor((column + .5) * width / columns))
        const y = Math.min(height - 1, Math.floor((row + .5) * height / rows))
        const index = (y * width + x) * 4
        const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2]
        colors.add(red + ',' + green + ',' + blue)
        hash = Math.imul(hash ^ red, 16777619)
        hash = Math.imul(hash ^ green, 16777619)
        hash = Math.imul(hash ^ blue, 16777619)
      }
      return { width, height, sampledColors: colors.size, signature: (hash >>> 0).toString(16), painted: colors.size > 1 }
    }

    return (async () => {
      const results = []
      for (const id of exhibits) {
        const selector = id === 'mandelbrot' ? '.featured-art-link' : '.gallery-grid .card-art-link'
        const link = [...document.querySelectorAll(selector)].find((node) => node.getAttribute('href') === '/exhibits/' + id)
        const canvas = link?.querySelector('canvas.artwork-preview')
        link?.scrollIntoView({ block: 'center', behavior: 'instant' })
        for (let attempt = 0; attempt < 4; attempt++) await nextFrame()
        let state = sample(canvas)
        for (let attempt = 0; state && !state.painted && attempt < 24; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 40))
          state = sample(canvas)
        }
        const rect = link?.getBoundingClientRect()
        const visible = Boolean(rect && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth)
        results.push({ id, found: Boolean(link && canvas), visible, state })
      }
      const pageOverflow = document.documentElement.scrollWidth > innerWidth + 1
      return { viewport: ${JSON.stringify(viewportLabel)}, previews: results, pageOverflow }
    })()
  })()`
}

await call('Page.enable')
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')
await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const NativeWorker = window.Worker
  const stats = window.__armsteelWorkerStats = { created: 0, terminated: 0, active: 0, urls: [] }
  window.Worker = new Proxy(NativeWorker, { construct(target, args) {
    const worker = Reflect.construct(target, args, target)
    const entry = { url: String(args[0]), terminated: false }
    stats.created++; stats.active++; stats.urls.push(entry.url)
    const terminate = worker.terminate.bind(worker)
    worker.terminate = () => {
      if (!entry.terminated) { entry.terminated = true; stats.terminated++; stats.active-- }
      return terminate()
    }
    return worker
  } })
})()` })

await setViewport(1440, 900, false)
await call('Page.navigate', { url: `${base}/` })
await waitFor(`location.pathname === '/' && document.querySelectorAll('.artwork-preview').length >= 20`, 'gallery and its preview canvases')
await sleep(350)
await evaluate(`document.querySelector('.gallery-grid')?.scrollIntoView({ block: 'start', behavior: 'instant' })`)
await sleep(150)
await capture('gallery-collection-desktop.png')
const desktop = await evaluate(previewSweep('desktop 1440×900'))

const hoverTarget = await evaluate(`(() => {
  const link = document.querySelector('.gallery-grid .card-art-link[href="/exhibits/lsystem"]')
  link?.scrollIntoView({ block: 'center', behavior: 'instant' })
  const rect = link?.querySelector('canvas')?.getBoundingClientRect()
  return rect && { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
})()`)
assert.ok(hoverTarget, 'Could not position the L-system preview for hover testing')
const hoverInitial = await evaluate(lsystemSignature)
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverTarget.x, y: hoverTarget.y, buttons: 0 })
await sleep(700)
const hoverSignature = await evaluate(lsystemSignature)
await capture('gallery-preview-hover-desktop.png')
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8, buttons: 0 })
await sleep(120)
const resetSignature = await evaluate(lsystemSignature)

await call('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
const reducedMotion = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverTarget.x, y: hoverTarget.y, buttons: 0 })
await sleep(550)
const reducedHoverSignature = await evaluate(lsystemSignature)
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8, buttons: 0 })
await call('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

await setViewport(390, 844, true)
await sleep(120)
await evaluate(`document.querySelector('.gallery-grid')?.scrollIntoView({ block: 'start', behavior: 'instant' })`)
await sleep(150)
await capture('gallery-collection-mobile.png')
const mobile = await evaluate(previewSweep('phone 390×844'))
const workersInGallery = await evaluate('window.__armsteelWorkerStats')
await evaluate(`document.querySelector('.gallery-grid .card-art-link[href="/exhibits/boids"]')?.click()`)
await waitFor(`location.pathname === '/exhibits/boids' && Boolean(document.querySelector('.dock-current'))`, 'leaving the gallery for a non-worker exhibit')
await sleep(150)
const workersAfterGalleryUnmount = await evaluate('window.__armsteelWorkerStats')
await evaluate(`document.querySelector('button[aria-label="Return to exhibition"]')?.click()`)
await waitFor(`location.pathname === '/' && document.querySelectorAll('.artwork-preview').length >= 20`, 'returning to the gallery after the exhibit')
await sleep(350)
const workersAfterReturn = await evaluate('window.__armsteelWorkerStats')

socket.close()
await mkdir(evidenceRoot, { recursive: true })
const unpainted = [...desktop.previews, ...mobile.previews].filter((preview) => !preview.found || !preview.visible || !preview.state?.painted)
const report = {
  browser: 'HeadlessChrome 157, SwiftShader WebGL, desktop and touch-emulated phone',
  coverage: { exhibits: exhibits.length, viewports: [desktop.viewport, mobile.viewport], firstPaintChecks: desktop.previews.length + mobile.previews.length },
  firstPaint: { desktopPassed: desktop.previews.filter((preview) => preview.state?.painted && preview.visible).length, mobilePassed: mobile.previews.filter((preview) => preview.state?.painted && preview.visible).length, unpainted, horizontalOverflow: { desktop: desktop.pageOverflow, mobile: mobile.pageOverflow } },
  interaction: { preview: 'lsystem', baseSignature: hoverInitial, hoveredSignature: hoverSignature, resetSignature, hoverChangesPixels: hoverSignature !== hoverInitial, pointerLeaveRestoresBase: resetSignature === hoverInitial, reducedMotion: { emulated: reducedMotion, hoverSignatureUnchanged: reducedHoverSignature === hoverInitial } },
  workerLifecycle: { inGallery: workersInGallery, afterGalleryUnmount: workersAfterGalleryUnmount, afterGalleryReturn: workersAfterReturn },
  browserErrors,
}
await writeFile(resolve(evidenceRoot, 'gallery-preview-browser-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
const issues = []
if (unpainted.length) issues.push(`${unpainted.length} visible exhibit previews were missing or unpainted`)
if (desktop.pageOverflow || mobile.pageOverflow) issues.push('gallery has horizontal overflow')
if (!report.interaction.hoverChangesPixels) issues.push('hover did not change the preview pixels')
if (!report.interaction.pointerLeaveRestoresBase) issues.push('pointer leave did not restore the representative state')
if (!reducedMotion || !report.interaction.reducedMotion.hoverSignatureUnchanged) issues.push('reduced motion did not keep a hovered preview static')
if (workersAfterGalleryUnmount?.active > 0) issues.push(`${workersAfterGalleryUnmount.active} preview worker(s) remain active after gallery unmount`)
if (workersAfterReturn?.active > 1) issues.push(`${workersAfterReturn.active} workers are active after returning to the gallery`)
if (browserErrors.length) issues.push(`${browserErrors.length} browser or network error(s)`)
if (issues.length) {
  console.error(`${issues.length} gallery-preview findings: ${issues.join('; ')}`)
  console.error(JSON.stringify(report, null, 2))
  process.exitCode = 1
} else {
  console.log(`Gallery preview checks passed: ${desktop.previews.length + mobile.previews.length} rendered previews, hover/reduced-motion behavior and worker cleanup.`)
}
